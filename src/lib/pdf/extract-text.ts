/**
 * Shared PDF Text Extraction Pipeline (`src/lib/pdf/extract-text.ts`)
 *
 * Provider-agnostic PDF text extraction using `pdfjs-dist` (with `pdf-lib` structural validation
 * and existing Tesseract.js OCR fallback when scanned pages are detected).
 *
 * Responsibilities:
 * 1. Validate PDF integrity, file size, encryption status, and page bounds.
 * 2. Extract selectable text from every page of the PDF while preserving reading order.
 * 3. Format page boundaries clearly as:
 *    PAGE 1:
 *    ...
 *
 *    PAGE 2:
 *    ...
 * 4. Handle empty pages gracefully and detect scanned/image-only PDFs with clear error messages.
 * 5. Split large documents into manageable, sentence/page-aligned chunks while preserving page ranges.
 */

import {
  validateAndPreparePdf,
  PdfValidationError,
} from "../gemini/pdf-processor";
import { InsufficientMaterialError } from "../gemini/client";

export interface ExtractedPdfPage {
  pageNumber: number;
  text: string;
  isEmpty: boolean;
  usedOcr: boolean;
}

export interface ExtractedPdfChunk {
  index: number;
  startPage: number;
  endPage: number;
  text: string;
  charCount: number;
}

export interface ExtractedPdfDocument {
  fileName: string;
  totalPages: number;
  fullText: string;
  totalCharCount: number;
  totalWordCount: number;
  pages: ExtractedPdfPage[];
  chunks: ExtractedPdfChunk[];
  isScannedOrOcrUsed: boolean;
}

export interface PdfExtractionOptions {
  fileName?: string;
  maxCharsPerChunk?: number;
  enableOcrFallback?: boolean;
}

export const DEFAULT_MAX_CHARS_PER_CHUNK = 32000;
const MIN_MEANINGFUL_WORDS = 20;
const MIN_MEANINGFUL_CHARS = 80;

/**
 * Formats a single page's extracted text with a consistent `PAGE N:` header.
 */
export function formatExtractedPageBlock(
  pageNumber: number,
  text: string
): string {
  const cleaned = text.trim();
  return `PAGE ${pageNumber}:\n${cleaned || "[No selectable text on this page]"}`;
}

/**
 * Splits a single very large page's text at sentence boundaries without losing content.
 */
function splitLongPageTextBySentences(
  pageNumber: number,
  text: string,
  maxChars: number
): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const parts: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (current.trim()) {
        parts.push(`PAGE ${pageNumber} (cont.):\n${current.trim()}`);
        current = "";
      }
      for (let i = 0; i < sentence.length; i += maxChars) {
        parts.push(
          `PAGE ${pageNumber} (cont.):\n${sentence.slice(i, i + maxChars).trim()}`
        );
      }
      continue;
    }

    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > maxChars && current.trim()) {
      parts.push(`PAGE ${pageNumber}:\n${current.trim()}`);
      current = sentence;
    } else {
      current = candidate;
    }
  }

  if (current.trim()) {
    parts.push(`PAGE ${pageNumber}:\n${current.trim()}`);
  }

  return parts;
}

/**
 * Splits extracted PDF pages into manageable text chunks while preserving
 * page numbers, page boundaries, and sentence boundaries.
 */
