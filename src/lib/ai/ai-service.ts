import { computeContentHash, GenerationStageCallback } from "../gemini/service";
import { InsufficientMaterialError } from "../gemini/client";
import { validateAndPreparePdf } from "../gemini/pdf-processor";
import { GeneratedDeckPayload } from "./schemas/deck-schema";
import { AIMetadata } from "../schemas/study";
import { isEligibleForFallback } from "./fallback";
import { geminiProvider } from "./providers/gemini";
import { openRouterProvider } from "./providers/openrouter";

export interface AIDeckGenerationResult {
  payload: GeneratedDeckPayload;
  aiMetadata: AIMetadata;
  contentHash: string;
  generationDurationMs: number;
}

export interface AIProviderAdapter {
  name: "gemini" | "openrouter";
  generateFromText: (
    text: string
  ) => Promise<{ payload: GeneratedDeckPayload; modelUsed: string }>;
  generateFromPdf: (
    pdfBuffer: Buffer,
    fileName: string
  ) => Promise<{ payload: GeneratedDeckPayload; modelUsed: string }>;
}

// Server-side LRU cache for generated decks so repeated identical submissions never re-consume Gemini or OpenRouter quota
const aiDeckCache = new Map<
  string,
  { timestamp: number; result: AIDeckGenerationResult }
>();
const CACHE_TTL_MS = 1000 * 60 * 30; // 30 minutes

const inFlightRequests = new Map<string, Promise<AIDeckGenerationResult>>();

export function clearAIServiceCache(): void {
  aiDeckCache.clear();
  inFlightRequests.clear();
}

/**
 * Core Fallback Execution Engine:
 *
 * 1. Always attempts Google Gemini (PRIMARY) first.
 * 2. If Gemini succeeds, returns immediately and NEVER calls OpenRouter.
 * 3. If Gemini throws an error, checks `isEligibleForFallback(error)`:
 *    - If NOT eligible (401 invalid API key, 400 malformed request, invalid input, unsupported model config),
 *      rethrows the error immediately without calling OpenRouter.
 *    - If eligible (429 quota/rate limit, 500/503 temporary unavailability), logs a warning and
 *      executes the task using OpenRouter (FALLBACK).
 * 4. Records full `aiMetadata` (`primaryProvider`, `actualProvider`, `model`, `fallbackUsed`, `generatedAt`).
 */
export async function executeAIRequest(params: {
  task: (
    provider: AIProviderAdapter
  ) => Promise<{ payload: GeneratedDeckPayload; modelUsed: string }>;
  contentHash: string;
  startTimeMs?: number;
  primary?: AIProviderAdapter;
  fallback?: AIProviderAdapter;
}): Promise<AIDeckGenerationResult> {
  const startTime = params.startTimeMs ?? Date.now();
  const primary = params.primary ?? geminiProvider;
  const fallback = params.fallback ?? openRouterProvider;

  try {
    const primaryRes = await params.task(primary);
    const duration = Date.now() - startTime;
    const nowIso = new Date().toISOString();

    return {
      payload: primaryRes.payload,
      contentHash: params.contentHash,
      generationDurationMs: duration,
      aiMetadata: {
        primaryProvider: "gemini",
        actualProvider: "gemini",
        model: primaryRes.modelUsed,
        modelUsed: primaryRes.modelUsed,
        fallbackUsed: false,
        generatedAt: nowIso,
        contentHash: params.contentHash,
        generationDurationMs: duration,
      },
    };
  } catch (geminiError: unknown) {
    if (!isEligibleForFallback(geminiError)) {
      throw geminiError;
    }

    console.warn("Gemini unavailable. Switching to OpenRouter.");

    try {
      const fallbackRes = await params.task(fallback);
      const duration = Date.now() - startTime;
      const nowIso = new Date().toISOString();

      return {
        payload: fallbackRes.payload,
        contentHash: params.contentHash,
        generationDurationMs: duration,
        aiMetadata: {
          primaryProvider: "gemini",
          actualProvider: "openrouter",
          model: fallbackRes.modelUsed,
          modelUsed: fallbackRes.modelUsed,
          fallbackUsed: true,
          generatedAt: nowIso,
          contentHash: params.contentHash,
          generationDurationMs: duration,
        },
      };
    } catch (openRouterError: unknown) {
      const geminiMsg =
        geminiError instanceof Error ? geminiError.message : String(geminiError);
      const orMsg =
        openRouterError instanceof Error
          ? openRouterError.message
          : String(openRouterError);

      throw new Error(
        `AI generation services are temporarily unavailable (Primary Gemini and Fallback OpenRouter both failed). Your notes are preserved—please retry in a moment. Details: [Gemini: ${geminiMsg.slice(
          0,
          100
        )}] [OpenRouter: ${orMsg.slice(0, 100)}]`
      );
    }
  }
}

