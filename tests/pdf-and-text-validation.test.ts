import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  validateAndPreparePdf,
  PdfValidationError,
  MAX_PDF_SIZE_BYTES,
} from "../src/lib/gemini/pdf-processor";
import { TextSubmissionSchema } from "../src/lib/schemas/study";

async function createSamplePdfBuffer(pageCount: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle("Test Exam Notes");
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([600, 800]);
    page.drawText(
      `Lecture Page ${i + 1}: The OSI Model and TCP/IP networking layers.`,
      { x: 50, y: 700, size: 14 }
    );
  }
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

describe("PDF Validation and Section Processing", () => {
  it("accepts a valid single-page PDF and extracts page count", async () => {
    const buffer = await createSamplePdfBuffer(3);
    const info = await validateAndPreparePdf(buffer, "notes.pdf", "application/pdf");

    expect(info.pageCount).toBe(3);
    expect(info.isEncrypted).toBe(false);
    expect(info.sections).toHaveLength(1);
    expect(info.sections[0].startPage).toBe(1);
    expect(info.sections[0].endPage).toBe(3);
  });

  it("splits a large multi-page PDF (>22 pages) into section chunks", async () => {
    const buffer = await createSamplePdfBuffer(30);
    const info = await validateAndPreparePdf(buffer, "large_notes.pdf", "application/pdf");

    expect(info.pageCount).toBe(30);
    expect(info.sections).toHaveLength(2);
    expect(info.sections[0].startPage).toBe(1);
    expect(info.sections[0].endPage).toBe(18);
    expect(info.sections[1].startPage).toBe(19);
    expect(info.sections[1].endPage).toBe(30);
  });

  it("rejects an empty PDF buffer", async () => {
    await expect(
      validateAndPreparePdf(Buffer.alloc(0), "empty.pdf", "application/pdf")
    ).rejects.toThrow(PdfValidationError);
  });

  it("rejects a non-PDF file missing the %PDF- header", async () => {
    const fakeBuffer = Buffer.from(
      "This is just a plain text file pretending to be a PDF document with enough bytes to pass the minimum length check."
    );
    await expect(
      validateAndPreparePdf(fakeBuffer, "fake.pdf", "application/pdf")
    ).rejects.toThrow(/missing %PDF- header/i);
  });

  it("rejects unsupported MIME types and extensions", async () => {
    const buffer = await createSamplePdfBuffer(1);
    await expect(
      validateAndPreparePdf(buffer, "image.png", "image/png")
    ).rejects.toThrow(/Unsupported file type/i);
  });

  it("rejects files exceeding the 20 MB maximum size", async () => {
    const oversized = Buffer.alloc(MAX_PDF_SIZE_BYTES + 1024, 0x20);
    await expect(
      validateAndPreparePdf(oversized, "huge.pdf", "application/pdf")
    ).rejects.toThrow(/exceeds the 20 MB maximum limit/i);
  });
});

describe("Text Submission Validation", () => {
  it("rejects empty or overly short text submissions (<120 chars)", () => {
    const shortResult = TextSubmissionSchema.safeParse({
      text: "Too short notes.",
    });
    expect(shortResult.success).toBe(false);
  });

  it("accepts meaningful pasted lecture notes (>=120 chars)", () => {
    const validNotes =
      "Photosynthesis converts light energy into chemical energy stored in glucose molecules. The light-dependent reactions occur in the thylakoid membranes and produce ATP and NADPH, while the Calvin cycle takes place in the stroma.";
    const parsed = TextSubmissionSchema.safeParse({ text: validNotes });
    expect(parsed.success).toBe(true);
  });
});
