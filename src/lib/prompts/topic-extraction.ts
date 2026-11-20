/**
 * Dedicated prompt instructions for Consolidating multi-section Topic Inventories on large PDFs/documents.
 */
import { DocumentAnalysis } from "../schemas/deck";

export function buildTopicConsolidationPrompt(
  sectionAnalyses: DocumentAnalysis[]
): string {
  return `You have analysed a large document across ${sectionAnalyses.length} sequential sections.
Combine these section analyses into a single unified DocumentAnalysis and Topic Coverage Plan covering the entire document evenly.

Section Analyses JSON:
${JSON.stringify(sectionAnalyses, null, 2)}

Ensure:
1. All distinct major topics from all sections are preserved.
2. Target question counts are balanced across the entire document.
3. No section of the document is ignored.`;
}
