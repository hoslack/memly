import { NextResponse } from "next/server";
import { getGeminiModelName } from "@/lib/gemini/client";
import { getOpenRouterModelName } from "@/lib/ai/providers/openrouter";
import { isFirebaseClientConfigured } from "@/lib/firebase/client";

export async function GET() {
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  const isGeminiConfigured = Boolean(
    geminiKey && geminiKey !== "your_gemini_api_key_here"
  );

  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
  const isOpenRouterConfigured = Boolean(
    openRouterKey && openRouterKey !== "your_openrouter_api_key_here"
  );

  return NextResponse.json({
    geminiConfigured: isGeminiConfigured,
    geminiModel: getGeminiModelName(),
    openRouterConfigured: isOpenRouterConfigured,
    openRouterModel: getOpenRouterModelName(),
    firebaseConfigured: isFirebaseClientConfigured(),
  });
}
