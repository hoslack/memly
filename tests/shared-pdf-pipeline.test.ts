import { describe, it, expect, vi, beforeEach } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  extractPdfText,
  chunkExtractedPages,
  PdfValidationError,
} from "../src/lib/pdf/extract-text";
import {
  generateDeckFromPdfWithFallback,
  AIProviderAdapter,
  clearAIServiceCache,
} from "../src/lib/ai/ai-service";
import { InsufficientMaterialError } from "../src/lib/gemini/client";
import { validateAndDeduplicateQuestions } from "../src/lib/ai/prompts";
import { SAMPLE_DEVELOPMENT_DECK_PAYLOAD } from "../src/lib/sample-deck";

async function createMultiPageTextPdf(pageContents: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle("Shared Extraction Lecture Notes");
  for (const text of pageContents) {
    const page = doc.addPage([600, 800]);
    if (text.trim().length > 0) {
      page.drawText(text, { x: 50, y: 700, size: 12 });
    }
  }
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

describe("Shared PDF Text Extraction & Multi-Provider AI Pipeline", () => {
  beforeEach(() => {
    clearAIServiceCache();
    vi.restoreAllMocks();
  });

  it("1, 2 & 3. Extracts a normal text-based PDF, includes text from all pages, and preserves PAGE N: markers", async () => {
    const pdfBuffer = await createMultiPageTextPdf([
      "Introduction to Computer Science and Fundamental Data Types in Programming.",
      "Data Structures and Algorithms including Binary Trees, Graphs, and Sorting.",
      "Database Management Systems, SQL Queries, Normalization, and ACID Transactions.",
    ]);

    const extracted = await extractPdfText(pdfBuffer, {
      fileName: "cs_notes.pdf",
    });

    expect(extracted.totalPages).toBe(3);
    expect(extracted.pages).toHaveLength(3);
    expect(extracted.fullText).toContain("PAGE 1:");
    expect(extracted.fullText).toContain("Introduction to Computer Science");
    expect(extracted.fullText).toContain("PAGE 2:");
    expect(extracted.fullText).toContain("Data Structures and Algorithms");
    expect(extracted.fullText).toContain("PAGE 3:");
    expect(extracted.fullText).toContain("Database Management Systems");
  });

  it("4. Empty, scanned/blank, or corrupted PDFs produce understandable errors before calling any AI provider", async () => {
    // Corrupted PDF
    await expect(
      extractPdfText(Buffer.from("not-a-valid-pdf-binary-header"), {
        fileName: "corrupt.pdf",
      })
    ).rejects.toThrow(PdfValidationError);

    // Blank / Scanned PDF with no selectable text
    const blankPdf = await createMultiPageTextPdf(["", ""]);
    await expect(
      extractPdfText(blankPdf, { fileName: "scanned_blank.pdf" })
    ).rejects.toThrow(InsufficientMaterialError);
  });

  it("5. Extracted text is passed directly to Gemini (Primary Provider) without re-uploading raw PDF", async () => {
    const pdfBuffer = await createMultiPageTextPdf([
      "Page One covers cellular respiration, glycolysis, and ATP synthesis in mitochondria.",
      "Page Two covers the Krebs cycle, oxidative phosphorylation, and electron transport chains.",
    ]);

    const geminiMock: AIProviderAdapter = {
      name: "gemini",
      generateFromText: vi.fn().mockResolvedValue({
        payload: SAMPLE_DEVELOPMENT_DECK_PAYLOAD,
        modelUsed: "gemini-3.5-flash-lite",
      }),
    };

    const openRouterMock: AIProviderAdapter = {
      name: "openrouter",
      generateFromText: vi.fn(),
    };

    const result = await generateDeckFromPdfWithFallback(
      pdfBuffer,
      "biology.pdf",
      "job_pdf_gemini",
      undefined,
      { primary: geminiMock, fallback: openRouterMock }
    );

    expect(geminiMock.generateFromText).toHaveBeenCalledTimes(1);
    const passedText = vi.mocked(geminiMock.generateFromText).mock.calls[0][0];
    expect(passedText).toContain("PAGE 1:");
    expect(passedText).toContain("cellular respiration");
    expect(passedText).toContain("PAGE 2:");
    expect(passedText).toContain("Krebs cycle");
    expect(openRouterMock.generateFromText).not.toHaveBeenCalled();
    expect(result.aiMetadata.actualProvider).toBe("gemini");
  });

  it("6. When Gemini quota is exhausted, the exact same extracted PDF text is passed to OpenRouter", async () => {
    const pdfBuffer = await createMultiPageTextPdf([
      "First page of thermodynamics covering heat transfer, entropy, and conservation of energy.",
      "Second page of thermodynamics covering Carnot engines, isothermal expansion, and enthalpy.",
    ]);

    const geminiMock: AIProviderAdapter = {
      name: "gemini",
      generateFromText: vi
        .fn()
        .mockRejectedValue(new Error("429 RESOURCE_EXHAUSTED: Quota exceeded")),
    };

    const openRouterMock: AIProviderAdapter = {
      name: "openrouter",
      generateFromText: vi.fn().mockResolvedValue({
        payload: SAMPLE_DEVELOPMENT_DECK_PAYLOAD,
        modelUsed: "openrouter/free",
      }),
    };

    const result = await generateDeckFromPdfWithFallback(
      pdfBuffer,
      "physics.pdf",
      "job_pdf_fallback",
      undefined,
      { primary: geminiMock, fallback: openRouterMock }
    );

    expect(geminiMock.generateFromText).toHaveBeenCalledTimes(1);
    expect(openRouterMock.generateFromText).toHaveBeenCalledTimes(1);

    const geminiReceivedText = vi.mocked(geminiMock.generateFromText).mock
      .calls[0][0];
    const openRouterReceivedText = vi.mocked(openRouterMock.generateFromText)
      .mock.calls[0][0];

    // Both providers receive the exact same extracted PDF text from a single extraction pass
    expect(openRouterReceivedText).toBe(geminiReceivedText);
    expect(openRouterReceivedText).toContain("PAGE 1:");
    expect(openRouterReceivedText).toContain("PAGE 2:");
    expect(result.aiMetadata.actualProvider).toBe("openrouter");
    expect(result.aiMetadata.fallbackUsed).toBe(true);
  });

  it("7. Other configured AI providers can also receive the same extracted PDF text", async () => {
    const pdfBuffer = await createMultiPageTextPdf([
      "Macroeconomics lecture covering Gross Domestic Product, inflation, and monetary policy.",
      "Fiscal policy, central bank interest rates, supply and demand equilibrium in markets.",
    ]);

    const geminiMock: AIProviderAdapter = {
      name: "gemini",
      generateFromText: vi
        .fn()
        .mockRejectedValue(new Error("429 Gemini Quota Exhausted")),
    };

    const openRouterMock: AIProviderAdapter = {
      name: "openrouter",
      generateFromText: vi
        .fn()
        .mockRejectedValue(new Error("503 OpenRouter Temporarily Unavailable")),
    };

    const thirdProviderMock: AIProviderAdapter = {
      name: "custom-backup",
      generateFromText: vi.fn().mockResolvedValue({
        payload: SAMPLE_DEVELOPMENT_DECK_PAYLOAD,
        modelUsed: "backup-model-v1",
      }),
    };

    const result = await generateDeckFromPdfWithFallback(
      pdfBuffer,
      "economics.pdf",
      "job_pdf_third_provider",
      undefined,
      {
        primary: geminiMock,
        fallback: openRouterMock,
        additionalProviders: [thirdProviderMock],
      }
    );

    expect(thirdProviderMock.generateFromText).toHaveBeenCalledTimes(1);
    const receivedText = vi.mocked(thirdProviderMock.generateFromText).mock
      .calls[0][0];
    expect(receivedText).toContain("PAGE 1:");
    expect(receivedText).toContain("Macroeconomics");
    expect(result.payload.questions.length).toBeGreaterThan(0);
  });

  it("8 & 9. Large PDFs are chunked without losing content and questions from chunks are consolidated and deduplicated", () => {
    const pages = Array.from({ length: 12 }, (_, idx) => ({
      pageNumber: idx + 1,
      text: `Detailed academic lecture notes for chapter ${
        idx + 1
      }. This section explains core theoretical principles, mathematical formulas, and historical context in depth. `.repeat(
        4
      ),
      isEmpty: false,
      usedOcr: false,
    }));

    // Force small maxCharsPerChunk (1000 chars) to verify multi-chunk splitting
    const chunks = chunkExtractedPages(pages, 1000);
    expect(chunks.length).toBeGreaterThan(3);

    // Every single page 1..12 must be present across the chunks without any dropped pages
    const combinedChunksText = chunks.map((c) => c.text).join("\n\n");
    for (let p = 1; p <= 12; p++) {
      expect(combinedChunksText).toContain(`PAGE ${p}:`);
      expect(combinedChunksText).toContain(`chapter ${p}`);
    }

    // Consolidate and deduplicate questions generated from multiple chunks
    const chunk1Questions = SAMPLE_DEVELOPMENT_DECK_PAYLOAD.questions.slice(
      0,
      5
    );
    const chunk2Questions = [
      // Include a duplicate from chunk 1 plus remaining unique questions
      SAMPLE_DEVELOPMENT_DECK_PAYLOAD.questions[1],
      ...SAMPLE_DEVELOPMENT_DECK_PAYLOAD.questions.slice(5),
    ];

    const consolidated = validateAndDeduplicateQuestions(
      [...chunk1Questions, ...chunk2Questions],
      SAMPLE_DEVELOPMENT_DECK_PAYLOAD.topics
    );

    expect(consolidated.duplicateCount).toBe(1);
    expect(consolidated.validQuestions).toHaveLength(
      SAMPLE_DEVELOPMENT_DECK_PAYLOAD.questions.length
    );
    expect(consolidated.coverageRatio).toBe(1);
  });
});
