import { z } from "zod";
import {
  CognitiveLevel,
  Difficulty,
  OptionId,
  QuestionOption,
  SourceReference,
  TopicItem,
} from "./deck";

export type DeckStatus =
  | "uploading"
  | "analyzing"
  | "generating"
  | "validating"
  | "ready"
  | "failed";

export type AIProviderName = "gemini" | "openrouter" | "sample" | "import";

export interface AIMetadata {
  primaryProvider?: AIProviderName;
  actualProvider?: AIProviderName;
  model?: string;
  modelUsed: string;
  fallbackUsed?: boolean;
  generatedAt?: string;
  tokenCountEstimate?: number;
  contentHash?: string;
  generationDurationMs?: number;
}

export interface DeckRecord {
  id: string;
  userId: string;
  title: string;
  subject: string;
  description: string;
  sourceFileName: string;
  sourceType: "pdf" | "text" | "sample" | "json" | "csv";
  questionCount: number;
  topics: TopicItem[];
  status: DeckStatus;
  aiMetadata?: AIMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface QuestionRecord {
  id: string;
  deckId: string;
  userId: string;
  question: string;
  options: QuestionOption[];
  correctOptionId: OptionId;
  explanation: string;
  topic: string;
  subtopic?: string | null;
  difficulty: Difficulty;
  cognitiveLevel?: CognitiveLevel;
  sourceReference: SourceReference;
  learningObjective: string;
  order: number;
}

export type QuestionSessionStatus = "NEW" | "RETRY" | "COMPLETED";

export interface StudySessionRecord {
  id: string;
  userId: string;
  deckId: string;
  /** Current active queue of question IDs remaining to be answered correctly */
  activeQueue: string[];
  /** Initial randomized order of all question IDs in the session */
  questionOrder: string[];
  /** Question IDs answered correctly */
  completedQuestionIds: string[];
  /** Question IDs that required at least one retry during this session */
  retriedQuestionIds: string[];
  /** Status per question ID: NEW | RETRY | COMPLETED */
  questionStatuses: Record<string, QuestionSessionStatus>;
  /** Number of questions answered correctly on the very first attempt */
  firstAttemptCorrectIds: string[];
  /** Total answer submissions made in this session */
  totalAttempts: number;
  /** Cumulative study time in seconds */
  elapsedSeconds: number;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string | null;
  status: "active" | "completed" | "abandoned";
}

export interface UserQuestionProgressRecord {
  id: string; // `${userId}_${questionId}`
  userId: string;
  questionId: string;
  deckId: string;
  correctAttempts: number;
  incorrectAttempts: number;
  status: QuestionSessionStatus;
  lastAttemptAt: string;
  nextReviewAt: string;
}

export const TextSubmissionSchema = z.object({
  text: z
    .string()
    .trim()
    .min(
      120,
      "Please paste at least 120 characters of meaningful study notes or lecture material so Gemini can generate useful exam questions."
    )
    .max(
      250000,
      "Text exceeds maximum single-paste limit (250,000 characters). Please upload as a PDF or split into smaller chapters."
    ),
  idempotencyKey: z.string().optional(),
});
