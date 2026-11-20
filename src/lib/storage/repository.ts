import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  writeBatch,
} from "firebase/firestore";
import { getFirebaseDb } from "../firebase/client";
import { GeneratedDeckPayload } from "../schemas/deck";
import {
  DeckRecord,
  QuestionRecord,
  StudySessionRecord,
  UserQuestionProgressRecord,
} from "../schemas/study";
import { assertResourceOwnership } from "../firebase/auth-guard";

const LOCAL_DECKS_KEY = "memly_decks_v1";
const LOCAL_QUESTIONS_KEY = "memly_questions_v1";
const LOCAL_SESSIONS_KEY = "memly_sessions_v1";
const LOCAL_PROGRESS_KEY = "memly_progress_v1";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function readLocalJson<T>(key: string, fallback: T): T {
  if (!isBrowser()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocalJson<T>(key: string, data: T): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Handle storage quota gently
  }
}

function generateId(prefix: string): string {
  const rand = Math.random().toString(36).substring(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
}

/**
 * Helper to race a Firestore/Storage read against a short timeout so the UI never hangs
 * when Cloud Firestore or Firebase Storage has not been provisioned yet.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs = 1500
): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

/**
 * Saves a newly generated deck and all its questions to LocalStorage immediately,
 * and syncs to Firestore in the background.
 */
export async function saveGeneratedDeck(params: {
  userId: string;
  payload: GeneratedDeckPayload;
  sourceFileName: string;
  sourceType: "pdf" | "text" | "sample";
  aiMetadata?: DeckRecord["aiMetadata"];
}): Promise<{ deck: DeckRecord; questions: QuestionRecord[] }> {
  const { userId, payload, sourceFileName, sourceType, aiMetadata } = params;
  const deckId = generateId("deck");
  const now = new Date().toISOString();

  const deck: DeckRecord = {
    id: deckId,
    userId,
    title: payload.deckTitle,
    subject: payload.subject,
    description: payload.description,
    sourceFileName,
    sourceType,
    questionCount: payload.questions.length,
    topics: payload.topics,
    status: "ready",
    aiMetadata,
    createdAt: now,
    updatedAt: now,
  };

  const questions: QuestionRecord[] = payload.questions.map((q, index) => ({
    id: `${deckId}_q_${index + 1}`,
    deckId,
    userId,
    question: q.question,
    options: q.options,
    correctOptionId: q.correctOptionId,
    explanation: q.explanation,
    topic: q.topic,
    subtopic: q.subtopic ?? null,
    difficulty: q.difficulty,
    cognitiveLevel: q.cognitiveLevel ?? "understanding",
    sourceReference: {
      page: q.sourceReference?.page ?? null,
      section: q.sourceReference?.section ?? null,
    },
    learningObjective: q.learningObjective,
    order: index + 1,
  }));

  // 1. Always persist locally first for instant navigation & offline access
  const localDecks = readLocalJson<DeckRecord[]>(LOCAL_DECKS_KEY, []);
  writeLocalJson(LOCAL_DECKS_KEY, [deck, ...localDecks]);

  const localQuestions = readLocalJson<Record<string, QuestionRecord[]>>(
    LOCAL_QUESTIONS_KEY,
    {}
  );
  localQuestions[deckId] = questions;
  writeLocalJson(LOCAL_QUESTIONS_KEY, localQuestions);

  // 2. Sync to Firestore in the background (non-blocking)
  const db = getFirebaseDb();
  if (db && !userId.startsWith("guest_")) {
    try {
      const batch = writeBatch(db);
      const deckRef = doc(db, "decks", deckId);
      batch.set(deckRef, deck);

      for (const q of questions) {
        const qRef = doc(db, "questions", q.id);
        batch.set(qRef, q);
      }
      batch.commit().catch(() => {});
    } catch {
      // Ignored; persisted locally
    }
  }

  return { deck, questions };
}

/**
 * Lists all decks belonging strictly to the current userId.
 */
export async function listUserDecks(userId: string): Promise<DeckRecord[]> {
  const localDecks = readLocalJson<DeckRecord[]>(LOCAL_DECKS_KEY, []).filter(
    (d) => d.userId === userId
  );

  // If we already have local decks, return immediately and sync remote in background if needed
  const db = getFirebaseDb();
  if (db && !userId.startsWith("guest_")) {
    try {
      const q = query(
        collection(db, "decks"),
        where("userId", "==", userId),
        orderBy("createdAt", "desc")
      );
      const snap = await withTimeout(getDocs(q), 1200);
      if (snap) {
        const remoteDecks: DeckRecord[] = [];
        snap.forEach((docSnap) => {
          remoteDecks.push(docSnap.data() as DeckRecord);
        });

        if (remoteDecks.length > 0) {
          const mergedMap = new Map<string, DeckRecord>();
          for (const d of [...remoteDecks, ...localDecks]) {
            if (!mergedMap.has(d.id)) {
              mergedMap.set(d.id, d);
            }
          }
          return Array.from(mergedMap.values()).sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt)
          );
        }
      }
    } catch {
      // Return local decks if remote query fails
    }
  }

  return localDecks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Loads a single deck and its questions, enforcing ownership.
 */
