import {
  QuestionSessionStatus,
  StudySessionRecord,
} from "../schemas/study";

/**
 * Default number of intermediate questions to show before repeating an incorrectly answered question.
 */
export const DEFAULT_RETRY_GAP = 3;

export interface RevisionQueueState {
  sessionId: string;
  userId: string;
  deckId: string;
  /** The initial randomized order of all questions in the deck */
  questionOrder: string[];
  /** Current active queue of question IDs remaining to be answered correctly */
  activeQueue: string[];
  /** Question IDs that have been answered correctly */
  completedQuestionIds: string[];
  /** Question IDs that were answered incorrectly at least once */
  retriedQuestionIds: string[];
  /** Question IDs that were answered correctly on their very first attempt */
  firstAttemptCorrectIds: string[];
  /** Current status of every question in the session */
  questionStatuses: Record<string, QuestionSessionStatus>;
  /** Total number of answer attempts made during the session */
  totalAttempts: number;
  /** Total elapsed study seconds */
  elapsedSeconds: number;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  status: "active" | "completed" | "abandoned";
}

/**
 * Deterministically or randomly shuffles an array using Fisher-Yates.
 */
export function shuffleQuestionIds(
  ids: string[],
  randomFn: () => number = Math.random
): string[] {
  const copy = [...ids];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(randomFn() * (i + 1));
    const temp = copy[i];
    copy[i] = copy[j];
    copy[j] = temp;
  }
  return copy;
}

/**
 * Creates a brand-new revision session queue with randomized question order.
 */
export function createRevisionQueue(params: {
  sessionId: string;
  userId: string;
  deckId: string;
  questionIds: string[];
  shouldShuffle?: boolean;
  randomFn?: () => number;
}): RevisionQueueState {
  const {
    sessionId,
    userId,
    deckId,
    questionIds,
    shouldShuffle = true,
    randomFn = Math.random,
  } = params;

  if (questionIds.length === 0) {
    throw new Error("Cannot initialize a revision queue with zero questions.");
  }

  const ordered = shouldShuffle
    ? shuffleQuestionIds(questionIds, randomFn)
    : [...questionIds];

  const statuses: Record<string, QuestionSessionStatus> = {};
  for (const id of ordered) {
    statuses[id] = "NEW";
  }

  const now = new Date().toISOString();

  return {
    sessionId,
    userId,
    deckId,
    questionOrder: ordered,
    activeQueue: [...ordered],
    completedQuestionIds: [],
    retriedQuestionIds: [],
    firstAttemptCorrectIds: [],
    questionStatuses: statuses,
    totalAttempts: 0,
    elapsedSeconds: 0,
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    status: "active",
  };
}

/**
 * Returns the current front question ID in the active queue, or null if completed.
 */
export function getCurrentQuestionId(state: RevisionQueueState): string | null {
  if (state.activeQueue.length === 0 || state.status === "completed") {
    return null;
  }
  return state.activeQueue[0];
}

/**
 * Submits an answer for the current question at the head of the active queue.
 *
 * IF CORRECT:
 * - Marks question as COMPLETED
 * - Removes it from the active queue
 * - If it was previously NEW (never failed), records it in firstAttemptCorrectIds
 * - If activeQueue becomes empty, marks the session as "completed"
 *
 * IF INCORRECT:
 * - Marks question as RETRY
 * - Adds question ID to retriedQuestionIds (if not already present)
 * - Reinserts the question near the back of the activeQueue after at least `retryGap` other questions
 *   (or at the end of the queue if fewer than `retryGap` questions remain), so it is never repeated immediately
 *   when other questions exist.
 */
