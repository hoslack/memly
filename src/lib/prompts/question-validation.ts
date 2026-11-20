/**
 * Dedicated rules and utilities for Stage 3: Question Validation, Deduplication, and Topic Coverage Verification.
 */
import {
  GeneratedQuestion,
  GeneratedQuestionSchema,
  TopicItem,
} from "../schemas/deck";

/**
 * Normalizes a question stem or text for near-duplicate comparison.
 */
export function normalizeTextForDedup(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\b(which|what|how|why|when|where|is|are|the|a|an|of|in|to|for)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Computes Jaccard token similarity between two normalized strings.
 */
export function computeTokenSimilarity(a: string, b: string): number {
  const normA = normalizeTextForDedup(a);
  const normB = normalizeTextForDedup(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;

  const setA = new Set(normA.split(" ").filter((w) => w.length > 2));
  const setB = new Set(normB.split(" ").filter((w) => w.length > 2));
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface QuestionValidationResult {
  validQuestions: GeneratedQuestion[];
  rejectedCount: number;
  duplicateCount: number;
  rejectionReasons: string[];
  coveredTopics: string[];
  uncoveredTopics: string[];
  coverageRatio: number;
}

/**
 * Validates, sanitizes, and deduplicates an array of raw candidate questions,
 * checking four-option integrity, correctOptionId existence, distinct option texts,
 * duplicate stems, and topic coverage.
 */
export function validateAndDeduplicateQuestions(
  rawQuestions: unknown[],
  expectedTopics: TopicItem[] = [],
  similarityThreshold = 0.78
): QuestionValidationResult {
  const validQuestions: GeneratedQuestion[] = [];
  const rejectionReasons: string[] = [];
  let rejectedCount = 0;
  let duplicateCount = 0;

  for (let i = 0; i < rawQuestions.length; i++) {
    const candidate = rawQuestions[i];
    const parsed = GeneratedQuestionSchema.safeParse(candidate);

    if (!parsed.success) {
      rejectedCount++;
      const msg = parsed.error.issues
        .map((iss) => `${iss.path.join(".")}: ${iss.message}`)
        .join("; ");
      rejectionReasons.push(`Question #${i + 1} invalid: ${msg}`);
      continue;
    }

    const q = parsed.data;

    // Ensure options are sorted A, B, C, D consistently
    const orderMap: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
    q.options.sort((a, b) => orderMap[a.id] - orderMap[b.id]);

    // Check against already accepted questions for exact or near-duplicate question stems
    let isDuplicate = false;
    for (const existing of validQuestions) {
      const stemSim = computeTokenSimilarity(q.question, existing.question);
      if (stemSim >= similarityThreshold) {
        // Also check if correct answer text is similar
        const qCorrectText =
          q.options.find((o) => o.id === q.correctOptionId)?.text ?? "";
        const exCorrectText =
          existing.options.find((o) => o.id === existing.correctOptionId)?.text ??
          "";
        const ansSim = computeTokenSimilarity(qCorrectText, exCorrectText);

        if (stemSim >= 0.88 || (stemSim >= similarityThreshold && ansSim >= 0.65)) {
          isDuplicate = true;
          break;
        }
      }
    }

    if (isDuplicate) {
      duplicateCount++;
      rejectionReasons.push(
        `Question #${i + 1} skipped as duplicate: "${q.question.slice(0, 60)}..."`
      );
      continue;
    }

    validQuestions.push(q);
  }

  // Evaluate topic coverage
  const normalizeTopic = (t: string) => t.trim().toLowerCase();
  const questionTopicSet = new Set(
    validQuestions.map((q) => normalizeTopic(q.topic))
  );

  const coveredTopics: string[] = [];
  const uncoveredTopics: string[] = [];

  for (const topic of expectedTopics) {
    const normExpected = normalizeTopic(topic.name);
    const isCovered = Array.from(questionTopicSet).some(
      (qt) =>
        qt === normExpected ||
        qt.includes(normExpected) ||
        normExpected.includes(qt)
    );
    if (isCovered) {
      coveredTopics.push(topic.name);
    } else {
      uncoveredTopics.push(topic.name);
    }
  }

  const coverageRatio =
    expectedTopics.length === 0
      ? 1
      : coveredTopics.length / expectedTopics.length;

  return {
    validQuestions,
    rejectedCount,
    duplicateCount,
    rejectionReasons,
    coveredTopics,
    uncoveredTopics,
    coverageRatio,
  };
}
