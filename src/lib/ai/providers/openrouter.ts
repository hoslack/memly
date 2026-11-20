import {
  DocumentAnalysis,
  DocumentAnalysisSchema,
  GeneratedDeckPayload,
  GeneratedDeckPayloadSchema,
  TopicItem,
} from "../schemas/deck-schema";
import {
  DOCUMENT_ANALYSIS_SYSTEM_INSTRUCTION,
  buildDocumentAnalysisPrompt,
  buildTopicConsolidationPrompt,
} from "../prompts/document-analysis";
import {
  QUESTION_GENERATION_SYSTEM_INSTRUCTION,
  buildQuestionGenerationPrompt,
} from "../prompts/question-generation";
import { validateAndDeduplicateQuestions } from "../prompts/question-validation";
import { InsufficientMaterialError } from "../../gemini/client";
import { AIProviderError, OpenRouterConfigurationError } from "../fallback";
import { extractTextFromPdfForFallback } from "../pdf-text-extractor";
import { validateAndPreparePdf } from "../../gemini/pdf-processor";

export const DEFAULT_OPENROUTER_MODEL = "openrouter/free";
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

export function getOpenRouterModelName(): string {
  const configured = process.env.OPENROUTER_MODEL?.trim();
  return configured && configured.length > 0
    ? configured
    : DEFAULT_OPENROUTER_MODEL;
}

export function getOpenRouterApiKey(): string {
  if (typeof window !== "undefined") {
    throw new Error(
      "SECURITY VIOLATION: OpenRouter API key must never be accessed in the browser."
    );
  }
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key || key === "your_openrouter_api_key_here") {
    throw new OpenRouterConfigurationError(
      "OPENROUTER_API_KEY is not configured on the server."
    );
  }
  return key;
}

/**
 * Extracts a JSON object from an LLM completion string, stripping any accidental markdown code fences.
 */
export function extractJsonFromText(raw: string): unknown {
  const trimmed = raw.trim();

  // Direct parse first
  try {
    return JSON.parse(trimmed);
  } catch {
    // Strip ```json ... ``` fences if present
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch && fenceMatch[1]) {
      try {
        return JSON.parse(fenceMatch[1].trim());
      } catch {
        // continue
      }
    }

    // Locate first '{' and last '}'
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const candidate = trimmed.slice(firstBrace, lastBrace + 1);
      return JSON.parse(candidate);
    }

    throw new Error("OpenRouter response did not contain valid JSON output.");
  }
}

export interface OpenRouterCompletionResult {
  content: string;
  modelUsed: string;
}

/**
 * Invokes OpenRouter chat/completions API with structured JSON output (and automatic retry without
 * response_format if the free dynamic model doesn't support response_format: json_object).
 */
export async function callOpenRouterJson(params: {
  systemInstruction: string;
  userPrompt: string;
  temperature?: number;
}): Promise<OpenRouterCompletionResult> {
  const apiKey = getOpenRouterApiKey();
  const model = getOpenRouterModelName();
  const siteUrl =
    process.env.OPENROUTER_SITE_URL?.trim() || "http://localhost:3000";
  const appName =
    process.env.OPENROUTER_APP_NAME?.trim() || "Exam Revision App";

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": siteUrl,
    "X-Title": appName,
  };

  const makeRequest = async (includeResponseFormat: boolean) => {
    const body: Record<string, unknown> = {
      model,
      messages: [
        {
          role: "system",
          content: `${params.systemInstruction}\n\nIMPORTANT: Return ONLY valid JSON with no markdown fences or extra text.`,
        },
        {
          role: "user",
          content: params.userPrompt,
        },
      ],
      temperature: params.temperature ?? 0.25,
    };

    if (includeResponseFormat) {
      body.response_format = { type: "json_object" };
    }

    const res = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new AIProviderError({
        provider: "openrouter",
        statusCode: res.status,
        isQuotaOrRateLimit: res.status === 429,
        isTemporaryUnavailable: res.status >= 500,
        message: `OpenRouter HTTP ${res.status}: ${errText.slice(0, 200)}`,
      });
    }

    const json = (await res.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string; code?: number };
    };

    if (json.error) {
      throw new AIProviderError({
        provider: "openrouter",
        statusCode: json.error.code || 500,
        message: json.error.message || "OpenRouter returned an error payload.",
      });
    }

    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      throw new AIProviderError({
        provider: "openrouter",
        message: "OpenRouter returned an empty completion.",
      });
    }

    return {
      content,
      modelUsed: json.model || model,
    };
  };

  try {
    return await makeRequest(true);
  } catch (err: unknown) {
    // Some free routed models reject response_format: { type: "json_object" } with 400; retry once with JSON-only instructions
    if (err instanceof AIProviderError && err.statusCode === 400) {
      return await makeRequest(false);
    }
    throw err;
  }
}

