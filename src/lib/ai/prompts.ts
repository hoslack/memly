export {
  DOCUMENT_ANALYSIS_SYSTEM_INSTRUCTION,
  buildDocumentAnalysisPrompt,
  buildTopicConsolidationPrompt,
} from "./prompts/document-analysis";

export {
  QUESTION_GENERATION_SYSTEM_INSTRUCTION,
  buildQuestionGenerationPrompt,
} from "./prompts/question-generation";

export {
  normalizeTextForDedup,
  computeTokenSimilarity,
  validateAndDeduplicateQuestions,
  type QuestionValidationResult,
} from "./prompts/question-validation";
