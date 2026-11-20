import { GeminiConfigurationError, InsufficientMaterialError } from "../gemini/client";
import { PdfValidationError } from "../gemini/pdf-processor";

export class OpenRouterConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenRouterConfigurationError";
  }
}

export class AIProviderError extends Error {
  public readonly provider: "gemini" | "openrouter";
  public readonly statusCode?: number;
  public readonly isQuotaOrRateLimit: boolean;
  public readonly isTemporaryUnavailable: boolean;

  constructor(params: {
    message: string;
    provider: "gemini" | "openrouter";
    statusCode?: number;
    isQuotaOrRateLimit?: boolean;
    isTemporaryUnavailable?: boolean;
    cause?: unknown;
  }) {
    super(params.message);
    this.name = "AIProviderError";
    this.provider = params.provider;
    this.statusCode = params.statusCode;
    this.isQuotaOrRateLimit = Boolean(params.isQuotaOrRateLimit);
    this.isTemporaryUnavailable = Boolean(params.isTemporaryUnavailable);
  }
}

/**
 * Determines whether a Gemini failure is eligible to trigger automatic fallback to OpenRouter.
 *
 * Eligible for fallback:
 * - HTTP 429 due to exhausted quota or rate limits
 * - Clear daily or monthly quota exhaustion error (RESOURCE_EXHAUSTED, quota exceeded)
 * - HTTP 500, 502, 503, 504 indicating temporary service unavailability or high demand
 * - Temporary provider service or network timeout failures
 *
 * NOT eligible for fallback (must be thrown immediately):
 * - Invalid Gemini API key (401 / API_KEY_INVALID / GeminiConfigurationError)
 * - Invalid request or malformed input (400 / INVALID_ARGUMENT)
 * - Unsupported model configuration (404 / model not supported when explicitly misconfigured)
 * - Invalid application data / insufficient material (InsufficientMaterialError)
 * - User upload validation failures (PdfValidationError)
 */
export function isEligibleForFallback(error: unknown): boolean {
  if (!error) return false;

  // Never fallback on user input or configuration errors
  if (
    error instanceof GeminiConfigurationError ||
    error instanceof InsufficientMaterialError ||
    error instanceof PdfValidationError
  ) {
    return false;
  }

  if (error instanceof AIProviderError) {
    if (error.statusCode === 400 || error.statusCode === 401 || error.statusCode === 403) {
      return false;
    }
    return error.isQuotaOrRateLimit || error.isTemporaryUnavailable;
  }

  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status: unknown }).status)
      : typeof error === "object" && error !== null && "statusCode" in error
      ? Number((error as { statusCode: unknown }).statusCode)
      : undefined;

  const rawMsg = error instanceof Error ? error.message : String(error);
  const upperMsg = rawMsg.toUpperCase();

  // Explicit DO NOT FALLBACK conditions:
  // 1. Invalid Gemini API Key (401 / API_KEY_INVALID)
  if (
    status === 401 ||
    upperMsg.includes("API_KEY_INVALID") ||
    upperMsg.includes("INVALID API KEY") ||
    upperMsg.includes("UNAUTHENTICATED") ||
    upperMsg.includes("401")
  ) {
    return false;
  }

  // 2. Invalid request or malformed input (400 / INVALID_ARGUMENT)
  if (
    status === 400 ||
    upperMsg.includes("INVALID_ARGUMENT") ||
    upperMsg.includes("BAD REQUEST") ||
    upperMsg.includes("MALFORMED")
  ) {
    return false;
  }

  // 3. Unsupported model configuration
  if (
    upperMsg.includes("UNSUPPORTED MODEL") ||
    upperMsg.includes("MODEL_NOT_SUPPORTED")
  ) {
    return false;
  }

  // Explicit ELIGIBLE FOR FALLBACK conditions:
  // 1. HTTP 429 or Quota Exhaustion
  if (
    status === 429 ||
    upperMsg.includes("429") ||
    upperMsg.includes("RESOURCE_EXHAUSTED") ||
    upperMsg.includes("QUOTA") ||
    upperMsg.includes("RATE LIMIT") ||
    upperMsg.includes("TOO MANY REQUESTS")
  ) {
    return true;
  }

  // 2. HTTP 500 or 503 temporary service unavailability
  if (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    upperMsg.includes("503") ||
    upperMsg.includes("500") ||
    upperMsg.includes("UNAVAILABLE") ||
    upperMsg.includes("HIGH DEMAND") ||
    upperMsg.includes("INTERNAL ERROR") ||
    upperMsg.includes("OVERLOADED") ||
    upperMsg.includes("HEADERS_TIMEOUT") ||
    upperMsg.includes("ETIMEDOUT") ||
    upperMsg.includes("ECONNRESET") ||
    upperMsg.includes("FETCH FAILED")
  ) {
    return true;
  }

  return false;
}
