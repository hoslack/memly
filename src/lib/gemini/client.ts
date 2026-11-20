import { GoogleGenAI, Type, Schema } from "@google/genai";

/**
 * Default Gemini Flash model suitable for high-speed document understanding,
 * multimodal PDF reading, reasoning, and structured JSON output.
 * Configurable via server-side GEMINI_MODEL environment variable.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
export const FALLBACK_GEMINI_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
];

export function getGeminiModelName(): string {
  const configured = process.env.GEMINI_MODEL?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_GEMINI_MODEL;
}

export function getCandidateGeminiModels(): string[] {
  const primary = getGeminiModelName();
  const list = [primary, ...FALLBACK_GEMINI_MODELS];
  return Array.from(new Set(list));
}

/**
 * Returns an initialized GoogleGenAI server-side client.
 * Reads strictly from process.env.GEMINI_API_KEY.
 */
export function getGeminiClient(): GoogleGenAI {
  if (typeof window !== "undefined") {
    throw new Error(
      "SECURITY VIOLATION: Gemini client must never be instantiated in the browser."
    );
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === "your_gemini_api_key_here") {
    throw new GeminiConfigurationError(
      "GEMINI_API_KEY is not configured on the server. Add your Gemini API key to .env.local to generate AI revision decks."
    );
  }

  return new GoogleGenAI({ apiKey });
}

export class GeminiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiConfigurationError";
  }
}

export class InsufficientMaterialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientMaterialError";
  }
}

/**
 * Retries a transient Gemini operation with exponential backoff.
 */
export async function withGeminiRetry<T>(
  operationName: string,
  fn: () => Promise<T>,
  maxRetries = 2,
  initialDelayMs = 1200
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      if (
        err instanceof GeminiConfigurationError ||
        err instanceof InsufficientMaterialError
      ) {
        throw err;
      }

      const errMsg = err instanceof Error ? err.message : String(err);
      const isNonRetryable =
        errMsg.includes("API_KEY_INVALID") ||
        errMsg.includes("PERMISSION_DENIED") ||
        errMsg.includes("INVALID_ARGUMENT");

      if (isNonRetryable || attempt === maxRetries) {
        break;
      }

      const delay = initialDelayMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${operationName} failed after ${maxRetries + 1} attempts.`);
}

/**
 * Structured output schema for Stage 1 Document Analysis using @google/genai Type definitions.
 */
export const GEMINI_DOCUMENT_ANALYSIS_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    isSufficientMaterial: {
      type: Type.BOOLEAN,
      description:
        "True if the supplied document contains meaningful educational content suitable for examination questions.",
    },
    insufficientReason: {
      type: Type.STRING,
      nullable: true,
      description:
        "If isSufficientMaterial is false, explain clearly why questions cannot be generated.",
    },
    deckTitle: {
      type: Type.STRING,
      description: "Concise, descriptive title for the revision deck.",
    },
    subject: {
      type: Type.STRING,
      description: "Academic subject or discipline (e.g., Computer Science, Biology, History).",
    },
    mainPurpose: {
      type: Type.STRING,
      description: "Primary educational purpose and scope of the document.",
    },
    description: {
      type: Type.STRING,
      description: "Brief 1-2 sentence overview of what this revision deck covers.",
    },
    estimatedMaterialLength: {
      type: Type.STRING,
      enum: ["short", "medium", "long"],
      description: "Estimated depth and length of the learning material.",
    },
    recommendedQuestionCount: {
      type: Type.INTEGER,
      description:
        "Recommended number of multiple-choice questions to thoroughly test the material (typically 10-15 for short, 20-35 for medium, 35-60 for long).",
    },
    keyDefinitions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Important definitions and terminology identified across the document.",
    },
    corePrinciplesAndProcesses: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Key principles, mechanisms, processes, comparisons, and relationships.",
    },
    visualsTablesDiagramsNotes: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Examinable takeaways from tables, figures, charts, or diagrams.",
    },
    topics: {
      type: Type.ARRAY,
      description: "Comprehensive topic coverage plan distributed across the entire document.",
      items: {
        type: Type.OBJECT,
        properties: {
          name: {
            type: Type.STRING,
            description: "Name of the major topic.",
          },
          subtopics: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Specific subtopics and concepts within this major topic.",
          },
          coverageNotes: {
            type: Type.STRING,
            description: "What aspects of this topic should be tested in the exam questions.",
          },
          targetQuestionCount: {
            type: Type.INTEGER,
            description: "Target number of questions to allocate to this topic.",
          },
          sourcePagesOrSections: {
            type: Type.STRING,
            description: "Page numbers or section headings where this topic appears.",
          },
        },
        required: ["name", "subtopics", "coverageNotes", "targetQuestionCount"],
      },
    },
  },
  required: [
    "isSufficientMaterial",
    "deckTitle",
    "subject",
    "mainPurpose",
    "description",
    "estimatedMaterialLength",
    "recommendedQuestionCount",
    "keyDefinitions",
    "corePrinciplesAndProcesses",
    "visualsTablesDiagramsNotes",
    "topics",
  ],
};

/**
 * Structured output schema for Stage 2 Question Generation using @google/genai Type definitions.
 */
export const GEMINI_QUESTIONS_BATCH_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    questions: {
      type: Type.ARRAY,
      description: "List of multiple-choice examination questions.",
      items: {
        type: Type.OBJECT,
        properties: {
          question: {
            type: Type.STRING,
            description: "Clear, unambiguous examination question stem.",
          },
          options: {
            type: Type.ARRAY,
            description: "Exactly four distinct answer options labeled A, B, C, and D.",
            items: {
              type: Type.OBJECT,
              properties: {
                id: {
                  type: Type.STRING,
                  enum: ["A", "B", "C", "D"],
                },
                text: {
                  type: Type.STRING,
                  description: "Answer option text.",
                },
              },
              required: ["id", "text"],
            },
          },
          correctOptionId: {
            type: Type.STRING,
            enum: ["A", "B", "C", "D"],
            description: "The ID (A, B, C, or D) of the single correct option.",
          },
          explanation: {
            type: Type.STRING,
            description:
              "Clear educational explanation of why the correct answer is right and why distractors are wrong.",
          },
          topic: {
            type: Type.STRING,
            description: "Major topic from the topic coverage plan.",
          },
          subtopic: {
            type: Type.STRING,
            nullable: true,
            description: "Specific subtopic tested.",
          },
          difficulty: {
            type: Type.STRING,
            enum: ["easy", "medium", "hard"],
          },
          cognitiveLevel: {
            type: Type.STRING,
            enum: ["remembering", "understanding", "application", "analysis"],
          },
          sourceReference: {
            type: Type.OBJECT,
            properties: {
              page: {
                type: Type.INTEGER,
                nullable: true,
                description: "Page number where the answer is supported, or null if not paged.",
              },
              section: {
                type: Type.STRING,
                nullable: true,
                description: "Section heading or topic area supporting the answer.",
              },
            },
            required: ["page", "section"],
          },
          learningObjective: {
            type: Type.STRING,
            description:
              "Short learning objective describing what the student should understand.",
          },
        },
        required: [
          "question",
          "options",
          "correctOptionId",
          "explanation",
          "topic",
          "difficulty",
          "cognitiveLevel",
          "sourceReference",
          "learningObjective",
        ],
      },
    },
  },
  required: ["questions"],
};
