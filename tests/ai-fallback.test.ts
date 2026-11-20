import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  executeAIRequest,
  AIProviderAdapter,
  clearAIServiceCache,
} from "../src/lib/ai/ai-service";
import { isEligibleForFallback, AIProviderError } from "../src/lib/ai/fallback";
import { GeminiConfigurationError, InsufficientMaterialError } from "../src/lib/gemini/client";
import { PdfValidationError } from "../src/lib/gemini/pdf-processor";
import { SAMPLE_DEVELOPMENT_DECK_PAYLOAD } from "../src/lib/sample-deck";

describe("AI Provider Fallback & Priority (Gemini Primary -> OpenRouter Fallback)", () => {
  beforeEach(() => {
    clearAIServiceCache();
    vi.restoreAllMocks();
  });

  it("1. Gemini succeeds: OpenRouter is never called", async () => {
    const geminiMock: AIProviderAdapter = {
      name: "gemini",
      generateFromText: vi.fn().mockResolvedValue({
        payload: SAMPLE_DEVELOPMENT_DECK_PAYLOAD,
        modelUsed: "gemini-3.5-flash-lite",
      }),
      generateFromPdf: vi.fn(),
    };

    const openRouterMock: AIProviderAdapter = {
      name: "openrouter",
      generateFromText: vi.fn(),
      generateFromPdf: vi.fn(),
    };

    const result = await executeAIRequest({
      contentHash: "hash_1",
      primary: geminiMock,
      fallback: openRouterMock,
      task: (provider) => provider.generateFromText("Valid study notes"),
    });

    expect(geminiMock.generateFromText).toHaveBeenCalledTimes(1);
    expect(openRouterMock.generateFromText).not.toHaveBeenCalled();
    expect(result.payload.deckTitle).toBe(
      SAMPLE_DEVELOPMENT_DECK_PAYLOAD.deckTitle
    );
  });

  it("2. Gemini quota exhausted (RESOURCE_EXHAUSTED / Daily Quota): OpenRouter is called", async () => {
    const quotaError = new Error(
      "429 RESOURCE_EXHAUSTED: Daily quota exceeded for gemini-3.5-flash-lite"
    );

    const geminiMock: AIProviderAdapter = {
      name: "gemini",
      generateFromText: vi.fn().mockRejectedValue(quotaError),
      generateFromPdf: vi.fn(),
    };

    const openRouterMock: AIProviderAdapter = {
      name: "openrouter",
      generateFromText: vi.fn().mockResolvedValue({
        payload: SAMPLE_DEVELOPMENT_DECK_PAYLOAD,
        modelUsed: "openrouter/free",
      }),
      generateFromPdf: vi.fn(),
    };

    expect(isEligibleForFallback(quotaError)).toBe(true);

    const result = await executeAIRequest({
      contentHash: "hash_2",
      primary: geminiMock,
      fallback: openRouterMock,
      task: (provider) => provider.generateFromText("Valid study notes"),
    });

    expect(geminiMock.generateFromText).toHaveBeenCalledTimes(1);
    expect(openRouterMock.generateFromText).toHaveBeenCalledTimes(1);
    expect(result.aiMetadata.actualProvider).toBe("openrouter");
    expect(result.aiMetadata.fallbackUsed).toBe(true);
  });

  it("3. Gemini rate limited (HTTP 429 Too Many Requests): OpenRouter is called", async () => {
    const rateLimitError = new AIProviderError({
      provider: "gemini",
      statusCode: 429,
      isQuotaOrRateLimit: true,
      message: "HTTP 429 Too Many Requests: Rate limit reached",
    });

    const geminiMock: AIProviderAdapter = {
      name: "gemini",
      generateFromText: vi.fn().mockRejectedValue(rateLimitError),
      generateFromPdf: vi.fn(),
    };

    const openRouterMock: AIProviderAdapter = {
      name: "openrouter",
      generateFromText: vi.fn().mockResolvedValue({
        payload: SAMPLE_DEVELOPMENT_DECK_PAYLOAD,
        modelUsed: "openrouter/free",
      }),
      generateFromPdf: vi.fn(),
    };

    const result = await executeAIRequest({
      contentHash: "hash_3",
      primary: geminiMock,
      fallback: openRouterMock,
      task: (provider) => provider.generateFromText("Valid study notes"),
    });

    expect(geminiMock.generateFromText).toHaveBeenCalledTimes(1);
    expect(openRouterMock.generateFromText).toHaveBeenCalledTimes(1);
    expect(result.aiMetadata.actualProvider).toBe("openrouter");
  });

  it("4. Gemini temporarily unavailable (HTTP 500 or 503 high demand): OpenRouter is called", async () => {
    const unavailableError = new Error(
      '{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}'
    );

    const geminiMock: AIProviderAdapter = {
      name: "gemini",
      generateFromText: vi.fn().mockRejectedValue(unavailableError),
      generateFromPdf: vi.fn(),
    };

    const openRouterMock: AIProviderAdapter = {
      name: "openrouter",
      generateFromText: vi.fn().mockResolvedValue({
        payload: SAMPLE_DEVELOPMENT_DECK_PAYLOAD,
        modelUsed: "openrouter/free",
      }),
      generateFromPdf: vi.fn(),
    };

    expect(isEligibleForFallback(unavailableError)).toBe(true);

    const result = await executeAIRequest({
      contentHash: "hash_4",
      primary: geminiMock,
      fallback: openRouterMock,
      task: (provider) => provider.generateFromText("Valid study notes"),
    });

    expect(openRouterMock.generateFromText).toHaveBeenCalledTimes(1);
    expect(result.aiMetadata.fallbackUsed).toBe(true);
  });

  it("5. Gemini invalid API key (401 / API_KEY_INVALID): OpenRouter is NOT called", async () => {
    const invalidKeyError = new Error(
      "401 UNAUTHENTICATED: API_KEY_INVALID - API key not valid. Please pass a valid API key."
    );

    const geminiMock: AIProviderAdapter = {
      name: "gemini",
      generateFromText: vi.fn().mockRejectedValue(invalidKeyError),
      generateFromPdf: vi.fn(),
    };

    const openRouterMock: AIProviderAdapter = {
      name: "openrouter",
      generateFromText: vi.fn(),
      generateFromPdf: vi.fn(),
    };

    expect(isEligibleForFallback(invalidKeyError)).toBe(false);
    expect(
      isEligibleForFallback(new GeminiConfigurationError("Missing key"))
    ).toBe(false);

    await expect(
      executeAIRequest({
        contentHash: "hash_5",
        primary: geminiMock,
        fallback: openRouterMock,
        task: (provider) => provider.generateFromText("Valid study notes"),
      })
    ).rejects.toThrow(/API_KEY_INVALID/);

    expect(openRouterMock.generateFromText).not.toHaveBeenCalled();
  });

  it("6. Gemini malformed request / invalid input / upload validation (400): OpenRouter is NOT called", async () => {
    const malformedError = new Error(
      "400 INVALID_ARGUMENT: Malformed request payload"
    );

    const geminiMock: AIProviderAdapter = {
      name: "gemini",
      generateFromText: vi.fn().mockRejectedValue(malformedError),
      generateFromPdf: vi.fn(),
    };

    const openRouterMock: AIProviderAdapter = {
      name: "openrouter",
      generateFromText: vi.fn(),
      generateFromPdf: vi.fn(),
    };

    expect(isEligibleForFallback(malformedError)).toBe(false);
    expect(
      isEligibleForFallback(new InsufficientMaterialError("Too short"))
    ).toBe(false);
    expect(isEligibleForFallback(new PdfValidationError("Corrupt PDF"))).toBe(
      false
    );

    await expect(
      executeAIRequest({
        contentHash: "hash_6",
        primary: geminiMock,
        fallback: openRouterMock,
        task: (provider) => provider.generateFromText("Valid study notes"),
      })
    ).rejects.toThrow(/INVALID_ARGUMENT/);

    expect(openRouterMock.generateFromText).not.toHaveBeenCalled();
  });

  it("7. OpenRouter succeeds on fallback: Deck payload is returned and validated normally", async () => {
    const geminiMock: AIProviderAdapter = {
      name: "gemini",
      generateFromText: vi
        .fn()
        .mockRejectedValue(new Error("503 Service Unavailable")),
      generateFromPdf: vi.fn(),
    };

    const openRouterMock: AIProviderAdapter = {
      name: "openrouter",
      generateFromText: vi.fn().mockResolvedValue({
        payload: SAMPLE_DEVELOPMENT_DECK_PAYLOAD,
        modelUsed: "openrouter/free",
      }),
      generateFromPdf: vi.fn(),
    };

    const result = await executeAIRequest({
      contentHash: "hash_7",
      primary: geminiMock,
      fallback: openRouterMock,
      task: (provider) => provider.generateFromText("Valid study notes"),
    });

    expect(result.payload.questions).toHaveLength(
      SAMPLE_DEVELOPMENT_DECK_PAYLOAD.questions.length
    );
    expect(result.payload.deckTitle).toBe(
      SAMPLE_DEVELOPMENT_DECK_PAYLOAD.deckTitle
    );
  });

  it("8. Both providers fail: A clear recoverable error is displayed", async () => {
    const geminiMock: AIProviderAdapter = {
      name: "gemini",
      generateFromText: vi
        .fn()
        .mockRejectedValue(new Error("429 Gemini Quota Exceeded")),
      generateFromPdf: vi.fn(),
    };

    const openRouterMock: AIProviderAdapter = {
      name: "openrouter",
      generateFromText: vi
        .fn()
        .mockRejectedValue(new Error("503 OpenRouter Upstream Busy")),
      generateFromPdf: vi.fn(),
    };

    await expect(
      executeAIRequest({
        contentHash: "hash_8",
        primary: geminiMock,
        fallback: openRouterMock,
        task: (provider) => provider.generateFromText("Valid study notes"),
      })
    ).rejects.toThrow(
      /AI study quota is temporarily full.*Your notes are saved/i
    );
  });

  it("9. Gemini generates a deck: Provider metadata identifies Gemini with fallbackUsed: false", async () => {
    const geminiMock: AIProviderAdapter = {
      name: "gemini",
      generateFromText: vi.fn().mockResolvedValue({
        payload: SAMPLE_DEVELOPMENT_DECK_PAYLOAD,
        modelUsed: "gemini-3.5-flash-lite",
      }),
      generateFromPdf: vi.fn(),
    };

    const openRouterMock: AIProviderAdapter = {
      name: "openrouter",
      generateFromText: vi.fn(),
      generateFromPdf: vi.fn(),
    };

    const result = await executeAIRequest({
      contentHash: "hash_9",
      primary: geminiMock,
      fallback: openRouterMock,
      task: (provider) => provider.generateFromText("Valid study notes"),
    });

    expect(result.aiMetadata.primaryProvider).toBe("gemini");
    expect(result.aiMetadata.actualProvider).toBe("gemini");
    expect(result.aiMetadata.model).toBe("gemini-3.5-flash-lite");
    expect(result.aiMetadata.fallbackUsed).toBe(false);
    expect(result.aiMetadata.generatedAt).toBeDefined();
  });

  it("10. OpenRouter generates a deck: Provider metadata identifies OpenRouter and records fallbackUsed: true", async () => {
    const geminiMock: AIProviderAdapter = {
      name: "gemini",
      generateFromText: vi
        .fn()
        .mockRejectedValue(new Error("429 Quota exhausted")),
      generateFromPdf: vi.fn(),
    };

    const openRouterMock: AIProviderAdapter = {
      name: "openrouter",
      generateFromText: vi.fn().mockResolvedValue({
        payload: SAMPLE_DEVELOPMENT_DECK_PAYLOAD,
        modelUsed: "openrouter/free",
      }),
      generateFromPdf: vi.fn(),
    };

    const result = await executeAIRequest({
      contentHash: "hash_10",
      primary: geminiMock,
      fallback: openRouterMock,
      task: (provider) => provider.generateFromText("Valid study notes"),
    });

    expect(result.aiMetadata.primaryProvider).toBe("gemini");
    expect(result.aiMetadata.actualProvider).toBe("openrouter");
    expect(result.aiMetadata.model).toBe("openrouter/free");
    expect(result.aiMetadata.fallbackUsed).toBe(true);
    expect(result.aiMetadata.generatedAt).toBeDefined();
  });
});
