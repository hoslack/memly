import { GeneratedDeckPayload } from "./schemas/deck";

export const SAMPLE_DEVELOPMENT_DECK_PAYLOAD: GeneratedDeckPayload = {
  deckTitle: "Everyday Math & World Geography",
  subject: "General Knowledge",
  description:
    "A fun, beginner-friendly revision deck with simple everyday math and world geography questions to test out Memly flashcards.",
  topics: [
    {
      name: "Simple Everyday Math",
      subtopics: ["Basic arithmetic", "Percentages", "Shapes & time"],
      coverageNotes:
        "Covers quick mental arithmetic, simple percentages, and basic geometry.",
      targetQuestionCount: 5,
      sourcePagesOrSections: "Section 1: Everyday Math",
    },
    {
      name: "World Geography & Continents",
      subtopics: ["Capital cities", "Oceans & rivers", "Continents & landmarks"],
      coverageNotes:
        "Covers well-known countries, capital cities, oceans, and continents.",
      targetQuestionCount: 5,
      sourcePagesOrSections: "Section 2: World Geography",
    },
  ],
  questions: [
    {
      question: "What is 15 + 27?",
      options: [
        { id: "A", text: "32" },
        { id: "B", text: "42" },
        { id: "C", text: "45" },
        { id: "D", text: "52" },
      ],
      correctOptionId: "B",
      explanation:
        "Adding the tens (10 + 20 = 30) and the ones (5 + 7 = 12) gives 30 + 12 = 42.",
      topic: "Simple Everyday Math",
      subtopic: "Basic arithmetic",
      difficulty: "easy",
      cognitiveLevel: "remembering",
      sourceReference: {
        page: 1,
        section: "1.1 Addition & Subtraction",
      },
      learningObjective: "Perform quick two-digit mental addition.",
    },
    {
      question:
        "If a notebook costs $8 and you buy 4 notebooks, how much do you spend in total?",
      options: [
        { id: "A", text: "$24" },
        { id: "B", text: "$28" },
        { id: "C", text: "$32" },
        { id: "D", text: "$36" },
      ],
      correctOptionId: "C",
      explanation:
        "Multiplying 4 notebooks by $8 each gives 4 × 8 = $32.",
      topic: "Simple Everyday Math",
      subtopic: "Basic arithmetic",
      difficulty: "easy",
      cognitiveLevel: "application",
      sourceReference: {
        page: 1,
        section: "1.2 Multiplication in Daily Life",
      },
      learningObjective: "Apply basic multiplication to everyday shopping.",
    },
    {
      question: "What is 50% (half) of 80?",
      options: [
        { id: "A", text: "20" },
        { id: "B", text: "30" },
        { id: "C", text: "40" },
        { id: "D", text: "50" },
      ],
      correctOptionId: "C",
      explanation:
        "50% means one-half. Dividing 80 by 2 gives 40.",
      topic: "Simple Everyday Math",
      subtopic: "Percentages",
      difficulty: "easy",
      cognitiveLevel: "understanding",
      sourceReference: {
        page: 2,
        section: "1.3 Simple Percentages",
      },
      learningObjective: "Calculate 50% of an even number.",
    },
    {
      question: "How many sides does a standard triangle have?",
      options: [
        { id: "A", text: "3 sides" },
        { id: "B", text: "4 sides" },
        { id: "C", text: "5 sides" },
        { id: "D", text: "6 sides" },
      ],
      correctOptionId: "A",
      explanation:
        "The prefix 'tri-' means three. Every triangle has 3 sides and 3 corners (angles).",
      topic: "Simple Everyday Math",
      subtopic: "Shapes & time",
      difficulty: "easy",
      cognitiveLevel: "remembering",
      sourceReference: {
        page: 2,
        section: "1.4 Basic Shapes",
      },
      learningObjective: "Identify the number of sides in basic geometric shapes.",
    },
    {
      question: "How many minutes are there in 2 hours?",
      options: [
        { id: "A", text: "60 minutes" },
        { id: "B", text: "100 minutes" },
        { id: "C", text: "120 minutes" },
        { id: "D", text: "180 minutes" },
      ],
      correctOptionId: "C",
      explanation:
        "There are 60 minutes in 1 hour, so 2 hours is 2 × 60 = 120 minutes.",
      topic: "Simple Everyday Math",
      subtopic: "Shapes & time",
      difficulty: "easy",
      cognitiveLevel: "application",
      sourceReference: {
        page: 3,
        section: "1.5 Units of Time",
      },
      learningObjective: "Convert hours into minutes.",
    },
    {
      question: "What is the capital city of France?",
      options: [
        { id: "A", text: "Rome" },
        { id: "B", text: "Madrid" },
        { id: "C", text: "Berlin" },
        { id: "D", text: "Paris" },
      ],
      correctOptionId: "D",
      explanation:
        "Paris is the capital and largest city of France. Rome is the capital of Italy, Madrid is the capital of Spain, and Berlin is the capital of Germany.",
      topic: "World Geography & Continents",
      subtopic: "Capital cities",
      difficulty: "easy",
      cognitiveLevel: "remembering",
      sourceReference: {
        page: 4,
        section: "2.1 European Capitals",
      },
      learningObjective: "Recall major European capital cities.",
    },
    {
      question: "Which is the largest ocean on Earth?",
      options: [
        { id: "A", text: "Atlantic Ocean" },
        { id: "B", text: "Indian Ocean" },
        { id: "C", text: "Pacific Ocean" },
        { id: "D", text: "Arctic Ocean" },
      ],
      correctOptionId: "C",
      explanation:
        "The Pacific Ocean is the largest and deepest ocean on Earth, covering more than 30% of the planet's surface.",
      topic: "World Geography & Continents",
      subtopic: "Oceans & rivers",
      difficulty: "easy",
      cognitiveLevel: "remembering",
      sourceReference: {
        page: 5,
        section: "2.2 Earth's Oceans",
      },
      learningObjective: "Identify the largest ocean on Earth.",
    },
    {
      question: "In which continent is the country of Egypt located?",
      options: [
        { id: "A", text: "Africa" },
        { id: "B", text: "South America" },
        { id: "C", text: "Australia" },
        { id: "D", text: "Europe" },
      ],
      correctOptionId: "A",
      explanation:
        "Egypt is located in the northeast corner of Africa (with the Sinai Peninsula extending into Asia).",
      topic: "World Geography & Continents",
      subtopic: "Continents & landmarks",
      difficulty: "easy",
      cognitiveLevel: "remembering",
      sourceReference: {
        page: 5,
        section: "2.3 Continents & Countries",
      },
      learningObjective: "Match major countries to their continents.",
    },
    {
      question: "What is the capital city of Japan?",
      options: [
        { id: "A", text: "Seoul" },
        { id: "B", text: "Tokyo" },
        { id: "C", text: "Beijing" },
        { id: "D", text: "Bangkok" },
      ],
      correctOptionId: "B",
      explanation:
        "Tokyo is the capital of Japan. Seoul is the capital of South Korea, Beijing is the capital of China, and Bangkok is the capital of Thailand.",
      topic: "World Geography & Continents",
      subtopic: "Capital cities",
      difficulty: "easy",
      cognitiveLevel: "remembering",
      sourceReference: {
        page: 6,
        section: "2.4 Asian Capitals",
      },
      learningObjective: "Recall major Asian capital cities.",
    },
    {
      question: "How many continents are there on Earth in the standard 7-continent model?",
      options: [
        { id: "A", text: "5 continents" },
        { id: "B", text: "6 continents" },
        { id: "C", text: "7 continents" },
        { id: "D", text: "9 continents" },
      ],
      correctOptionId: "C",
      explanation:
        "The 7 continents are Africa, Antarctica, Asia, Australia (Oceania), Europe, North America, and South America.",
      topic: "World Geography & Continents",
      subtopic: "Continents & landmarks",
      difficulty: "easy",
      cognitiveLevel: "remembering",
      sourceReference: {
        page: 6,
        section: "2.3 Continents & Countries",
      },
      learningObjective: "Recall the seven continents of the world.",
    },
  ],
};
