import { extractText, getDocumentProxy } from "unpdf";

export type PdfTextResult = {
  pageCount: number;
  text: string;
};

// Reads whatever embedded text layer the PDF already has — fast and free,
// but produces little or nothing for a scanned/image-only PDF. That case is
// handled by sending the page image to Claude's vision input at extraction
// time (Phase 3 item 5) instead of running a separate OCR pipeline.
export async function extractPdfText(bytes: Uint8Array): Promise<PdfTextResult> {
  const pdf = await getDocumentProxy(bytes);
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  return { pageCount: totalPages, text };
}
