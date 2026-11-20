/**
 * Backwards-compatible re-export of the shared PDF text extraction module (`src/lib/pdf/extract-text.ts`).
 */
export {
  extractPdfText as extractTextFromPdfForFallback,
  extractPdfText,
  chunkExtractedPages,
  formatExtractedPageBlock,
  type ExtractedPdfPage,
  type ExtractedPdfChunk as ExtractedPdfSection,
  type ExtractedPdfDocument,
} from "../pdf/extract-text";