export function chunkExtractedPages(
  pages: ExtractedPdfPage[],
  maxCharsPerChunk: number = DEFAULT_MAX_CHARS_PER_CHUNK
): ExtractedPdfChunk[] {
  const safeMaxChars = Math.max(500, maxCharsPerChunk);
  const chunks: ExtractedPdfChunk[] = [];
  let currentBlocks: string[] = [];
  let currentStartPage = pages[0]?.pageNumber ?? 1;
  let currentEndPage = currentStartPage;
  let currentLength = 0;
  let chunkIndex = 0;

  for (const page of pages) {
    const formattedBlock = formatExtractedPageBlock(page.pageNumber, page.text);

    // If a single page exceeds safeMaxChars, flush current chunk and split the page along sentence boundaries
    if (formattedBlock.length > safeMaxChars) {
      if (currentBlocks.length > 0) {
        const joined = currentBlocks.join("\n\n");
        chunks.push({
          index: chunkIndex++,
          startPage: currentStartPage,
          endPage: currentEndPage,
          text: joined,
          charCount: joined.length,
        });
        currentBlocks = [];
        currentLength = 0;
      }

      const subParts = splitLongPageTextBySentences(
        page.pageNumber,
        page.text,
        safeMaxChars - 32
      );
      for (const part of subParts) {
        chunks.push({
          index: chunkIndex++,
          startPage: page.pageNumber,
          endPage: page.pageNumber,
          text: part,
          charCount: part.length,
        });
      }
      currentStartPage = page.pageNumber + 1;
      currentEndPage = currentStartPage;
      continue;
    }

    const addedLength =
      currentBlocks.length === 0
        ? formattedBlock.length
        : currentLength + 2 + formattedBlock.length;

    if (currentBlocks.length > 0 && addedLength > safeMaxChars) {
      const joined = currentBlocks.join("\n\n");
      chunks.push({
        index: chunkIndex++,
        startPage: currentStartPage,
        endPage: currentEndPage,
        text: joined,
        charCount: joined.length,
      });
      currentBlocks = [formattedBlock];
      currentStartPage = page.pageNumber;
      currentEndPage = page.pageNumber;
      currentLength = formattedBlock.length;
    } else {
      if (currentBlocks.length === 0) {
        currentStartPage = page.pageNumber;
      }
      currentBlocks.push(formattedBlock);
      currentEndPage = page.pageNumber;
      currentLength = addedLength;
    }
  }

  if (currentBlocks.length > 0) {
    const joined = currentBlocks.join("\n\n");
    chunks.push({
      index: chunkIndex++,
      startPage: currentStartPage,
      endPage: currentEndPage,
      text: joined,
      charCount: joined.length,
    });
  }

  return chunks;
}

/**
 * Extracts text from a single page using pdfjs-dist while preserving line breaks and reading order.
 */
async function extractPagesWithPdfJs(
  pdfBuffer: Buffer,
  expectedPageCount: number
): Promise<Array<{ pageNumber: number; text: string }>> {
  try {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const uint8Array = new Uint8Array(pdfBuffer);

    const loadingTask = pdfjsLib.getDocument({
      data: uint8Array,
      useSystemFonts: true,
      disableFontFace: true,
      isEvalSupported: false,
    });

    const pdfDocument = await loadingTask.promise;
    const totalPages = pdfDocument.numPages;
    const extracted: Array<{ pageNumber: number; text: string }> = [];

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
      const textContent = await page.getTextContent();
      const items = textContent.items as Array<{
        str?: string;
        hasEOL?: boolean;
      }>;

      const parts: string[] = [];
      for (const item of items) {
        if (typeof item.str === "string") {
          parts.push(item.str);
          parts.push(item.hasEOL ? "\n" : " ");
        }
      }

      const pageText = parts
        .join("")
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s*\n+/g, "\n")
        .trim();

      extracted.push({
        pageNumber: pageNum,
        text: pageText,
      });
    }

    return extracted;
  } catch {
    return extractPagesFromPdfStreamsFallback(pdfBuffer, expectedPageCount);
  }
}

/**
 * Fallback stream-based text extractor for synthetic or minimal PDFs when the pdfjs worker
 * is unavailable in constrained serverless or test environments.
 */
function extractPagesFromPdfStreamsFallback(
  buffer: Buffer,
  expectedPageCount: number
): Array<{ pageNumber: number; text: string }> {
  const raw = buffer.toString("latin1");
  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  const pageTexts: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = streamRegex.exec(raw)) !== null) {
    const streamBody = match[1];
    // Match parenthesized strings (...) or hex strings <...> in PDF content streams
    const parenMatches = streamBody.match(/\(([^()\\]*(?:\\.[^()\\]*)*)\)/g) || [];
    const hexMatches = streamBody.match(/<([0-9A-Fa-f]{4,})>/g) || [];

    const tokens: string[] = [];
    for (const pm of parenMatches) {
      const inner = pm
        .slice(1, -1)
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, " ")
        .replace(/\\\(/g, "(")
        .replace(/\\\)/g, ")");
      if (inner.trim().length > 0) {
        tokens.push(inner.trim());
      }
    }

    for (const hm of hexMatches) {
      const hex = hm.slice(1, -1);
      if (hex.length % 2 === 0) {
        const str = Buffer.from(hex, "hex")
          .toString("latin1")
          .replace(/[^\x20-\x7E\n]/g, "")
          .trim();
        if (str.length >= 2) {
          tokens.push(str);
        }
      }
    }

    if (tokens.length > 0) {
      pageTexts.push(tokens.join(" ").replace(/\s+/g, " ").trim());
    }
  }

  const results: Array<{ pageNumber: number; text: string }> = [];
  for (let i = 0; i < expectedPageCount; i++) {
    results.push({
      pageNumber: i + 1,
      text: pageTexts[i] ?? "",
    });
  }
  return results;
}

