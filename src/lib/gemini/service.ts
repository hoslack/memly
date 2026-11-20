import crypto from "crypto";
import { createPartFromUri, createPartFromBase64, Part } from "@google/genai";
import {
  getGeminiClient,
  getGeminiModelName,
  getCandidateGeminiModels,
  withGeminiRetry,
  GEMINI_DOCUMENT_ANALYSIS_SCHEMA,
  GEMINI_QUESTIONS_BATCH_SCHEMA,
  InsufficientMaterialError,
} from "./client";
import {
  INLINE_PDF_THRESHOLD_BYTES,
  validateAndPreparePdf,
} from "./pdf-processor";
import {
  DOCUMENT_ANALYSIS_SYSTEM_INSTRUCTION,
  buildDocumentAnalysisPrompt,
} from "../prompts/document-analysis";
import { buildTopicConsolidationPrompt } from "../prompts/topic-extraction";
import {
  QUESTION_GENERATION_SYSTEM_INSTRUCTION,
  buildQuestionGenerationPrompt,
} from "../prompts/question-generation";
import { validateAndDeduplicateQuestions } from "../prompts/question-validation";
import {
  DocumentAnalysis,
  DocumentAnalysisSchema,
  GeneratedDeckPayload,
  GeneratedDeckPayloadSchema,
  GeneratedQuestion,
  TopicItem,
} from "../schemas/deck";

export type GenerationStageCallback = (
  stage:
    | "uploading"
    | "analyzing"
    | "topics"
    | "generating"
    | "validating"
    | "preparing",
  detail?: string
) => void;

export interface GenerateDeckResult {
  payload: GeneratedDeckPayload;
  modelUsed: string;
  contentHash: string;
  generationDurationMs: number;
}

// In-memory LRU cache to avoid charging/regenerating identical material within the same server instance
const generationCache = new Map<
  string,
  { timestamp: number; result: GenerateDeckResult }
>();
const CACHE_TTL_MS = 1000 * 60 * 30; // 30 minutes

// In-flight idempotency map so accidental double-clicks share the same promise
const inFlightJobs = new Map<string, Promise<GenerateDeckResult>>();

