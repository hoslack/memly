import { describe, it, expect } from "vitest";
import {
  parseImportedDeck,
  parseJsonDeck,
  parseCsvDeck,
  DeckImportError,
} from "../src/lib/import/deck-importer";

describe("Direct JSON & CSV Deck Importer (Zero AI Credits)", () => {
  it("parses a full Memly JSON object wrapped in markdown code fences", () => {
    const rawJson = `\`\`\`json
{
  "deckTitle": "Operating Systems Fundamentals",
  "subject": "Computer Science",
  "description": "Covers processes, threads, virtual memory, and scheduling.",
  "questions": [
    {
      "question": "What is the main difference between a process and a thread?",
      "options": [
        { "id": "A", "text": "Threads have separate address spaces while processes share memory" },
        { "id": "B", "text": "Processes have separate address spaces while threads within a process share memory" },
        { "id": "C", "text": "Processes cannot be context-switched by the OS kernel" },
        { "id": "D", "text": "Threads can only run on single-core processors" }
      ],
      "correctOptionId": "B",
      "explanation": "Processes are isolated with their own virtual address space, whereas threads within the same process share code, data, and heap segments.",
      "topic": "Processes & Threads",
      "difficulty": "medium",
      "learningObjective": "Distinguish between process isolation and thread memory sharing."
    }
  ]
}
\`\`\``;

    const { payload, detectedFormat } = parseImportedDeck(rawJson);
    expect(detectedFormat).toBe("json");
    expect(payload.deckTitle).toBe("Operating Systems Fundamentals");
    expect(payload.subject).toBe("Computer Science");
    expect(payload.questions).toHaveLength(1);
    expect(payload.questions[0].correctOptionId).toBe("B");
    expect(payload.topics).toHaveLength(1);
    expect(payload.topics[0].name).toBe("Processes & Threads");
  });

  it("parses a simplified JSON array of questions with flat optionA..D or string array options", () => {
    const simpleArray = JSON.stringify([
      {
        question: "Which planet is known as the Red Planet?",
        options: ["Venus", "Mars", "Jupiter", "Saturn"],
        answer: "B",
        explanation: "Iron oxide on Mars's surface gives it a reddish appearance.",
        topic: "Astronomy",
      },
      {
        question: "What is the chemical symbol for gold?",
        optionA: "Ag",
        optionB: "Fe",
        optionC: "Au",
        optionD: "Pb",
        correctAnswer: "C",
        topic: "Chemistry",
      },
    ]);

    const payload = parseJsonDeck(simpleArray, {
      customTitle: "Science Quick Quiz",
      customSubject: "General Science",
    });

    expect(payload.deckTitle).toBe("Science Quick Quiz");
    expect(payload.subject).toBe("General Science");
    expect(payload.questions).toHaveLength(2);
    expect(payload.questions[0].options[1]).toEqual({ id: "B", text: "Mars" });
    expect(payload.questions[1].correctOptionId).toBe("C");
    expect(payload.topics.map((t) => t.name)).toEqual(["Astronomy", "Chemistry"]);
  });

  it("parses a CSV with a header row and quoted commas", () => {
    const csvInput = `question,optionA,optionB,optionC,optionD,correctOptionId,explanation,topic,difficulty
"What is the time complexity of binary search on a sorted array of n elements?","O(n)","O(log n)","O(n log n)","O(1)","B","Binary search halves the search space on each comparison, yielding O(log n) time complexity.","Algorithms","easy"
"Which data structure operates on a First-In, First-Out (FIFO) basis?","Stack","Binary Heap","Queue","Hash Table","C","A Queue removes elements in the exact order they were inserted (FIFO).","Data Structures","easy"`;

    const { payload, detectedFormat } = parseImportedDeck(csvInput, {
      customTitle: "DSA Midterm Prep",
    });

    expect(detectedFormat).toBe("csv");
    expect(payload.deckTitle).toBe("DSA Midterm Prep");
    expect(payload.questions).toHaveLength(2);
    expect(payload.questions[0].correctOptionId).toBe("B");
    expect(payload.questions[1].topic).toBe("Data Structures");
    expect(payload.topics).toHaveLength(2);
  });

  it("throws a helpful DeckImportError when options or correctOptionId are invalid", () => {
    const badJson = JSON.stringify({
      questions: [
        {
          question: "Which option is right?",
          options: ["Only one", "Only two"],
          correctOptionId: "A",
        },
      ],
    });

    expect(() => parseJsonDeck(badJson)).toThrow(DeckImportError);
  });
});