/**
 * Optional OCR fallback via Tesseract.js if a scanned page is detected and OCR is enabled.
 */
async function attemptTesseractOcrOnBuffer(
  buffer: Buffer
): Promise<string | null> {
  try {
    const Tesseract = await import("tesseract.js");
    const result = await Promise.race([
      Tesseract.recognize(buffer, "eng"),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 10000)),
    ]);
    if (result && "data" in result && result.data?.text) {
      return result.data.text.trim();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Shared PDF text extraction function used across the entire application.
 *
 * 1. Validates PDF file type, size, header, encryption, and structural integrity.
 * 2. Extracts text from every page using `pdfjs-dist`, preserving page numbers (`PAGE 1:`, `PAGE 2:`, ...).
 * 3. Handles empty pages gracefully and detects scanned/image-only documents.
 * 4. Validates that the extracted document contains meaningful educational text before calling any AI provider.
 * 5. Splits large documents into manageable chunks without losing content or splitting mid-sentence.
 */
export async function extractPdfText(
  pdfBuffer: Buffer,
  options: PdfExtractionOptions = {}
): Promise<ExtractedPdfDocument> {
  const fileName = options.fileName || "document.pdf";
  const maxCharsPerChunk =
    options.maxCharsPerChunk || DEFAULT_MAX_CHARS_PER_CHUNK;

  // 1. Validate PDF integrity, file size, encryption, and page count
  const validatedInfo = await validateAndPreparePdf(
    pdfBuffer,
    fileName,
    "application/pdf"
  );

  // 2. Extract selectable text from every page
  const rawPages = await extractPagesWithPdfJs(
    pdfBuffer,
    validatedInfo.pageCount
  );

  const pages: ExtractedPdfPage[] = [];
  let isScannedOrOcrUsed = false;

  for (let i = 0; i < validatedInfo.pageCount; i++) {
    const pageNumber = i + 1;
    let pageText = rawPages[i]?.text?.trim() ?? "";
    let usedOcr = false;

    if (pageText.length === 0 && options.enableOcrFallback) {
      const ocrText = await attemptTesseractOcrOnBuffer(pdfBuffer);
      if (ocrText && ocrText.length > 0) {
        pageText = ocrText;
        usedOcr = true;
        isScannedOrOcrUsed = true;
      }
    }

    pages.push({
      pageNumber,
      text: pageText,
      isEmpty: pageText.length === 0,
      usedOcr,
    });
  }

  // 3. Check total meaningful text across all pages
  const combinedRawText = pages
    .map((p) => p.text)
    .filter((t) => t.length > 0)
    .join(" ")
    .trim();

  const words = combinedRawText.split(/\s+/).filter((w) => w.length > 1);
  const uniqueWords = new Set(words.map((w) => w.toLowerCase()));

  if (
    combinedRawText.length < MIN_MEANINGFUL_CHARS ||
    words.length < MIN_MEANINGFUL_WORDS ||
    uniqueWords.size < 8
  ) {
    throw new InsufficientMaterialError(
      "This PDF contains little or no selectable text (it may be a scanned or image-only document). Please upload a PDF with selectable text or paste your study notes directly."
    );
  }

  // 4. Build full normalized text with PAGE N: headers and chunk for AI context limits
  const fullText = pages
    .map((p) => formatExtractedPageBlock(p.pageNumber, p.text))
    .join("\n\n");

  const chunks = chunkExtractedPages(pages, maxCharsPerChunk);

  return {
    fileName,
    totalPages: validatedInfo.pageCount,
    fullText,
    totalCharCount: fullText.length,
    totalWordCount: words.length,
    pages,
    chunks,
    isScannedOrOcrUsed,
  };
}

export { PdfValidationError };