export function computeContentHash(input: Buffer | string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * Helper to upload a PDF section to Gemini Files API when large, or inline base64 when smaller,
 * returning both the Gemini Part and an optional cleanup function.
 */
async function preparePdfPartForGemini(
  buffer: Buffer,
  displayName: string
): Promise<{ part: Part; cleanup: () => Promise<void> }> {
  const ai = getGeminiClient();

  if (buffer.byteLength <= INLINE_PDF_THRESHOLD_BYTES) {
    const base64Data = buffer.toString("base64");
    const part = createPartFromBase64(base64Data, "application/pdf");
    return {
      part,
      cleanup: async () => {},
    };
  }

  // Use Gemini Files API for larger PDFs
  const blob = new Blob([new Uint8Array(buffer)], { type: "application/pdf" });
  const uploadedFile = await withGeminiRetry("Gemini Files API upload", () =>
    ai.files.upload({
      file: blob,
      config: {
        mimeType: "application/pdf",
        displayName,
      },
    })
  );

  if (!uploadedFile.uri || !uploadedFile.name) {
    throw new Error("Gemini Files API did not return a valid file URI.");
  }

  // Wait briefly if file state is PROCESSING
  let fileState = uploadedFile.state;
  let pollAttempts = 0;
  while (fileState === "PROCESSING" && pollAttempts < 15) {
    await new Promise((r) => setTimeout(r, 1500));
    const check = await ai.files.get({ name: uploadedFile.name });
    fileState = check.state;
    pollAttempts++;
  }

  if (fileState === "FAILED") {
    throw new Error("Gemini Files API failed to process the uploaded PDF.");
  }

  const part = createPartFromUri(
    uploadedFile.uri,
    uploadedFile.mimeType || "application/pdf"
  );

  const fileNameToDelete = uploadedFile.name;
  return {
    part,
    cleanup: async () => {
      try {
        await ai.files.delete({ name: fileNameToDelete });
      } catch {
        // Ignore cleanup errors on temporary Gemini file resource
      }
    },
  };
}

/**
 * Executes generateContent with automatic model fallback if the primary model experiences 503/404 demand spikes.
 */
async function generateStructuredContentWithFallback(params: {
  operationName: string;
  contents: Array<Part | { text: string }>;
  systemInstruction: string;
  responseSchema?: typeof GEMINI_DOCUMENT_ANALYSIS_SCHEMA;
  temperature: number;
}): Promise<{ text: string; modelUsed: string }> {
  const ai = getGeminiClient();
  const candidates = getCandidateGeminiModels();
  let lastErr: unknown;

  for (const modelName of candidates) {
    try {
      const response = await withGeminiRetry(
        `${params.operationName} (${modelName})`,
        () =>
          ai.models.generateContent({
            model: modelName,
            contents: params.contents,
            config: {
              systemInstruction: params.systemInstruction,
              responseMimeType: "application/json",
              temperature: params.temperature,
            },
          }),
        1,
        1000
      );

      if (response.text) {
        return { text: response.text, modelUsed: modelName };
      }
    } catch (err: unknown) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isModelUnavailable =
        msg.includes("503") ||
        msg.includes("UNAVAILABLE") ||
        msg.includes("404") ||
        msg.includes("NOT_FOUND") ||
        msg.includes("high demand") ||
        msg.includes("fetch failed") ||
        msg.includes("TIMEOUT");
      if (!isModelUnavailable) {
        throw err;
      }
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error(`${params.operationName} failed across all candidate models.`);
}

/**
 * Stage 1: Understand the document & build a Topic Coverage Plan.
 */
export async function analyzeDocumentContent(
  contentParts: Part[],
  context?: { fileName?: string; pageRangeLabel?: string; totalPages?: number }
): Promise<DocumentAnalysis> {
  const promptText = buildDocumentAnalysisPrompt(context);

  const response = await generateStructuredContentWithFallback({
    operationName: "Stage 1 Document Analysis",
    contents: [...contentParts, { text: promptText }],
    systemInstruction: DOCUMENT_ANALYSIS_SYSTEM_INSTRUCTION,
    responseSchema: GEMINI_DOCUMENT_ANALYSIS_SCHEMA,
    temperature: 0.2,
  });

  const rawText = response.text;
  if (!rawText) {
    throw new Error("Gemini returned an empty response during document analysis.");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    throw new Error("Failed to parse structured JSON from Gemini document analysis.");
  }

  const validated = DocumentAnalysisSchema.parse(parsedJson);

  if (!validated.isSufficientMaterial || validated.topics.length === 0) {
    throw new InsufficientMaterialError(
      validated.insufficientReason ||
        "The supplied material does not contain enough clear educational content to generate reliable exam questions."
    );
  }

  // Clamp recommendedQuestionCount to sensible bounds [5, 60] for sufficient material
  validated.recommendedQuestionCount = Math.max(
    5,
    Math.min(60, validated.recommendedQuestionCount || 10)
  );

  return validated;
}

/**
 * Consolidates multiple section analyses for large multi-section documents.
 */
async function consolidateSectionAnalyses(
  sectionAnalyses: DocumentAnalysis[]
): Promise<DocumentAnalysis> {
  if (sectionAnalyses.length === 1) {
    return sectionAnalyses[0];
  }

  const prompt = buildTopicConsolidationPrompt(sectionAnalyses);

  const response = await generateStructuredContentWithFallback({
    operationName: "Topic Inventory Consolidation",
    contents: [{ text: prompt }],
    systemInstruction: DOCUMENT_ANALYSIS_SYSTEM_INSTRUCTION,
    responseSchema: GEMINI_DOCUMENT_ANALYSIS_SCHEMA,
    temperature: 0.2,
  });

  const rawText = response.text;
  if (!rawText) {
    return sectionAnalyses[0];
  }

  return DocumentAnalysisSchema.parse(JSON.parse(rawText));
}

/**
 * Stage 2: Generate structured multiple-choice examination questions for the given material and topic plan.
 */
export async function generateQuestionsForMaterial(params: {
  contentParts: Part[];
  analysis: DocumentAnalysis;
  targetTopics?: TopicItem[];
  targetQuestionCount?: number;
  existingQuestionStems?: string[];
  sectionContext?: string;
}): Promise<unknown[]> {
  const promptText = buildQuestionGenerationPrompt({
    analysis: params.analysis,
    targetTopics: params.targetTopics,
    targetQuestionCount: params.targetQuestionCount,
    existingQuestionStems: params.existingQuestionStems,
    sectionContext: params.sectionContext,
  });

  const response = await generateStructuredContentWithFallback({
    operationName: "Stage 2 Question Generation",
    contents: [...params.contentParts, { text: promptText }],
    systemInstruction: QUESTION_GENERATION_SYSTEM_INSTRUCTION,
    responseSchema: GEMINI_QUESTIONS_BATCH_SCHEMA,
    temperature: 0.35,
  });

  const rawText = response.text;
  if (!rawText) {
    throw new Error("Gemini returned an empty response during question generation.");
  }

  let parsedJson: { questions?: unknown[] };
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    throw new Error("Failed to parse structured JSON from Gemini question generation.");
  }

  if (!Array.isArray(parsedJson?.questions)) {
    throw new Error("Gemini response did not contain a questions array.");
  }

  return parsedJson.questions;
}

/**
 * Complete pipeline for generating an Exam Revision Deck from a PDF Buffer.
 */
export async function generateDeckFromPdf(
  pdfBuffer: Buffer,
  fileName: string,
  idempotencyKey?: string,
  onStage?: GenerationStageCallback
): Promise<GenerateDeckResult> {
  const contentHash = computeContentHash(pdfBuffer);
  const jobKey = idempotencyKey || `pdf_${contentHash}`;

  // Check cache first
  const cached = generationCache.get(contentHash);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.result;
  }

  // Check in-flight idempotency
  const existingJob = inFlightJobs.get(jobKey);
  if (existingJob) {
    return existingJob;
  }

  const jobPromise = (async (): Promise<GenerateDeckResult> => {
    const startTime = Date.now();
    onStage?.("uploading", "Validating PDF integrity and structure...");

    const pdfInfo = await validateAndPreparePdf(
      pdfBuffer,
      fileName,
      "application/pdf"
    );

    const cleanups: Array<() => Promise<void>> = [];

    try {
      onStage?.(
        "analyzing",
        `Reading and analysing ${pdfInfo.pageCount}-page document...`
      );

      const sectionParts: Part[] = [];
      const sectionAnalyses: DocumentAnalysis[] = [];

      for (const section of pdfInfo.sections) {
        const rangeLabel =
          pdfInfo.sections.length > 1
            ? `Pages ${section.startPage} to ${section.endPage} of ${pdfInfo.pageCount}`
            : `Pages 1 to ${pdfInfo.pageCount}`;

        const { part, cleanup } = await preparePdfPartForGemini(
          section.buffer,
          `${fileName} (${rangeLabel})`
        );
        cleanups.push(cleanup);
        sectionParts.push(part);

        const analysis = await analyzeDocumentContent([part], {
          fileName,
          pageRangeLabel: rangeLabel,
          totalPages: pdfInfo.pageCount,
        });
        sectionAnalyses.push(analysis);
      }

      onStage?.("topics", "Building consolidated topic coverage plan...");
      const unifiedAnalysis = await consolidateSectionAnalyses(sectionAnalyses);

      onStage?.(
        "generating",
        `Creating examination questions across ${unifiedAnalysis.topics.length} topics...`
      );

      let allRawQuestions: unknown[] = [];
      const collectedStems: string[] = [];

      if (pdfInfo.sections.length === 1) {
        const rawBatch = await generateQuestionsForMaterial({
          contentParts: [sectionParts[0]],
          analysis: unifiedAnalysis,
          targetQuestionCount: unifiedAnalysis.recommendedQuestionCount,
        });
        allRawQuestions.push(...rawBatch);
      } else {
        // Multi-section generation for large PDFs
        for (let i = 0; i < pdfInfo.sections.length; i++) {
          const section = pdfInfo.sections[i];
          const secAnalysis = sectionAnalyses[i];
          const rangeLabel = `Pages ${section.startPage}-${section.endPage}`;

          const rawBatch = await generateQuestionsForMaterial({
            contentParts: [sectionParts[i]],
            analysis: unifiedAnalysis,
            targetTopics: secAnalysis.topics,
            targetQuestionCount: Math.max(
              8,
              Math.min(25, secAnalysis.recommendedQuestionCount)
            ),
            existingQuestionStems: collectedStems,
            sectionContext: rangeLabel,
          });

          allRawQuestions.push(...rawBatch);
          for (const q of rawBatch) {
            if (
              q &&
              typeof q === "object" &&
              "question" in q &&
              typeof (q as { question: unknown }).question === "string"
            ) {
              collectedStems.push((q as { question: string }).question);
            }
          }
        }
      }

      onStage?.(
        "validating",
        "Checking questions, answers, distractors, and topic coverage..."
      );

      let validation = validateAndDeduplicateQuestions(
        allRawQuestions,
        unifiedAnalysis.topics
      );

      // If any topics were uncovered and we have a single-section doc, perform a targeted top-up pass
      if (
        validation.uncoveredTopics.length > 0 &&
        validation.coverageRatio < 0.75 &&
        sectionParts.length > 0
      ) {
        const missingTopicItems = unifiedAnalysis.topics.filter((t) =>
          validation.uncoveredTopics.includes(t.name)
        );
        if (missingTopicItems.length > 0) {
          const topUpRaw = await generateQuestionsForMaterial({
            contentParts: [sectionParts[0]],
            analysis: unifiedAnalysis,
            targetTopics: missingTopicItems,
            targetQuestionCount: missingTopicItems.length * 2,
            existingQuestionStems: validation.validQuestions.map(
              (q) => q.question
            ),
          });
          allRawQuestions = [...validation.validQuestions, ...topUpRaw];
          validation = validateAndDeduplicateQuestions(
            allRawQuestions,
            unifiedAnalysis.topics
          );
        }
      }

      if (validation.validQuestions.length === 0) {
        throw new Error(
          "No valid multiple-choice questions could be verified from the document. Please try uploading clearer study notes."
        );
      }

      onStage?.("preparing", "Preparing your revision deck...");

      const payload: GeneratedDeckPayload = GeneratedDeckPayloadSchema.parse({
        deckTitle: unifiedAnalysis.deckTitle,
        subject: unifiedAnalysis.subject,
        description: unifiedAnalysis.description,
        topics: unifiedAnalysis.topics,
        questions: validation.validQuestions,
      });

      const result: GenerateDeckResult = {
        payload,
        modelUsed: getGeminiModelName(),
        contentHash,
        generationDurationMs: Date.now() - startTime,
      };

      generationCache.set(contentHash, {
        timestamp: Date.now(),
        result,
      });

      return result;
    } finally {
      await Promise.allSettled(cleanups.map((fn) => fn()));
    }
  })();

  inFlightJobs.set(jobKey, jobPromise);
  try {
    return await jobPromise;
  } finally {
    inFlightJobs.delete(jobKey);
  }
}