/**
 * Generates an Exam Revision Deck from Pasted Text with Gemini Primary -> OpenRouter Fallback.
 */
export async function generateDeckFromTextWithFallback(
  rawText: string,
  idempotencyKey?: string,
  onStage?: GenerationStageCallback,
  customProviders?: {
    primary?: AIProviderAdapter;
    fallback?: AIProviderAdapter;
  }
): Promise<AIDeckGenerationResult> {
  const cleanedText = rawText.trim();
  const words = cleanedText.split(/\s+/).filter((w) => w.length > 1);
  if (cleanedText.length < 120 || words.length < 25) {
    throw new InsufficientMaterialError(
      "The pasted text is too short to generate a meaningful exam revision deck. Please paste at least a paragraph or page of study notes (minimum 25 words)."
    );
  }

  const uniqueWords = new Set(words.map((w) => w.toLowerCase()));
  if (uniqueWords.size < 12) {
    throw new InsufficientMaterialError(
      "The pasted text does not contain enough distinct concepts or educational vocabulary to create useful revision questions."
    );
  }

  const contentHash = computeContentHash(cleanedText);
  const jobKey = idempotencyKey || `ai_text_${contentHash}`;

  if (!customProviders) {
    const cached = aiDeckCache.get(contentHash);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.result;
    }

    const inFlight = inFlightRequests.get(jobKey);
    if (inFlight) {
      return inFlight;
    }
  }

  const promise = (async () => {
    onStage?.("analyzing", "Reading and analysing your study notes...");
    const result = await executeAIRequest({
      contentHash,
      primary: customProviders?.primary,
      fallback: customProviders?.fallback,
      task: (provider) => provider.generateFromText(cleanedText),
    });

    if (!customProviders) {
      aiDeckCache.set(contentHash, {
        timestamp: Date.now(),
        result,
      });
    }
    return result;
  })();

  if (!customProviders) {
    inFlightRequests.set(jobKey, promise);
  }
  try {
    return await promise;
  } finally {
    if (!customProviders) {
      inFlightRequests.delete(jobKey);
    }
  }
}

/**
 * Generates an Exam Revision Deck from a PDF Buffer with Gemini Primary -> OpenRouter Fallback.
 */
export async function generateDeckFromPdfWithFallback(
  pdfBuffer: Buffer,
  fileName: string,
  idempotencyKey?: string,
  onStage?: GenerationStageCallback,
  customProviders?: {
    primary?: AIProviderAdapter;
    fallback?: AIProviderAdapter;
  }
): Promise<AIDeckGenerationResult> {
  // Always validate PDF structure upfront before calling any AI provider
  await validateAndPreparePdf(pdfBuffer, fileName, "application/pdf");

  const contentHash = computeContentHash(pdfBuffer);
  const jobKey = idempotencyKey || `ai_pdf_${contentHash}`;

  if (!customProviders) {
    const cached = aiDeckCache.get(contentHash);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.result;
    }

    const inFlight = inFlightRequests.get(jobKey);
    if (inFlight) {
      return inFlight;
    }
  }

  const promise = (async () => {
    onStage?.("analyzing", "Reading and analysing PDF document...");
    const result = await executeAIRequest({
      contentHash,
      primary: customProviders?.primary,
      fallback: customProviders?.fallback,
      task: (provider) => provider.generateFromPdf(pdfBuffer, fileName),
    });

    if (!customProviders) {
      aiDeckCache.set(contentHash, {
        timestamp: Date.now(),
        result,
      });
    }
    return result;
  })();

  if (!customProviders) {
    inFlightRequests.set(jobKey, promise);
  }
  try {
    return await promise;
  } finally {
    if (!customProviders) {
      inFlightRequests.delete(jobKey);
    }
  }
}