/**
 * Stage 1 Document Analysis via OpenRouter.
 */
export async function analyzeTextWithOpenRouter(
  text: string,
  context?: { fileName?: string; pageRangeLabel?: string; totalPages?: number }
): Promise<{ analysis: DocumentAnalysis; modelUsed: string }> {
  const promptText = buildDocumentAnalysisPrompt(context);
  const fullUserPrompt = `${promptText}\n\nSOURCE LEARNING MATERIAL:\n\n${text}`;

  const { content, modelUsed } = await callOpenRouterJson({
    systemInstruction: DOCUMENT_ANALYSIS_SYSTEM_INSTRUCTION,
    userPrompt: fullUserPrompt,
    temperature: 0.2,
  });

  const parsedJson = extractJsonFromText(content);
  const validated = DocumentAnalysisSchema.parse(parsedJson);

  if (!validated.isSufficientMaterial || validated.topics.length === 0) {
    throw new InsufficientMaterialError(
      validated.insufficientReason ||
        "The supplied material does not contain enough clear educational content to generate reliable exam questions."
    );
  }

  validated.recommendedQuestionCount = Math.max(
    5,
    Math.min(60, validated.recommendedQuestionCount || 10)
  );

  return { analysis: validated, modelUsed };
}

/**
 * Consolidates multiple section analyses via OpenRouter.
 */
export async function consolidateTopicsWithOpenRouter(
  sectionAnalyses: DocumentAnalysis[]
): Promise<DocumentAnalysis> {
  if (sectionAnalyses.length === 1) {
    return sectionAnalyses[0];
  }

  const prompt = buildTopicConsolidationPrompt(sectionAnalyses);
  const { content } = await callOpenRouterJson({
    systemInstruction: DOCUMENT_ANALYSIS_SYSTEM_INSTRUCTION,
    userPrompt: prompt,
    temperature: 0.2,
  });

  const parsed = extractJsonFromText(content);
  return DocumentAnalysisSchema.parse(parsed);
}

/**
 * Stage 2 Question Generation via OpenRouter.
 */
export async function generateQuestionsWithOpenRouter(params: {
  sourceText: string;
  analysis: DocumentAnalysis;
  targetTopics?: TopicItem[];
  targetQuestionCount?: number;
  existingQuestionStems?: string[];
  sectionContext?: string;
}): Promise<{ questions: unknown[]; modelUsed: string }> {
  const promptText = buildQuestionGenerationPrompt({
    analysis: params.analysis,
    targetTopics: params.targetTopics,
    targetQuestionCount: params.targetQuestionCount,
    existingQuestionStems: params.existingQuestionStems,
    sectionContext: params.sectionContext,
  });

  const fullUserPrompt = `${promptText}\n\nSOURCE LEARNING MATERIAL:\n\n${params.sourceText}`;

  const { content, modelUsed } = await callOpenRouterJson({
    systemInstruction: QUESTION_GENERATION_SYSTEM_INSTRUCTION,
    userPrompt: fullUserPrompt,
    temperature: 0.3,
  });

  const parsed = extractJsonFromText(content) as { questions?: unknown[] };
  const questions = Array.isArray(parsed?.questions)
    ? parsed.questions
    : Array.isArray(parsed)
    ? parsed
    : [];

  if (questions.length === 0) {
    throw new AIProviderError({
      provider: "openrouter",
      message: "OpenRouter did not return any questions in the JSON payload.",
    });
  }

  return { questions, modelUsed };
}

/**
 * Full OpenRouter fallback pipeline for Pasted Text.
 */