/**
 * Complete pipeline for generating an Exam Revision Deck from Pasted Text.
 */
export async function generateDeckFromText(
  rawText: string,
  idempotencyKey?: string,
  onStage?: GenerationStageCallback
): Promise<GenerateDeckResult> {
  const cleanedText = rawText.trim();

  // Basic heuristic validation before calling Gemini
  const words = cleanedText.split(/\s+/).filter((w) => w.length > 1);
  if (cleanedText.length < 120 || words.length < 25) {
    throw new InsufficientMaterialError(
      "The pasted text is too short to generate a meaningful exam revision deck. Please paste at least a paragraph or page of study notes (minimum 25 words)."
    );
  }

  // Check that it's not just repeated characters or gibberish
  const uniqueWords = new Set(words.map((w) => w.toLowerCase()));
  if (uniqueWords.size < 12) {
    throw new InsufficientMaterialError(
      "The pasted text does not contain enough distinct concepts or educational vocabulary to create useful revision questions."
    );
  }

  const contentHash = computeContentHash(cleanedText);
  const jobKey = idempotencyKey || `text_${contentHash}`;

  const cached = generationCache.get(contentHash);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.result;
  }

  const existingJob = inFlightJobs.get(jobKey);
  if (existingJob) {
    return existingJob;
  }

  const jobPromise = (async (): Promise<GenerateDeckResult> => {
    const startTime = Date.now();

    onStage?.("analyzing", "Reading and analysing your study notes...");

    // Split text into logical chunks if very large (> 45,000 chars)
    const MAX_CHARS_PER_SECTION = 45000;
    const textSections: string[] = [];

    if (cleanedText.length <= MAX_CHARS_PER_SECTION) {
      textSections.push(cleanedText);
    } else {
      for (let i = 0; i < cleanedText.length; i += MAX_CHARS_PER_SECTION) {
        textSections.push(cleanedText.slice(i, i + MAX_CHARS_PER_SECTION));
      }
    }

    const sectionAnalyses: DocumentAnalysis[] = [];
    for (let i = 0; i < textSections.length; i++) {
      const part: Part = {
        text: `SOURCE LEARNING MATERIAL (Section ${i + 1} of ${
          textSections.length
        }):\n\n${textSections[i]}`,
      };
      const analysis = await analyzeDocumentContent([part], {
        pageRangeLabel: `Section ${i + 1} of ${textSections.length}`,
      });
      sectionAnalyses.push(analysis);
    }

    onStage?.("topics", "Identifying key exam topics and subtopics...");
    const unifiedAnalysis = await consolidateSectionAnalyses(sectionAnalyses);

    onStage?.(
      "generating",
      `Creating examination questions across ${unifiedAnalysis.topics.length} topics...`
    );

    let allRawQuestions: unknown[] = [];
    const collectedStems: string[] = [];

    for (let i = 0; i < textSections.length; i++) {
      const part: Part = {
        text: `SOURCE LEARNING MATERIAL (Section ${i + 1} of ${
          textSections.length
        }):\n\n${textSections[i]}`,
      };

      const rawBatch = await generateQuestionsForMaterial({
        contentParts: [part],
        analysis: unifiedAnalysis,
        targetTopics: sectionAnalyses[i].topics,
        targetQuestionCount:
          textSections.length === 1
            ? unifiedAnalysis.recommendedQuestionCount
            : Math.max(8, Math.min(25, sectionAnalyses[i].recommendedQuestionCount)),
        existingQuestionStems: collectedStems,
        sectionContext: `Section ${i + 1} of ${textSections.length}`,
      });

      allRawQuestions.push(...rawBatch);
      for (const q of rawBatch) {
        if (
          q &&
          typeof q === "object" &&
          "question" in q &&
          typeof (q as { question: unknown }).question === "string"
        ) {
          collectedStems.push((q as { question: string }).question);
        }
      }
    }

    onStage?.("validating", "Checking questions and answers...");

    let validation = validateAndDeduplicateQuestions(
      allRawQuestions,
      unifiedAnalysis.topics
    );

    if (
      validation.uncoveredTopics.length > 0 &&
      validation.coverageRatio < 0.75 &&
      textSections.length === 1
    ) {
      const missingTopicItems = unifiedAnalysis.topics.filter((t) =>
        validation.uncoveredTopics.includes(t.name)
      );
      if (missingTopicItems.length > 0) {
        const topUpRaw = await generateQuestionsForMaterial({
          contentParts: [{ text: `SOURCE LEARNING MATERIAL:\n\n${textSections[0]}` }],
          analysis: unifiedAnalysis,
          targetTopics: missingTopicItems,
          targetQuestionCount: missingTopicItems.length * 2,
          existingQuestionStems: validation.validQuestions.map((q) => q.question),
        });
        allRawQuestions = [...validation.validQuestions, ...topUpRaw];
        validation = validateAndDeduplicateQuestions(
          allRawQuestions,
          unifiedAnalysis.topics
        );
      }
    }

    if (validation.validQuestions.length === 0) {
      throw new Error(
        "Could not generate verified multiple-choice questions from the provided text."
      );
    }

    onStage?.("preparing", "Preparing your revision deck...");

    const payload: GeneratedDeckPayload = GeneratedDeckPayloadSchema.parse({
      deckTitle: unifiedAnalysis.deckTitle,
      subject: unifiedAnalysis.subject,
      description: unifiedAnalysis.description,
      topics: unifiedAnalysis.topics,
      questions: validation.validQuestions,
    });

    const result: GenerateDeckResult = {
      payload,
      modelUsed: getGeminiModelName(),
      contentHash,
      generationDurationMs: Date.now() - startTime,
    };

    generationCache.set(contentHash, {
      timestamp: Date.now(),
      result,
    });

    return result;
  })();

  inFlightJobs.set(jobKey, jobPromise);
  try {
    return await jobPromise;
  } finally {
    inFlightJobs.delete(jobKey);
  }
}
