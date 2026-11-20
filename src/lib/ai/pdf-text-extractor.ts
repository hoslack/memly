/**
 * PDF Text & OCR Extraction Pipeline for OpenRouter Fallback.
 *
 * When Gemini is available, native multimodal PDF processing is used directly.
 * When Gemini quota is exhausted or temporarily unavailable and the system falls back
 * to OpenRouter, this module:
 * 1. Extracts text page-by-page using pdfjs-dist while preserving [Page N] markers.
 * 2. Detects scanned or image-only PDFs (where extracted text per page is minimal).
 * 3. Runs OCR via Tesseract.js when scanned content is detected.
 * 4. Splits large documents into manageable text section chunks with page ranges.
 */

export interface ExtractedPdfPage {
  pageNumber: number;
  text: string;
  usedOcr: boolean;
}

export interface ExtractedPdfSection {
  index: number;
  startPage: number;
  endPage: number;
  text: string;
}

export interface ExtractedPdfDocument {
  totalPages: number;
  fullText: string;
  pages: ExtractedPdfPage[];
  sections: ExtractedPdfSection[];
  isScannedOrOcrUsed: boolean;
}

const MIN_CHARS_PER_PAGE_BEFORE_OCR = 35;
const MAX_CHARS_PER_TEXT_SECTION = 38000;

/**
 * Extracts text from a PDF buffer using pdfjs-dist, preserving page numbers.
 * Falls back to Tesseract.js OCR if pages appear to be scanned/image-only.
 */
export async function extractTextFromPdfForFallback(
  pdfBuffer: Buffer
): Promise<ExtractedPdfDocument> {
  const pages: ExtractedPdfPage[] = [];
  let isScannedOrOcrUsed = false;

  try {
    // Dynamically import pdfjs-dist legacy build for Node.js server environment
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

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
      const textContent = await page.getTextContent();
      const rawItems = textContent.items as Array<{ str?: string }>;
      let pageText = rawItems
        .map((item) => item.str || "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      let usedOcr = false;

      // Detect scanned page with minimal selectable text
      if (pageText.length < MIN_CHARS_PER_PAGE_BEFORE_OCR) {
        const ocrText = await attemptTesseractOcrOnBuffer(pdfBuffer);
        if (ocrText && ocrText.trim().length > pageText.length) {
          pageText = ocrText.trim();
          usedOcr = true;
          isScannedOrOcrUsed = true;
        }
      }

      pages.push({
        pageNumber: pageNum,
        text: pageText,
        usedOcr,
      });
    }
  } catch {
    // Fallback heuristic stream text extraction if pdfjs worker initialization encounters a platform edge case
    const fallbackText = extractBasicStringsFromPdfBuffer(pdfBuffer);
    pages.push({
      pageNumber: 1,
      text: fallbackText,
      usedOcr: false,
    });
  }

  const totalPages = pages.length;
  const formattedPageBlocks = pages.map(
    (p) => `[Page ${p.pageNumber}]\n${p.text}`
  );
  const fullText = formattedPageBlocks.join("\n\n").trim();

  // Split into manageable sections while preserving page boundaries
  const sections: ExtractedPdfSection[] = [];
  let currentChunkPages: ExtractedPdfPage[] = [];
  let currentCharCount = 0;
  let sectionIndex = 0;

  for (const page of pages) {
    const pageBlockLen = page.text.length + 20;
    if (
      currentChunkPages.length > 0 &&
      currentCharCount + pageBlockLen > MAX_CHARS_PER_TEXT_SECTION
    ) {
      sections.push({
        index: sectionIndex++,
        startPage: currentChunkPages[0].pageNumber,
        endPage: currentChunkPages[currentChunkPages.length - 1].pageNumber,
        text: currentChunkPages
          .map((p) => `[Page ${p.pageNumber}]\n${p.text}`)
          .join("\n\n"),
      });
      currentChunkPages = [];
      currentCharCount = 0;
    }

    currentChunkPages.push(page);
    currentCharCount += pageBlockLen;
  }

  if (currentChunkPages.length > 0) {
    sections.push({
      index: sectionIndex++,
      startPage: currentChunkPages[0].pageNumber,
      endPage: currentChunkPages[currentChunkPages.length - 1].pageNumber,
      text: currentChunkPages
        .map((p) => `[Page ${p.pageNumber}]\n${p.text}`)
        .join("\n\n"),
    });
  }

  return {
    totalPages,
    fullText,
    pages,
    sections,
    isScannedOrOcrUsed,
  };
}

/**
 * Attempts OCR via Tesseract.js if a scanned page or image buffer is detected.
 */
async function attemptTesseractOcrOnBuffer(buffer: Buffer): Promise<string | null> {
  try {
    const Tesseract = await import("tesseract.js");
    const result = await Promise.race([
      Tesseract.recognize(buffer, "eng"),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 12000)),
    ]);
    if (result && "data" in result && result.data?.text) {
      return result.data.text;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extracts readable ASCII/parenthesized text literals from a PDF buffer as a last-resort backup.
 */
function extractBasicStringsFromPdfBuffer(buffer: Buffer): string {
  const raw = buffer.toString("latin1");
  const matches = raw.match(/\(([^()\\]{3,})\)/g) || [];
  return matches
    .map((m) => m.slice(1, -1))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