export function recordQueueAnswer(
  state: RevisionQueueState,
  questionId: string,
  isCorrect: boolean,
  retryGap: number = DEFAULT_RETRY_GAP,
  additionalElapsedSeconds = 0
): RevisionQueueState {
  if (state.status === "completed" || state.activeQueue.length === 0) {
    return state;
  }

  const queueWithoutCurrent = state.activeQueue.filter((id) => id !== questionId);
  const previousStatus = state.questionStatuses[questionId] ?? "NEW";
  const now = new Date().toISOString();

  const updatedStatuses: Record<string, QuestionSessionStatus> = {
    ...state.questionStatuses,
  };
  const completedIds = [...state.completedQuestionIds];
  const retriedIds = [...state.retriedQuestionIds];
  const firstAttemptIds = [...state.firstAttemptCorrectIds];
  let nextActiveQueue: string[];

  if (isCorrect) {
    updatedStatuses[questionId] = "COMPLETED";
    if (!completedIds.includes(questionId)) {
      completedIds.push(questionId);
    }
    if (
      previousStatus === "NEW" &&
      !retriedIds.includes(questionId) &&
      !firstAttemptIds.includes(questionId)
    ) {
      firstAttemptIds.push(questionId);
    }
    nextActiveQueue = queueWithoutCurrent;
  } else {
    updatedStatuses[questionId] = "RETRY";
    if (!retriedIds.includes(questionId)) {
      retriedIds.push(questionId);
    }

    // Reinsert after `retryGap` questions, or near the back of the queue
    // Ensure that if there is at least 1 other question, insertIndex >= 1 so it does NOT repeat immediately
    const safeGap = Math.max(1, retryGap);
    const insertIndex = Math.min(safeGap, queueWithoutCurrent.length);

    nextActiveQueue = [
      ...queueWithoutCurrent.slice(0, insertIndex),
      questionId,
      ...queueWithoutCurrent.slice(insertIndex),
    ];
  }

  const isFinished = nextActiveQueue.length === 0;

  return {
    ...state,
    activeQueue: nextActiveQueue,
    completedQuestionIds: completedIds,
    retriedQuestionIds: retriedIds,
    firstAttemptCorrectIds: firstAttemptIds,
    questionStatuses: updatedStatuses,
    totalAttempts: state.totalAttempts + 1,
    elapsedSeconds: state.elapsedSeconds + Math.max(0, additionalElapsedSeconds),
    updatedAt: now,
    finishedAt: isFinished ? now : null,
    status: isFinished ? "completed" : "active",
  };
}

/**
 * Skips the current question (e.g. swipe left) without penalizing the student,
 * rotating it near the back of the active queue so they can return to it later.
 */
export function skipCurrentQuestion(
  state: RevisionQueueState,
  questionId: string,
  skipGap: number = DEFAULT_RETRY_GAP
): RevisionQueueState {
  if (state.status === "completed" || state.activeQueue.length <= 1) {
    return state;
  }

  const remaining = state.activeQueue.filter((id) => id !== questionId);
  const insertIndex = Math.min(Math.max(1, skipGap), remaining.length);
  const nextActiveQueue = [
    ...remaining.slice(0, insertIndex),
    questionId,
    ...remaining.slice(insertIndex),
  ];

  return {
    ...state,
    activeQueue: nextActiveQueue,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Computes human-friendly progress metrics for the Revision UI and Completion Screen.
 */
export function getQueueProgressMetrics(state: RevisionQueueState) {
  const totalQuestions = state.questionOrder.length;
  const completedCount = state.completedQuestionIds.length;
  const remainingCount = state.activeQueue.length;
  const retryCount = state.retriedQuestionIds.length;
  const firstAttemptCorrectCount = state.firstAttemptCorrectIds.length;
  const progressPercentage =
    totalQuestions === 0
      ? 100
      : Math.round((completedCount / totalQuestions) * 100);

  const accuracyPercentage =
    state.totalAttempts === 0
      ? 100
      : Math.round((completedCount / state.totalAttempts) * 100);

  return {
    totalQuestions,
    completedCount,
    remainingCount,
    retryCount,
    firstAttemptCorrectCount,
    totalAttempts: state.totalAttempts,
    progressPercentage,
    accuracyPercentage,
    isCompleted: state.status === "completed" || remainingCount === 0,
  };
}

/**
 * Converts a RevisionQueueState into a StudySessionRecord for Firestore / LocalStorage persistence.
 */
export function serializeQueueToSessionRecord(
  state: RevisionQueueState
): StudySessionRecord {
  return {
    id: state.sessionId,
    userId: state.userId,
    deckId: state.deckId,
    activeQueue: state.activeQueue,
    questionOrder: state.questionOrder,
    completedQuestionIds: state.completedQuestionIds,
    retriedQuestionIds: state.retriedQuestionIds,
    questionStatuses: state.questionStatuses,
    firstAttemptCorrectIds: state.firstAttemptCorrectIds,
    totalAttempts: state.totalAttempts,
    elapsedSeconds: state.elapsedSeconds,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    finishedAt: state.finishedAt,
    status: state.status,
  };
}

/**
 * Restores a RevisionQueueState from a persisted StudySessionRecord.
 */
export function deserializeSessionRecordToQueue(
  record: StudySessionRecord
): RevisionQueueState {
  return {
    sessionId: record.id,
    userId: record.userId,
    deckId: record.deckId,
    activeQueue: record.activeQueue,
    questionOrder: record.questionOrder,
    completedQuestionIds: record.completedQuestionIds,
    retriedQuestionIds: record.retriedQuestionIds || [],
    firstAttemptCorrectIds: record.firstAttemptCorrectIds || [],
    questionStatuses: record.questionStatuses || {},
    totalAttempts: record.totalAttempts || 0,
    elapsedSeconds: record.elapsedSeconds || 0,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    finishedAt: record.finishedAt ?? null,
    status: record.status,
  };
}
