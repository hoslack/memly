/**
 * Dedicated prompt instructions for Stage 2: Examination Question Generation.
 */
import { DocumentAnalysis, TopicItem } from "../schemas/deck";

export const QUESTION_GENERATION_SYSTEM_INSTRUCTION = `You are an experienced university and secondary-school examination setter, curriculum analyst and educational assessment specialist.

Your task is to transform the supplied learning material into a comprehensive examination revision deck.

Your priority is to help a student understand and remember the most examinable information in the material.

First, understand the entire source material. Identify all topics, subtopics, concepts, definitions, processes, examples, classifications and relationships.

Do not start generating questions based only on the beginning of the document.

Create a topic coverage plan before generating questions.

Generate original, high-quality multiple-choice questions that test recall, comprehension, application and analysis.

Every question must have exactly four distinct answer options and exactly one defensible correct answer.

The incorrect options should be plausible and educationally useful.

Provide a concise explanation of the correct answer that teaches the student why it is correct.

Every question must be supported by the supplied material. Include source page or section references where possible.

Avoid duplicate questions, vague wording, trick questions, unsupported assumptions and repetitive testing of the same concept.

Prioritise important concepts, but ensure broad coverage of the entire material.

The final output must conform exactly to the provided JSON schema.

Do not include conversational introductions, Markdown fences or commentary outside the required structured output.

If the source material is insufficient to generate reliable questions, report this clearly rather than inventing content.`;

export function buildQuestionGenerationPrompt(params: {
  analysis: DocumentAnalysis;
  targetTopics?: TopicItem[];
  targetQuestionCount?: number;
  existingQuestionStems?: string[];
  sectionContext?: string;
}): string {
  const topicsToCover = params.targetTopics ?? params.analysis.topics;
  const count =
    params.targetQuestionCount ?? params.analysis.recommendedQuestionCount;

  const topicPlanText = topicsToCover
    .map(
      (t, idx) =>
        `${idx + 1}. Topic: "${t.name}" (Target questions: ${
          t.targetQuestionCount ?? "proportional"
        })\n   - Subtopics: ${t.subtopics.join(", ") || "General"}\n   - Coverage focus: ${
          t.coverageNotes
        }\n   - Source reference: ${t.sourcePagesOrSections || "Document"}`
    )
    .join("\n");

  const existingAvoidance =
    params.existingQuestionStems && params.existingQuestionStems.length > 0
      ? `\nDO NOT repeat or rephrase any of these already-generated questions:\n${params.existingQuestionStems
          .map((q) => `- ${q}`)
          .join("\n")}`
      : "";

  return `Generate approximately ${count} high-quality multiple-choice examination questions based strictly on the provided source material and the Stage 1 Topic Coverage Plan below.

DECK METADATA:
- Title: ${params.analysis.deckTitle}
- Subject: ${params.analysis.subject}
- Main Purpose: ${params.analysis.mainPurpose}
${params.sectionContext ? `- Section Scope: ${params.sectionContext}` : ""}

STAGE 1 TOPIC COVERAGE PLAN:
${topicPlanText}

KEY DEFINITIONS & CONCEPTS TO INCLUDE:
- Definitions: ${params.analysis.keyDefinitions.join("; ") || "See source text"}
- Principles & Processes: ${
    params.analysis.corePrinciplesAndProcesses.join("; ") || "See source text"
  }
- Tables/Diagrams/Visuals: ${
    params.analysis.visualsTablesDiagramsNotes.join("; ") || "None noted"
  }

COGNITIVE LEVEL DISTRIBUTION:
Ensure the generated questions span all four cognitive levels:
1. "remembering": Definitions, facts, dates, classifications, and terminology.
2. "understanding": Explaining concepts, summarizing mechanisms, and identifying relationships.
3. "application": Applying principles or procedures to practical situations or examples.
4. "analysis": Interpreting scenarios, comparing mechanisms, and distinguishing between closely related concepts.

STRICT QUALITY REQUIREMENTS:
- Every question MUST have options with IDs "A", "B", "C", and "D", all with distinct, plausible texts.
- Vary the position of the correctOptionId ("A", "B", "C", "D") naturally across questions.
- Write clear, educational explanations that state why the correct option is right and why common misconceptions fail.
- Populate sourceReference.page (integer if known, otherwise null) and sourceReference.section (heading or topic section).
- Write a concise learningObjective for every question (e.g., "Understand why TCP uses a three-way handshake").${existingAvoidance}

REQUIRED JSON OUTPUT FORMAT:
Return a single JSON object with a "questions" array matching this exact structure:
{
  "questions": [
    {
      "question": "Clear multiple-choice question?",
      "options": [
        { "id": "A", "text": "First option" },
        { "id": "B", "text": "Second option" },
        { "id": "C", "text": "Third option" },
        { "id": "D", "text": "Fourth option" }
      ],
      "correctOptionId": "B",
      "explanation": "Concise explanation of why B is correct and others are wrong.",
      "topic": "Topic Name from Coverage Plan",
      "subtopic": "Subtopic Name",
      "difficulty": "easy" | "medium" | "hard",
      "cognitiveLevel": "remembering" | "understanding" | "application" | "analysis",
      "sourceReference": {
        "page": 1,
        "section": "Section name"
      },
      "learningObjective": "Understand the key concept tested."
    }
  ]
}`;
}
