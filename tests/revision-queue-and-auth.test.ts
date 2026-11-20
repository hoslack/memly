import { describe, it, expect } from "vitest";
import {
  createRevisionQueue,
  getCurrentQuestionId,
  recordQueueAnswer,
  skipCurrentQuestion,
  getQueueProgressMetrics,
  serializeQueueToSessionRecord,
  deserializeSessionRecordToQueue,
} from "../src/lib/revision/queue";
import {
  assertResourceOwnership,
  AuthorizationError,
} from "../src/lib/firebase/auth-guard";

describe("Revision Queue Algorithm & Persistence", () => {
  const sampleQuestionIds = ["q1", "q2", "q3", "q4", "q5"];

  it("initializes all questions with NEW status and activeQueue", () => {
    const state = createRevisionQueue({
      sessionId: "sess_1",
      userId: "user_1",
      deckId: "deck_1",
      questionIds: sampleQuestionIds,
      shouldShuffle: false,
    });

    expect(state.activeQueue).toEqual(sampleQuestionIds);
    expect(getCurrentQuestionId(state)).toBe("q1");
    expect(state.questionStatuses["q1"]).toBe("NEW");
    expect(state.status).toBe("active");
  });

  it("marks a correctly answered question as COMPLETED and removes it from activeQueue", () => {
    let state = createRevisionQueue({
      sessionId: "sess_1",
      userId: "user_1",
      deckId: "deck_1",
      questionIds: sampleQuestionIds,
      shouldShuffle: false,
    });

    state = recordQueueAnswer(state, "q1", true, 3, 5);

    expect(state.questionStatuses["q1"]).toBe("COMPLETED");
    expect(state.completedQuestionIds).toContain("q1");
    expect(state.firstAttemptCorrectIds).toContain("q1");
    expect(state.activeQueue).not.toContain("q1");
    expect(getCurrentQuestionId(state)).toBe("q2");
  });

  it("marks an incorrectly answered question as RETRY and reinserts it after retryGap questions (never immediately)", () => {
    let state = createRevisionQueue({
      sessionId: "sess_1",
      userId: "user_1",
      deckId: "deck_1",
      questionIds: sampleQuestionIds,
      shouldShuffle: false,
    });

    // Fail q1 with retryGap = 3
    state = recordQueueAnswer(state, "q1", false, 3, 4);

    expect(state.questionStatuses["q1"]).toBe("RETRY");
    expect(state.retriedQuestionIds).toContain("q1");
    expect(state.completedQuestionIds).not.toContain("q1");
    // Next question must be q2, NOT q1
    expect(getCurrentQuestionId(state)).toBe("q2");
    // q1 should be reinserted at index 3 (after q2, q3, q4)
    expect(state.activeQueue).toEqual(["q2", "q3", "q4", "q1", "q5"]);
  });

  it("requires every question (including retried ones) to be answered correctly before completing the session", () => {
    let state = createRevisionQueue({
      sessionId: "sess_1",
      userId: "user_1",
      deckId: "deck_1",
      questionIds: ["q1", "q2"],
      shouldShuffle: false,
    });

    // Answer q1 wrong -> activeQueue becomes ["q2", "q1"]
    state = recordQueueAnswer(state, "q1", false, 3, 2);
    expect(state.activeQueue).toEqual(["q2", "q1"]);
    expect(state.status).toBe("active");

    // Answer q2 right -> activeQueue becomes ["q1"]
    state = recordQueueAnswer(state, "q2", true, 3, 3);
    expect(state.activeQueue).toEqual(["q1"]);
    expect(state.status).toBe("active");

    // Finally answer q1 right -> session completes
    state = recordQueueAnswer(state, "q1", true, 3, 3);
    expect(state.activeQueue).toHaveLength(0);
    expect(state.status).toBe("completed");

    const metrics = getQueueProgressMetrics(state);
    expect(metrics.isCompleted).toBe(true);
    expect(metrics.completedCount).toBe(2);
    expect(metrics.firstAttemptCorrectCount).toBe(1); // Only q2 was first-attempt correct
    expect(metrics.retryCount).toBe(1); // q1 needed a retry
    expect(metrics.totalAttempts).toBe(3);
  });

  it("allows skipping a question to return to it later without marking it completed", () => {
    let state = createRevisionQueue({
      sessionId: "sess_1",
      userId: "user_1",
      deckId: "deck_1",
      questionIds: ["q1", "q2", "q3"],
      shouldShuffle: false,
    });

    state = skipCurrentQuestion(state, "q1", 2);
    expect(getCurrentQuestionId(state)).toBe("q2");
    expect(state.activeQueue).toContain("q1");
    expect(state.completedQuestionIds).toHaveLength(0);
  });

  it("serializes and deserializes session progress losslessly", () => {
    let state = createRevisionQueue({
      sessionId: "sess_persist",
      userId: "user_42",
      deckId: "deck_99",
      questionIds: ["q1", "q2", "q3"],
      shouldShuffle: false,
    });
    state = recordQueueAnswer(state, "q1", true, 2, 10);

    const record = serializeQueueToSessionRecord(state);
    const restored = deserializeSessionRecordToQueue(record);

    expect(restored).toEqual(state);
  });
});

describe("Firebase Resource Ownership & Authorization Guard", () => {
  it("allows access when authenticated userId matches resource owner", () => {
    const deck = { id: "deck_1", userId: "student_123", title: "Biology" };
    expect(assertResourceOwnership("student_123", deck, "Deck")).toEqual(deck);
  });

  it("throws 403 AuthorizationError when another user attempts to access a private deck", () => {
    const deck = { id: "deck_1", userId: "student_123", title: "Biology" };
    expect(() =>
      assertResourceOwnership("intruder_999", deck, "Deck")
    ).toThrow(AuthorizationError);
  });

  it("throws 401 AuthorizationError when userId is missing", () => {
    const deck = { id: "deck_1", userId: "student_123", title: "Biology" };
    expect(() => assertResourceOwnership(null, deck, "Deck")).toThrow(
      /Authentication required/i
    );
  });
});