export async function executeOpenRouterTextPipeline(
  rawText: string
): Promise<{ payload: GeneratedDeckPayload; modelUsed: string }> {
  const cleanedText = rawText.trim();
  const MAX_CHARS_PER_SECTION = 38000;
  const textSections: string[] = [];

  if (cleanedText.length <= MAX_CHARS_PER_SECTION) {
    textSections.push(cleanedText);
  } else {
    for (let i = 0; i < cleanedText.length; i += MAX_CHARS_PER_SECTION) {
      textSections.push(cleanedText.slice(i, i + MAX_CHARS_PER_SECTION));
    }
  }

  const sectionAnalyses: DocumentAnalysis[] = [];
  let lastModelUsed = getOpenRouterModelName();

  for (let i = 0; i < textSections.length; i++) {
    const { analysis, modelUsed } = await analyzeTextWithOpenRouter(
      textSections[i],
      {
        pageRangeLabel: `Section ${i + 1} of ${textSections.length}`,
      }
    );
    sectionAnalyses.push(analysis);
    lastModelUsed = modelUsed;
  }

  const unifiedAnalysis = await consolidateTopicsWithOpenRouter(sectionAnalyses);

  const allRawQuestions: unknown[] = [];
  const collectedStems: string[] = [];

  for (let i = 0; i < textSections.length; i++) {
    const { questions, modelUsed } = await generateQuestionsWithOpenRouter({
      sourceText: textSections[i],
      analysis: unifiedAnalysis,
      targetTopics: sectionAnalyses[i].topics,
      targetQuestionCount:
        textSections.length === 1
          ? unifiedAnalysis.recommendedQuestionCount
          : Math.max(8, Math.min(25, sectionAnalyses[i].recommendedQuestionCount)),
      existingQuestionStems: collectedStems,
      sectionContext: `Section ${i + 1} of ${textSections.length}`,
    });

    lastModelUsed = modelUsed;
    allRawQuestions.push(...questions);
    for (const q of questions) {
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

  const validation = validateAndDeduplicateQuestions(
    allRawQuestions,
    unifiedAnalysis.topics
  );

  if (validation.validQuestions.length === 0) {
    throw new AIProviderError({
      provider: "openrouter",
      message:
        "OpenRouter generated questions did not pass four-option validation.",
    });
  }

  const payload = GeneratedDeckPayloadSchema.parse({
    deckTitle: unifiedAnalysis.deckTitle,
    subject: unifiedAnalysis.subject,
    description: unifiedAnalysis.description,
    topics: unifiedAnalysis.topics,
    questions: validation.validQuestions,
  });

  return { payload, modelUsed: lastModelUsed };
}

/**
 * Full OpenRouter fallback pipeline for PDF documents:
 * 1. Validates PDF structure
 * 2. Extracts text page-by-page using pdfjs-dist (preserving page references)
 * 3. Detects scanned pages and applies Tesseract.js OCR when needed
 * 4. Processes sections through OpenRouter
 * 5. Consolidates topics, validates & deduplicates questions
 */
export async function executeOpenRouterPdfPipeline(
  pdfBuffer: Buffer,
  fileName: string
): Promise<{ payload: GeneratedDeckPayload; modelUsed: string }> {
  await validateAndPreparePdf(pdfBuffer, fileName, "application/pdf");

  const extracted = await extractTextFromPdfForFallback(pdfBuffer);

  const words = extracted.fullText
    .replace(/\[Page \d+\]/g, "")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1);

  if (words.length < 20) {
    throw new InsufficientMaterialError(
      "Could not extract enough readable text from this PDF during fallback processing."
    );
  }

  const sectionAnalyses: DocumentAnalysis[] = [];
  let lastModelUsed = getOpenRouterModelName();

  for (const section of extracted.sections) {
    const rangeLabel = `Pages ${section.startPage} to ${section.endPage} of ${extracted.totalPages}`;
    const { analysis, modelUsed } = await analyzeTextWithOpenRouter(
      section.text,
      {
        fileName,
        pageRangeLabel: rangeLabel,
        totalPages: extracted.totalPages,
      }
    );
    sectionAnalyses.push(analysis);
    lastModelUsed = modelUsed;
  }

  const unifiedAnalysis = await consolidateTopicsWithOpenRouter(sectionAnalyses);

  const allRawQuestions: unknown[] = [];
  const collectedStems: string[] = [];

  for (let i = 0; i < extracted.sections.length; i++) {
    const section = extracted.sections[i];
    const secAnalysis = sectionAnalyses[i];
    const rangeLabel = `Pages ${section.startPage}-${section.endPage}`;

    const { questions, modelUsed } = await generateQuestionsWithOpenRouter({
      sourceText: section.text,
      analysis: unifiedAnalysis,
      targetTopics: secAnalysis.topics,
      targetQuestionCount:
        extracted.sections.length === 1
          ? unifiedAnalysis.recommendedQuestionCount
          : Math.max(8, Math.min(25, secAnalysis.recommendedQuestionCount)),
      existingQuestionStems: collectedStems,
      sectionContext: rangeLabel,
    });

    lastModelUsed = modelUsed;
    allRawQuestions.push(...questions);
    for (const q of questions) {
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

  const validation = validateAndDeduplicateQuestions(
    allRawQuestions,
    unifiedAnalysis.topics
  );

  if (validation.validQuestions.length === 0) {
    throw new AIProviderError({
      provider: "openrouter",
      message:
        "OpenRouter generated questions did not pass four-option validation.",
    });
  }

  const payload = GeneratedDeckPayloadSchema.parse({
    deckTitle: unifiedAnalysis.deckTitle,
    subject: unifiedAnalysis.subject,
    description: unifiedAnalysis.description,
    topics: unifiedAnalysis.topics,
    questions: validation.validQuestions,
  });

  return { payload, modelUsed: lastModelUsed };
}

export const openRouterProvider = {
  name: "openrouter" as const,
  generateFromText: executeOpenRouterTextPipeline,
  generateFromPdf: executeOpenRouterPdfPipeline,
};
