import { describe, it, expect } from "vitest";
import {
  GeneratedQuestionSchema,
  GeneratedDeckPayloadSchema,
} from "../src/lib/schemas/deck";
import { validateAndDeduplicateQuestions } from "../src/lib/prompts/question-validation";
import { SAMPLE_DEVELOPMENT_DECK_PAYLOAD } from "../src/lib/sample-deck";

describe("Gemini Structured Output & Four-Option Question Validation", () => {
  it("validates the complete sample development deck payload against Zod schema", () => {
    const parsed = GeneratedDeckPayloadSchema.safeParse(
      SAMPLE_DEVELOPMENT_DECK_PAYLOAD
    );
    expect(parsed.success).toBe(true);
  });

  it("rejects a question that does not have exactly 4 answer options", () => {
    const threeOptionQuestion = {
      question: "Which layer handles routing?",
      options: [
        { id: "A", text: "Physical layer" },
        { id: "B", text: "Network layer" },
        { id: "C", text: "Transport layer" },
      ],
      correctOptionId: "B",
      explanation: "The network layer routes packets across networks.",
      topic: "OSI Model",
      difficulty: "easy",
      learningObjective: "Understand the network layer.",
    };

    const result = GeneratedQuestionSchema.safeParse(threeOptionQuestion);
    expect(result.success).toBe(false);
  });

  it("rejects a question where two options have duplicate text", () => {
    const duplicateOptionTextQuestion = {
      question: "Which layer handles routing across networks?",
      options: [
        { id: "A", text: "Network layer" },
        { id: "B", text: "Network layer" },
        { id: "C", text: "Transport layer" },
        { id: "D", text: "Application layer" },
      ],
      correctOptionId: "A",
      explanation: "The network layer routes packets across networks.",
      topic: "OSI Model",
      difficulty: "easy",
      learningObjective: "Understand the network layer.",
    };

    const result = GeneratedQuestionSchema.safeParse(
      duplicateOptionTextQuestion
    );
    expect(result.success).toBe(false);
  });

  it("rejects a question where correctOptionId does not match A, B, C, or D", () => {
    const badCorrectIdQuestion = {
      question: "Which layer handles routing across networks?",
      options: [
        { id: "A", text: "Physical layer" },
        { id: "B", text: "Network layer" },
        { id: "C", text: "Transport layer" },
        { id: "D", text: "Application layer" },
      ],
      correctOptionId: "E",
      explanation: "The network layer routes packets across networks.",
      topic: "OSI Model",
      difficulty: "easy",
      learningObjective: "Understand the network layer.",
    };

    const result = GeneratedQuestionSchema.safeParse(badCorrectIdQuestion);
    expect(result.success).toBe(false);
  });
});

describe("Duplicate Detection and Topic Coverage Verification", () => {
  it("detects and removes duplicate or near-duplicate questions while calculating topic coverage", () => {
    const baseQ = SAMPLE_DEVELOPMENT_DECK_PAYLOAD.questions[0];
    const nearDuplicateQ = {
      ...baseQ,
      question:
        "Which layer of the OSI model is responsible for logical addressing and determining the best path for packets across different networks?",
    };
    const secondTopicQ = SAMPLE_DEVELOPMENT_DECK_PAYLOAD.questions[3];

    const topics = [
      {
        name: "OSI & TCP/IP Reference Models",
        subtopics: ["Layers"],
        coverageNotes: "Test layers",
      },
      {
        name: "Network Layer & Routing",
        subtopics: ["ARP"],
        coverageNotes: "Test ARP",
      },
      {
        name: "Uncovered Quantum Networking Topic",
        subtopics: ["QKD"],
        coverageNotes: "Test quantum",
      },
    ];

    const validation = validateAndDeduplicateQuestions(
      [baseQ, nearDuplicateQ, secondTopicQ],
      topics
    );

    expect(validation.validQuestions).toHaveLength(2);
    expect(validation.duplicateCount).toBe(1);
    expect(validation.coveredTopics).toContain("OSI & TCP/IP Reference Models");
    expect(validation.coveredTopics).toContain("Network Layer & Routing");
    expect(validation.uncoveredTopics).toContain(
      "Uncovered Quantum Networking Topic"
    );
    expect(validation.coverageRatio).toBeCloseTo(2 / 3, 2);
  });
});
