import { z } from "zod";

export const OptionIdSchema = z.enum(["A", "B", "C", "D"]);
export type OptionId = z.infer<typeof OptionIdSchema>;

export const QuestionOptionSchema = z.object({
  id: OptionIdSchema,
  text: z.string().trim().min(1, "Option text must not be empty"),
});
export type QuestionOption = z.infer<typeof QuestionOptionSchema>;

export const DifficultySchema = z.enum(["easy", "medium", "hard"]);
export type Difficulty = z.infer<typeof DifficultySchema>;

export const CognitiveLevelSchema = z
  .enum(["remembering", "understanding", "application", "analysis"])
  .optional()
  .default("understanding");
export type CognitiveLevel = z.infer<typeof CognitiveLevelSchema>;

export const SourceReferenceSchema = z.object({
  page: z.number().int().positive().nullable().optional(),
  section: z.string().trim().min(1).nullable().optional(),
});
export type SourceReference = z.infer<typeof SourceReferenceSchema>;

export const TopicItemSchema = z.object({
  name: z.string().trim().min(1, "Topic name is required"),
  subtopics: z.array(z.string().trim().min(1)).default([]),
  coverageNotes: z.string().trim().default("Core concepts and definitions."),
  targetQuestionCount: z.number().int().min(0).max(50).optional(),
  sourcePagesOrSections: z.string().nullable().optional(),
});
export type TopicItem = z.infer<typeof TopicItemSchema>;

export const GeneratedQuestionSchema = z
  .object({
    question: z.string().trim().min(10, "Question must be at least 10 characters"),
    options: z
      .array(QuestionOptionSchema)
      .length(4, "Every question must have exactly 4 answer options"),
    correctOptionId: OptionIdSchema,
    explanation: z
      .string()
      .trim()
      .min(10, "Explanation must be at least 10 characters"),
    topic: z.string().trim().min(2, "Topic is required"),
    subtopic: z.string().trim().optional().nullable(),
    difficulty: DifficultySchema,
    cognitiveLevel: CognitiveLevelSchema,
    sourceReference: SourceReferenceSchema.default({ page: null, section: null }),
    learningObjective: z
      .string()
      .trim()
      .min(5, "Learning objective is required"),
  })
  .superRefine((val, ctx) => {
    // 1. Validate option IDs are A, B, C, D and distinct
    const ids = val.options.map((o) => o.id);
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== 4) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Question options must have 4 distinct IDs (A, B, C, D)",
        path: ["options"],
      });
    }

    // 2. Validate correctOptionId exists among options
    if (!uniqueIds.has(val.correctOptionId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `correctOptionId '${val.correctOptionId}' does not exist in options`,
        path: ["correctOptionId"],
      });
    }

    // 3. Validate option texts are distinct (case-insensitive)
    const normalizedTexts = val.options.map((o) =>
      o.text.trim().toLowerCase().replace(/\s+/g, " ")
    );
    const uniqueTexts = new Set(normalizedTexts);
    if (uniqueTexts.size !== 4) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Every question must have four distinct option texts",
        path: ["options"],
      });
    }
  });

export type GeneratedQuestion = z.infer<typeof GeneratedQuestionSchema>;

export const DocumentAnalysisSchema = z.object({
  isSufficientMaterial: z.boolean().default(true),
  insufficientReason: z.string().optional().nullable(),
  deckTitle: z.string().trim().default("Exam Revision Deck"),
  subject: z.string().trim().default("General Studies"),
  mainPurpose: z.string().trim().default("Examination revision material"),
  description: z
    .string()
    .trim()
    .default("A revision deck generated from your uploaded study material."),
  estimatedMaterialLength: z
    .enum(["short", "medium", "long"])
    .optional()
    .default("short"),
  recommendedQuestionCount: z.number().int().min(0).max(100).default(10),
  keyDefinitions: z.array(z.string()).default([]),
  corePrinciplesAndProcesses: z.array(z.string()).default([]),
  visualsTablesDiagramsNotes: z.array(z.string()).default([]),
  topics: z.array(TopicItemSchema).default([]),
});

export type DocumentAnalysis = z.infer<typeof DocumentAnalysisSchema>;

export const GeneratedDeckPayloadSchema = z.object({
  deckTitle: z.string().trim().min(3, "Deck title is required"),
  subject: z.string().trim().min(2, "Subject is required"),
  description: z.string().trim().min(10, "Description is required"),
  topics: z.array(TopicItemSchema).min(1, "At least one topic is required"),
  questions: z
    .array(GeneratedQuestionSchema)
    .min(1, "At least one valid question is required"),
});

export type GeneratedDeckPayload = z.infer<typeof GeneratedDeckPayloadSchema>;
