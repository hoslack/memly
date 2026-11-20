import { NextRequest, NextResponse } from "next/server";
import {
  generateDeckFromPdfWithFallback,
  generateDeckFromTextWithFallback,
} from "@/lib/ai/ai-service";
import {
  GeminiConfigurationError,
  InsufficientMaterialError,
} from "@/lib/gemini/client";
import { PdfValidationError } from "@/lib/gemini/pdf-processor";
import { TextSubmissionSchema } from "@/lib/schemas/study";
import { verifyAuthHeaderToken } from "@/lib/firebase/admin";

// Allow up to 60 seconds execution time on Vercel Serverless Functions
export const maxDuration = 60;

// Simple per-client rate limiter to prevent runaway AI cost
const rateLimitWindowMs = 60 * 1000; // 1 minute window
const maxRequestsPerMinute = 8;
const clientRequestLog = new Map<string, number[]>();

function checkRateLimit(clientKey: string): boolean {
  const now = Date.now();
  const timestamps = clientRequestLog.get(clientKey) || [];
  const active = timestamps.filter((t) => now - t < rateLimitWindowMs);

  if (active.length >= maxRequestsPerMinute) {
    clientRequestLog.set(clientKey, active);
    return false;
  }

  active.push(now);
  clientRequestLog.set(clientKey, active);
  return true;
}

export async function POST(req: NextRequest) {
  try {
    // 1. Identify client for rate limiting (verified Firebase uid or IP)
    const authUser = await verifyAuthHeaderToken(
      req.headers.get("authorization")
    );
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "local_client";
    const clientKey = authUser?.uid || ip;

    if (!checkRateLimit(clientKey)) {
      return NextResponse.json(
        {
          error:
            "Too many deck generation requests in a short period. Please wait a minute before generating another deck.",
          code: "RATE_LIMIT_EXCEEDED",
        },
        { status: 429 }
      );
    }

    const contentType = req.headers.get("content-type") || "";

    // 2A. Handle multipart/form-data (PDF Upload)
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const fileEntry = formData.get("file");
      const idempotencyKey =
        formData.get("idempotencyKey")?.toString() || undefined;

      if (!fileEntry || !(fileEntry instanceof File)) {
        return NextResponse.json(
          {
            error: "Please select a valid PDF file to upload.",
            code: "MISSING_FILE",
          },
          { status: 400 }
        );
      }

      const arrayBuffer = await fileEntry.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const result = await generateDeckFromPdfWithFallback(
        buffer,
        fileEntry.name || "notes.pdf",
        idempotencyKey
      );

      return NextResponse.json({
        success: true,
        deck: result.payload,
        meta: {
          ...result.aiMetadata,
          contentHash: result.contentHash,
          generationDurationMs: result.generationDurationMs,
          sourceFileName: fileEntry.name || "notes.pdf",
          sourceType: "pdf",
        },
      });
    }

    // 2B. Handle application/json (Pasted Notes Text)
    if (contentType.includes("application/json")) {
      const body = await req.json();
      const parsed = TextSubmissionSchema.safeParse(body);

      if (!parsed.success) {
        const message =
          parsed.error.issues[0]?.message ||
          "Please paste valid study notes to generate a revision deck.";
        return NextResponse.json(
          {
            error: message,
            code: "INVALID_TEXT_INPUT",
          },
          { status: 400 }
        );
      }

      const result = await generateDeckFromTextWithFallback(
        parsed.data.text,
        parsed.data.idempotencyKey
      );

      return NextResponse.json({
        success: true,
        deck: result.payload,
        meta: {
          ...result.aiMetadata,
          contentHash: result.contentHash,
          generationDurationMs: result.generationDurationMs,
          sourceFileName: "Pasted Notes",
          sourceType: "text",
        },
      });
    }

    return NextResponse.json(
      {
        error:
          "Unsupported request format. Upload a PDF file or submit JSON text notes.",
        code: "UNSUPPORTED_CONTENT_TYPE",
      },
      { status: 400 }
    );
  } catch (err: unknown) {
    if (err instanceof PdfValidationError) {
      return NextResponse.json(
        {
          error: err.message,
          code: "PDF_VALIDATION_ERROR",
        },
        { status: 400 }
      );
    }

    if (err instanceof InsufficientMaterialError) {
      return NextResponse.json(
        {
          error: err.message,
          code: "INSUFFICIENT_MATERIAL",
        },
        { status: 422 }
      );
    }

    if (err instanceof GeminiConfigurationError) {
      return NextResponse.json(
        {
          error: err.message,
          code: "GEMINI_CONFIG_MISSING",
        },
        { status: 503 }
      );
    }

    const rawMsg = err instanceof Error ? err.message : String(err);
    console.error("[/api/decks/generate] Error:", err);

    const lowerMsg = rawMsg.toLowerCase();
    if (
      rawMsg.includes("429") ||
      lowerMsg.includes("quota") ||
      lowerMsg.includes("rate limit") ||
      lowerMsg.includes("resource_exhausted") ||
      lowerMsg.includes("temporarily full") ||
      rawMsg.includes("503") ||
      lowerMsg.includes("high demand") ||
      lowerMsg.includes("unavailable")
    ) {
      return NextResponse.json(
        {
          error:
            "AI study quota is temporarily full. Your notes are saved—please try again in a minute, or practise with the Sample Deck below.",
          code: "AI_QUOTA_EXCEEDED",
        },
        { status: 429 }
      );
    }

    return NextResponse.json(
      {
        error:
          "We couldn't generate flashcards from this material right now. Please try again in a moment.",
        code: "INTERNAL_GENERATION_ERROR",
      },
      { status: 500 }
    );
  }
}
