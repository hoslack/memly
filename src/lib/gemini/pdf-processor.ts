import { PDFDocument } from "pdf-lib";

export const MAX_PDF_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB maximum upload size
export const INLINE_PDF_THRESHOLD_BYTES = 4 * 1024 * 1024; // 4 MB threshold for inline vs Files API
export const PAGES_PER_SECTION_CHUNK = 18; // Split large PDFs (> 22 pages) into ~18-page sections

export class PdfValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfValidationError";
  }
}

export interface ValidatedPdfInfo {
  pageCount: number;
  byteLength: number;
  title?: string;
  author?: string;
  isEncrypted: boolean;
  sections: PdfSectionChunk[];
}

export interface PdfSectionChunk {
  index: number;
  startPage: number; // 1-based inclusive
  endPage: number; // 1-based inclusive
  buffer: Buffer;
}

/**
 * Validates a PDF buffer for:
 * 1. Non-empty file size and maximum size bounds
 * 2. PDF magic header (%PDF-)
 * 3. Structural PDF integrity via pdf-lib
 * 4. Encryption status and readable page count (> 0 pages)
 * 5. Content streams existence check so totally blank/corrupt shells are rejected
 * 6. Section chunking for large multi-page documents
 */
export async function validateAndPreparePdf(
  buffer: Buffer,
  fileName = "document.pdf",
  mimeType = "application/pdf"
): Promise<ValidatedPdfInfo> {
  if (!buffer || buffer.byteLength === 0) {
    throw new PdfValidationError("The uploaded PDF file is empty.");
  }

  if (buffer.byteLength < 64) {
    throw new PdfValidationError(
      "The file is too small to be a valid PDF document."
    );
  }

  if (buffer.byteLength > MAX_PDF_SIZE_BYTES) {
    const sizeMb = (buffer.byteLength / (1024 * 1024)).toFixed(1);
    throw new PdfValidationError(
      `PDF file size (${sizeMb} MB) exceeds the 20 MB maximum limit. Please upload a smaller PDF or individual chapters.`
    );
  }

  const normalizedMime = mimeType.toLowerCase();
  const hasPdfExt = fileName.toLowerCase().endsWith(".pdf");
  if (
    normalizedMime &&
    normalizedMime !== "application/pdf" &&
    normalizedMime !== "application/x-pdf" &&
    !hasPdfExt
  ) {
    throw new PdfValidationError(
      `Unsupported file type "${mimeType}". Please upload a valid PDF document (.pdf).`
    );
  }

  // Check %PDF- header within first 1024 bytes
  const headerSlice = buffer.subarray(0, Math.min(1024, buffer.byteLength)).toString("latin1");
  if (!headerSlice.includes("%PDF-")) {
    throw new PdfValidationError(
      "Invalid PDF file format: missing %PDF- header signature. The file may be corrupted or renamed from another format."
    );
  }

  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(buffer, {
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("encrypted")) {
      throw new PdfValidationError(
        "This PDF is password-protected or encrypted. Please upload an unlocked PDF so Gemini can read your notes."
      );
    }
    throw new PdfValidationError(
      "Corrupted or unreadable PDF structure. Please export or save the PDF again and retry."
    );
  }

  if (pdfDoc.isEncrypted) {
    throw new PdfValidationError(
      "This PDF is encrypted. Please remove password protection before uploading."
    );
  }

  const pageCount = pdfDoc.getPageCount();
  if (pageCount <= 0) {
    throw new PdfValidationError("The PDF document contains 0 pages.");
  }

  if (pageCount > 400) {
    throw new PdfValidationError(
      `This PDF has ${pageCount} pages. To ensure thorough exam coverage and fast generation, please upload lecture notes or chapters up to 400 pages at a time.`
    );
  }

  // Verify the PDF has actual content streams or embedded resources (not just an empty blank shell)
  const rawStringSample = buffer
    .subarray(0, Math.min(buffer.byteLength, 65536))
    .toString("latin1");
  const hasStreamObjects =
    rawStringSample.includes("stream") && rawStringSample.includes("endstream");
  if (!hasStreamObjects) {
    throw new PdfValidationError(
      "The PDF does not appear to contain any readable text, images, or page streams."
    );
  }

  const sections: PdfSectionChunk[] = [];

  if (pageCount <= 22) {
    sections.push({
      index: 0,
      startPage: 1,
      endPage: pageCount,
      buffer,
    });
  } else {
    // Split large PDF into section chunks of PAGES_PER_SECTION_CHUNK pages
    let chunkIndex = 0;
    for (let start = 0; start < pageCount; start += PAGES_PER_SECTION_CHUNK) {
      const end = Math.min(start + PAGES_PER_SECTION_CHUNK, pageCount);
      const pageIndices: number[] = [];
      for (let p = start; p < end; p++) {
        pageIndices.push(p);
      }

      const subDoc = await PDFDocument.create();
      const copiedPages = await subDoc.copyPages(pdfDoc, pageIndices);
      for (const page of copiedPages) {
        subDoc.addPage(page);
      }
      const subBytes = await subDoc.save();

      sections.push({
        index: chunkIndex++,
        startPage: start + 1,
        endPage: end,
        buffer: Buffer.from(subBytes),
      });
    }
  }

  return {
    pageCount,
    byteLength: buffer.byteLength,
    title: pdfDoc.getTitle() || undefined,
    author: pdfDoc.getAuthor() || undefined,
    isEncrypted: pdfDoc.isEncrypted,
    sections,
  };
}
