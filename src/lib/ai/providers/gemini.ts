import {
  generateDeckFromPdf as geminiGenerateDeckFromPdf,
  generateDeckFromText as geminiGenerateDeckFromText,
  analyzeDocumentContent,
  generateQuestionsForMaterial,
} from "../../gemini/service";
import { getGeminiModelName } from "../../gemini/client";
import { GeneratedDeckPayload } from "../schemas/deck-schema";

export async function executeGeminiTextPipeline(
  rawText: string
): Promise<{ payload: GeneratedDeckPayload; modelUsed: string }> {
  const result = await geminiGenerateDeckFromText(
    rawText,
    `gemini_text_${Date.now()}_${Math.random()}`
  );
  return {
    payload: result.payload,
    modelUsed: result.modelUsed || getGeminiModelName(),
  };
}

export async function executeGeminiPdfPipeline(
  pdfBuffer: Buffer,
  fileName: string
): Promise<{ payload: GeneratedDeckPayload; modelUsed: string }> {
  const result = await geminiGenerateDeckFromPdf(
    pdfBuffer,
    fileName,
    `gemini_pdf_${Date.now()}_${Math.random()}`
  );
  return {
    payload: result.payload,
    modelUsed: result.modelUsed || getGeminiModelName(),
  };
}

export const geminiProvider = {
  name: "gemini" as const,
  generateFromText: executeGeminiTextPipeline,
  generateFromPdf: executeGeminiPdfPipeline,
  analyzeDocumentContent,
  generateQuestionsForMaterial,
};