export async function getDeckWithQuestions(
  userId: string,
  deckId: string
): Promise<{ deck: DeckRecord; questions: QuestionRecord[] } | null> {
  const localDecks = readLocalJson<DeckRecord[]>(LOCAL_DECKS_KEY, []);
  let deck = localDecks.find((d) => d.id === deckId) ?? null;

  const localQuestionsMap = readLocalJson<Record<string, QuestionRecord[]>>(
    LOCAL_QUESTIONS_KEY,
    {}
  );
  let questions = localQuestionsMap[deckId] ?? [];

  const db = getFirebaseDb();
  if ((!deck || questions.length === 0) && db && !userId.startsWith("guest_")) {
    try {
      const deckSnap = await withTimeout(getDoc(doc(db, "decks", deckId)), 1500);
      if (deckSnap && deckSnap.exists()) {
        deck = deckSnap.data() as DeckRecord;
      }

      const qQuery = query(
        collection(db, "questions"),
        where("deckId", "==", deckId),
        orderBy("order", "asc")
      );
      const qSnap = await withTimeout(getDocs(qQuery), 1500);
      if (qSnap) {
        const remoteQuestions: QuestionRecord[] = [];
        qSnap.forEach((s) => remoteQuestions.push(s.data() as QuestionRecord));
        if (remoteQuestions.length > 0) {
          questions = remoteQuestions;
        }
      }
    } catch {
      // Fallback to local
    }
  }

  if (!deck) return null;

  assertResourceOwnership(userId, deck, "Deck");

  return {
    deck,
    questions: questions.sort((a, b) => a.order - b.order),
  };
}

/**
 * Deletes a deck, its questions, and its study sessions immediately, syncing deletion to Firestore in the background.
 */
export async function deleteUserDeck(
  userId: string,
  deckId: string
): Promise<void> {
  const localDecks = readLocalJson<DeckRecord[]>(LOCAL_DECKS_KEY, []);
  const target = localDecks.find((d) => d.id === deckId);
  if (target) {
    assertResourceOwnership(userId, target, "Deck");
  }

  writeLocalJson(
    LOCAL_DECKS_KEY,
    localDecks.filter((d) => d.id !== deckId)
  );

  const localQuestionsMap = readLocalJson<Record<string, QuestionRecord[]>>(
    LOCAL_QUESTIONS_KEY,
    {}
  );
  delete localQuestionsMap[deckId];
  writeLocalJson(LOCAL_QUESTIONS_KEY, localQuestionsMap);

  const localSessions = readLocalJson<Record<string, StudySessionRecord>>(
    LOCAL_SESSIONS_KEY,
    {}
  );
  delete localSessions[`${userId}_${deckId}`];
  writeLocalJson(LOCAL_SESSIONS_KEY, localSessions);

  // Sync deletion to Firestore in background (non-blocking)
  const db = getFirebaseDb();
  if (db && !userId.startsWith("guest_")) {
    deleteDoc(doc(db, "decks", deckId)).catch(() => {});
  }
}

/**
 * Loads the active or most recent study session for a user and deck.
 */
export async function getStudySession(
  userId: string,
  deckId: string
): Promise<StudySessionRecord | null> {
  const key = `${userId}_${deckId}`;
  const localSessions = readLocalJson<Record<string, StudySessionRecord>>(
    LOCAL_SESSIONS_KEY,
    {}
  );
  const local = localSessions[key] ?? null;

  if (local) {
    assertResourceOwnership(userId, local, "StudySession");
    return local;
  }

  const db = getFirebaseDb();
  if (db && !userId.startsWith("guest_")) {
    try {
      const sessionSnap = await withTimeout(
        getDoc(doc(db, "studySessions", key)),
        1200
      );
      if (sessionSnap && sessionSnap.exists()) {
        const remote = sessionSnap.data() as StudySessionRecord;
        assertResourceOwnership(userId, remote, "StudySession");
        localSessions[key] = remote;
        writeLocalJson(LOCAL_SESSIONS_KEY, localSessions);
        return remote;
      }
    } catch {
      // Fallback to null
    }
  }

  return null;
}

