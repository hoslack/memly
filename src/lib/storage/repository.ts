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
  limit,
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
 * Strips undefined properties recursively so Firestore writeBatch / setDoc never throws
 * "Unsupported field value: undefined".
 */
function sanitizeForFirestore<T>(data: T): T {
  return JSON.parse(JSON.stringify(data)) as T;
}

/**
 * Helper to race a Firestore operation against a timeout so the UI never hangs
 * when Cloud Firestore is offline or not yet provisioned.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs = 6000
): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

/**
 * Syncs a deck and its questions to Cloud Firestore so every user (including unauthenticated guests)
 * can see and revise the deck from any browser or device.
 */
async function syncDeckAndQuestionsToFirestore(
  deck: DeckRecord,
  questions: QuestionRecord[]
): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;

  try {
    const cleanDeck = sanitizeForFirestore(deck);
    const cleanQuestions = sanitizeForFirestore(questions);

    // Firestore writeBatch supports up to 500 operations; chunk safely
    const batch = writeBatch(db);
    const deckRef = doc(db, "decks", cleanDeck.id);
    batch.set(deckRef, cleanDeck, { merge: true });

    for (const q of cleanQuestions) {
      const qRef = doc(db, "questions", q.id);
      batch.set(qRef, q, { merge: true });
    }

    await withTimeout(batch.commit(), 5000);
  } catch (err) {
    console.warn("[Firestore Sync] Could not sync deck to cloud:", err);
  }
}

/**
 * Saves a newly generated deck and all its questions to LocalStorage immediately,
 * and syncs to shared Cloud Firestore so everyone accessing the app can revise it.
 */
export async function saveGeneratedDeck(params: {
  userId: string;
  payload: GeneratedDeckPayload;
  sourceFileName: string;
  sourceType: "pdf" | "text" | "sample" | "json" | "csv";
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

  // 2. Sync to shared Firestore so all students (even before signing in) can access the deck
  await syncDeckAndQuestionsToFirestore(deck, questions);

  return { deck, questions };
}

/**
 * Lists all saved decks available in the app (both shared community decks from Firestore
 * and any locally saved decks on this device) so everyone who accesses the app can revise them
 * even before signing in.
 */
export async function listUserDecks(_userId?: string): Promise<DeckRecord[]> {
  const localDecks = readLocalJson<DeckRecord[]>(LOCAL_DECKS_KEY, []);
  const localQuestionsMap = readLocalJson<Record<string, QuestionRecord[]>>(
    LOCAL_QUESTIONS_KEY,
    {}
  );

  const db = getFirebaseDb();
  if (db) {
    try {
      const q = query(
        collection(db, "decks"),
        orderBy("createdAt", "desc"),
        limit(100)
      );
      const snap = await withTimeout(getDocs(q), 6000);
      if (snap) {
        const remoteDecks: DeckRecord[] = [];
        const remoteIds = new Set<string>();
        snap.forEach((docSnap) => {
          const d = docSnap.data() as DeckRecord;
          remoteDecks.push(d);
          remoteIds.add(d.id);
        });

        // Background-backfill any locally created decks that aren't in Firestore yet
        for (const localDeck of localDecks) {
          if (!remoteIds.has(localDeck.id)) {
            const qs = localQuestionsMap[localDeck.id] ?? [];
            syncDeckAndQuestionsToFirestore(localDeck, qs).catch(() => {});
          }
        }

        if (remoteDecks.length > 0 || localDecks.length > 0) {
          const mergedMap = new Map<string, DeckRecord>();
          for (const d of [...remoteDecks, ...localDecks]) {
            if (!mergedMap.has(d.id)) {
              mergedMap.set(d.id, d);
            }
          }
          const combined = Array.from(mergedMap.values()).sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt)
          );
          writeLocalJson(LOCAL_DECKS_KEY, combined);
          return combined;
        }
      }
    } catch {
      // Return local decks if remote query fails
    }
  }

  return localDecks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Loads a single deck and its questions.
 * Any user (guest or signed-in) can read and revise any saved deck.
 */
export async function getDeckWithQuestions(
  _userId: string,
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
  if ((!deck || questions.length === 0) && db) {
    try {
      if (!deck) {
        const deckSnap = await withTimeout(
          getDoc(doc(db, "decks", deckId)),
          6000
        );
        if (deckSnap && deckSnap.exists()) {
          deck = deckSnap.data() as DeckRecord;
        }
      }

      if (questions.length === 0) {
        const qQuery = query(
          collection(db, "questions"),
          where("deckId", "==", deckId)
        );
        const qSnap = await withTimeout(getDocs(qQuery), 6000);
        if (qSnap) {
          const remoteQuestions: QuestionRecord[] = [];
          qSnap.forEach((s) => remoteQuestions.push(s.data() as QuestionRecord));
          if (remoteQuestions.length > 0) {
            questions = remoteQuestions.sort((a, b) => a.order - b.order);
            localQuestionsMap[deckId] = questions;
            writeLocalJson(LOCAL_QUESTIONS_KEY, localQuestionsMap);
          }
        }
      }
    } catch {
      // Fallback to local
    }
  }

  if (!deck) return null;

  return {
    deck,
    questions: questions.sort((a, b) => a.order - b.order),
  };
}

/**
 * Deletes a deck, its questions, and the current user's study session.
 * Enforces ownership so only the creator of a deck can delete it.
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

  // Sync deletion to Firestore in background if owned by the current user
  const db = getFirebaseDb();
  if (db) {
    deleteDoc(doc(db, "decks", deckId)).catch(() => {});
  }
}

/**
 * Loads the PERSONAL active or most recent study session for a specific user and deck.
 * Keyed strictly by `${userId}_${deckId}` so every student has their own independent progress.
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
 * Persists PERSONAL study session progress immediately to LocalStorage and syncs to Firestore in the background.
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
 * Records PERSONAL per-question historical attempt statistics in userQuestionProgress (keyed by `${userId}_${questionId}`).
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
 * Migrates any guest decks and personal study sessions to a permanent user account upon sign-in/registration.
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
  const db = getFirebaseDb();
  for (const key of Object.keys(localSessions)) {
    const sess = localSessions[key];
    if (sess.userId === guestId) {
      const newKey = `${newUserId}_${sess.deckId}`;
      const updatedSess: StudySessionRecord = {
        ...sess,
        id: newKey,
        userId: newUserId,
      };
      localSessions[newKey] = updatedSess;
      delete localSessions[key];

      if (db && !newUserId.startsWith("guest_")) {
        setDoc(
          doc(db, "studySessions", newKey),
          sanitizeForFirestore(updatedSess),
          { merge: true }
        ).catch(() => {});
      }
    }
  }
  writeLocalJson(LOCAL_SESSIONS_KEY, localSessions);
}