/**
 * Persists study session progress immediately to LocalStorage and syncs to Firestore in the background.
 */
export async function saveStudySession(
  session: StudySessionRecord
): Promise<void> {
  const key = `${session.userId}_${session.deckId}`;
  const localSessions = readLocalJson<Record<string, StudySessionRecord>>(
    LOCAL_SESSIONS_KEY,
    {}
  );
  localSessions[key] = session;
  writeLocalJson(LOCAL_SESSIONS_KEY, localSessions);

  const db = getFirebaseDb();
  if (db && !session.userId.startsWith("guest_")) {
    setDoc(doc(db, "studySessions", key), session, { merge: true }).catch(
      () => {}
    );
  }
}

/**
 * Records per-question historical attempt statistics in userQuestionProgress (non-blocking remote sync).
 */
export async function recordUserQuestionAttempt(params: {
  userId: string;
  deckId: string;
  questionId: string;
  isCorrect: boolean;
}): Promise<UserQuestionProgressRecord> {
  const { userId, deckId, questionId, isCorrect } = params;
  const progressId = `${userId}_${questionId}`;
  const allProgress = readLocalJson<Record<string, UserQuestionProgressRecord>>(
    LOCAL_PROGRESS_KEY,
    {}
  );

  const existing = allProgress[progressId];
  const now = new Date();
  const nextReview = new Date(
    now.getTime() + (isCorrect ? 24 * 60 * 60 * 1000 : 10 * 60 * 1000)
  );

  const record: UserQuestionProgressRecord = {
    id: progressId,
    userId,
    questionId,
    deckId,
    correctAttempts: (existing?.correctAttempts ?? 0) + (isCorrect ? 1 : 0),
    incorrectAttempts: (existing?.incorrectAttempts ?? 0) + (isCorrect ? 0 : 1),
    status: isCorrect ? "COMPLETED" : "RETRY",
    lastAttemptAt: now.toISOString(),
    nextReviewAt: nextReview.toISOString(),
  };

  allProgress[progressId] = record;
  writeLocalJson(LOCAL_PROGRESS_KEY, allProgress);

  const db = getFirebaseDb();
  if (db && !userId.startsWith("guest_")) {
    setDoc(doc(db, "userQuestionProgress", progressId), record, {
      merge: true,
    }).catch(() => {});
  }

  return record;
}

/**
 * Migrates any guest decks and sessions to a permanent user account upon sign-in/registration.
 */
export async function migrateGuestDataToUser(
  guestId: string,
  newUserId: string
): Promise<void> {
  if (!guestId || guestId === newUserId) return;

  const localDecks = readLocalJson<DeckRecord[]>(LOCAL_DECKS_KEY, []);
  let changed = false;
  const updatedDecks = localDecks.map((d) => {
    if (d.userId === guestId) {
      changed = true;
      return { ...d, userId: newUserId };
    }
    return d;
  });

  if (changed) {
    writeLocalJson(LOCAL_DECKS_KEY, updatedDecks);
  }

  const localQuestionsMap = readLocalJson<Record<string, QuestionRecord[]>>(
    LOCAL_QUESTIONS_KEY,
    {}
  );
  for (const deckId of Object.keys(localQuestionsMap)) {
    localQuestionsMap[deckId] = localQuestionsMap[deckId].map((q) =>
      q.userId === guestId ? { ...q, userId: newUserId } : q
    );
  }
  writeLocalJson(LOCAL_QUESTIONS_KEY, localQuestionsMap);

  const localSessions = readLocalJson<Record<string, StudySessionRecord>>(
    LOCAL_SESSIONS_KEY,
    {}
  );
  for (const key of Object.keys(localSessions)) {
    const sess = localSessions[key];
    if (sess.userId === guestId) {
      const updatedSess = { ...sess, userId: newUserId };
      localSessions[`${newUserId}_${sess.deckId}`] = updatedSess;
      delete localSessions[key];
    }
  }
  writeLocalJson(LOCAL_SESSIONS_KEY, localSessions);
}
