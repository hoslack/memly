import {
  CognitiveLevel,
  Difficulty,
  GeneratedDeckPayload,
  GeneratedDeckPayloadSchema,
  GeneratedQuestion,
  OptionId,
  QuestionOption,
  TopicItem,
} from "../schemas/deck";

export interface ImportDeckOptions {
  customTitle?: string;
  customSubject?: string;
  customDescription?: string;
  formatHint?: "auto" | "json" | "csv";
}

export class DeckImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeckImportError";
  }
}

/**
 * Ready-to-copy prompt that users can paste into ChatGPT, Claude, Gemini, or DeepSeek
 * alongside their PDF or study notes to get Memly-compatible JSON or CSV output.
 */
export const EXTERNAL_AI_JSON_PROMPT = `You are an expert university exam setter. I am attaching/pasting my study material (PDF or lecture notes).

Your task:
1. Read the ENTIRE document from start to finish and identify every major topic and subtopic.
2. Create a comprehensive multiple-choice revision deck covering all topics across the entire material (aim for 15–40 high-quality exam questions depending on material length).
3. Every question MUST have:
   - Exactly 4 distinct options (A, B, C, D)
   - Almost identical length and tone across options so the correct answer is not obvious
   - Plausible distractors based on real misconceptions
   - A clear explanation of why the correct option is right and why the others are wrong
4. Output ONLY valid JSON inside a single code block matching this exact structure (no extra commentary):

\`\`\`json
{
  "deckTitle": "Concise Title of the Course or Chapter",
  "subject": "Subject Name (e.g. Computer Networks, Biology, Macroeconomics)",
  "description": "1-2 sentence summary of what this revision deck covers.",
  "questions": [
    {
      "question": "Clear, exam-style multiple-choice question testing understanding or application?",
      "options": [
        { "id": "A", "text": "First plausible option" },
        { "id": "B", "text": "Second plausible option" },
        { "id": "C", "text": "Third plausible option" },
        { "id": "D", "text": "Fourth plausible option" }
      ],
      "correctOptionId": "B",
      "explanation": "Option B is correct because... Option A is incorrect because...",
      "topic": "Main Topic Name",
      "subtopic": "Specific Subtopic",
      "difficulty": "medium",
      "learningObjective": "What the student learns from this question"
    }
  ]
}
\`\`\``;

export const EXTERNAL_AI_CSV_PROMPT = `You are an expert university exam setter. I am attaching/pasting my study material (PDF or lecture notes).

Read the ENTIRE document and generate 15–40 multiple-choice exam questions covering every major topic from start to finish.

Output ONLY a valid CSV inside a single code block with these exact columns:
question,optionA,optionB,optionC,optionD,correctOptionId,explanation,topic,difficulty

Rules:
- Wrap every field that contains commas or quotes in double quotes ("..."), and escape inner double quotes as "".
- correctOptionId must be A, B, C, or D.
- difficulty must be easy, medium, or hard.
- All 4 options (optionA, optionB, optionC, optionD) must be distinct and plausible.

Example row:
"What is the primary role of the Network Layer in the OSI model?","Physical bit transmission over cables","Logical addressing and routing packets across networks","End-to-end process port multiplexing","Formatting user application data","B","The Network Layer (Layer 3) handles logical addressing (IP) and routing packets across different networks.","OSI Model","medium"`;

/**
 * Strips markdown code fences (e.g. ```json ... ``` or ```csv ... ```) if the user
 * copied the raw code block directly from an AI chat response.
 */
function stripMarkdownCodeFences(input: string): string {
  const trimmed = input.trim();
  const fenceMatch = trimmed.match(/^```(?:json|csv|tsv|text)?\s*\r?\n([\s\S]*?)\r?\n```$/i);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  // Also handle if there is text before/after a JSON code block
  const embeddedFence = trimmed.match(/```(?:json|csv)?\s*\r?\n([\s\S]*?)\r?\n```/i);
  if (embeddedFence) {
    return embeddedFence[1].trim();
  }
  return trimmed;
}

function normalizeDifficulty(val: unknown): Difficulty {
  if (typeof val !== "string") return "medium";
  const lower = val.trim().toLowerCase();
  if (lower === "easy" || lower === "beginner" || lower === "basic") return "easy";
  if (lower === "hard" || lower === "difficult" || lower === "advanced") return "hard";
  return "medium";
}

function normalizeCognitiveLevel(val: unknown): CognitiveLevel {
  if (typeof val !== "string") return "understanding";
  const lower = val.trim().toLowerCase();
  if (
    lower === "remembering" ||
    lower === "understanding" ||
    lower === "application" ||
    lower === "analysis"
  ) {
    return lower;
  }
  return "understanding";
}

function stripLeadingOptionLabel(text: string, expectedId: OptionId): string {
  const cleaned = text.trim();
  const regex = new RegExp(`^(?:option\\s+)?${expectedId}[\\)\\.\\:\\-]\\s+`, "i");
  return cleaned.replace(regex, "").trim() || cleaned;
}

function ensureDistinctOptionTexts(options: QuestionOption[]): QuestionOption[] {
  const seen = new Set<string>();
  return options.map((opt) => {
    let text = opt.text.trim();
    const norm = text.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(norm)) {
      text = `${text} (Option ${opt.id})`;
    }
    seen.add(text.toLowerCase().replace(/\s+/g, " "));
    return { id: opt.id, text };
  });
}

function normalizeCorrectOptionId(
  rawCorrect: unknown,
  options: QuestionOption[]
): OptionId {
  if (typeof rawCorrect === "number") {
    const map: OptionId[] = ["A", "B", "C", "D"];
    if (rawCorrect >= 0 && rawCorrect <= 3) return map[rawCorrect];
    if (rawCorrect >= 1 && rawCorrect <= 4) return map[rawCorrect - 1];
  }

  if (typeof rawCorrect === "string") {
    const cleaned = rawCorrect.trim();
    const upper = cleaned.toUpperCase();
    if (upper === "A" || upper === "B" || upper === "C" || upper === "D") {
      return upper;
    }

    // e.g. "Option B" or "B) 42"
    const prefixMatch = cleaned.match(/^(?:option\s+)?([A-D])\b/i);
    if (prefixMatch) {
      return prefixMatch[1].toUpperCase() as OptionId;
    }

    // Match by exact option text
    const matchedOpt = options.find(
      (o) => o.text.trim().toLowerCase() === cleaned.toLowerCase()
    );
    if (matchedOpt) {
      return matchedOpt.id;
    }
  }

  throw new DeckImportError(
    `Invalid correct answer "${String(rawCorrect)}". Expected A, B, C, or D.`
  );
}

function extractOptionsFromRawQuestion(
  raw: Record<string, unknown>,
  questionIndex: number
): QuestionOption[] {
  const optionIds: OptionId[] = ["A", "B", "C", "D"];

  // Case 1: `options` or `choices` array
  const rawOptions = raw.options ?? raw.choices;
  if (Array.isArray(rawOptions)) {
    if (rawOptions.length !== 4) {
      throw new DeckImportError(
        `Question #${questionIndex + 1} has ${rawOptions.length} options, but exactly 4 options (A, B, C, D) are required.`
      );
    }

    const mapped: QuestionOption[] = rawOptions.map((item, idx) => {
      const fallbackId = optionIds[idx];
      if (typeof item === "string") {
        return {
          id: fallbackId,
          text: stripLeadingOptionLabel(item, fallbackId),
        };
      }
      if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        const rawId =
          typeof obj.id === "string" ? obj.id.trim().toUpperCase() : fallbackId;
        const id: OptionId =
          rawId === "A" || rawId === "B" || rawId === "C" || rawId === "D"
            ? rawId
            : fallbackId;
        const text = String(obj.text ?? obj.label ?? obj.value ?? "").trim();
        return { id, text };
      }
      return { id: fallbackId, text: String(item ?? "").trim() };
    });

    if (mapped.some((o) => !o.text)) {
      throw new DeckImportError(
        `Question #${questionIndex + 1} has an empty option text.`
      );
    }

    return ensureDistinctOptionTexts(mapped);
  }

  // Case 2: `options` is an object `{ A: "...", B: "...", C: "...", D: "..." }`
  if (rawOptions && typeof rawOptions === "object") {
    const obj = rawOptions as Record<string, unknown>;
    const mapped = optionIds.map((id) => ({
      id,
      text: String(obj[id] ?? obj[id.toLowerCase()] ?? "").trim(),
    }));
    if (mapped.every((o) => o.text.length > 0)) {
      return ensureDistinctOptionTexts(mapped);
    }
  }

  // Case 3: Flat fields on question object (`optionA`, `option_a`, `A`, `a`, etc.)
  const getFlatOption = (id: OptionId, num: number): string => {
    const keys = [
      `option${id}`,
      `option_${id.toLowerCase()}`,
      `option_${id}`,
      `option ${id}`,
      `choice${id}`,
      `choice_${id.toLowerCase()}`,
      id,
      id.toLowerCase(),
      `option${num}`,
      `option_${num}`,
    ];
    for (const k of keys) {
      if (raw[k] !== undefined && raw[k] !== null && String(raw[k]).trim() !== "") {
        return String(raw[k]).trim();
      }
    }
    return "";
  };

  const flatOptions: QuestionOption[] = optionIds.map((id, idx) => ({
    id,
    text: stripLeadingOptionLabel(getFlatOption(id, idx + 1), id),
  }));

  if (flatOptions.every((o) => o.text.length > 0)) {
    return ensureDistinctOptionTexts(flatOptions);
  }

  throw new DeckImportError(
    `Question #${questionIndex + 1} is missing 4 valid options (A, B, C, D).`
  );
}

function normalizeRawQuestion(
  raw: Record<string, unknown>,
  index: number,
  defaultTopic: string
): GeneratedQuestion {
  const rawQuestionText = String(
    raw.question ?? raw.prompt ?? raw.stem ?? raw.q ?? ""
  ).trim();

  if (!rawQuestionText) {
    throw new DeckImportError(`Question #${index + 1} is missing question text.`);
  }

  const questionText =
    rawQuestionText.length < 10
      ? `Question: ${rawQuestionText}`
      : rawQuestionText;

  const options = extractOptionsFromRawQuestion(raw, index);

  const rawCorrect =
    raw.correctOptionId ??
    raw.correctAnswer ??
    raw.correct_answer ??
    raw.correct_option ??
    raw.correctOption ??
    raw.correct ??
    raw.answer;

  if (rawCorrect === undefined || rawCorrect === null || String(rawCorrect).trim() === "") {
    throw new DeckImportError(
      `Question #${index + 1} ("${questionText.slice(0, 45)}...") is missing a correctOptionId (A, B, C, or D).`
    );
  }

  const correctOptionId = normalizeCorrectOptionId(rawCorrect, options);
  const correctOptText =
    options.find((o) => o.id === correctOptionId)?.text ?? "";

  const rawExplanation = String(
    raw.explanation ?? raw.rationale ?? raw.reason ?? ""
  ).trim();
  const explanation =
    rawExplanation.length >= 10
      ? rawExplanation
      : rawExplanation.length > 0
      ? `${rawExplanation} (Correct answer: ${correctOptionId} — ${correctOptText})`
      : `Option ${correctOptionId} (${correctOptText}) is the correct answer for this question.`;

  const topic =
    String(
      raw.topic ?? raw.category ?? raw.chapter ?? raw.section ?? defaultTopic
    ).trim() || defaultTopic;

  const subtopicRaw = raw.subtopic ?? raw.sub_topic ?? null;
  const subtopic =
    typeof subtopicRaw === "string" && subtopicRaw.trim().length > 0
      ? subtopicRaw.trim()
      : null;

  const difficulty = normalizeDifficulty(raw.difficulty ?? raw.level);
  const cognitiveLevel = normalizeCognitiveLevel(
    raw.cognitiveLevel ?? raw.cognitive_level
  );

  const rawObjective = String(
    raw.learningObjective ?? raw.learning_objective ?? raw.objective ?? ""
  ).trim();
  const learningObjective =
    rawObjective.length >= 5
      ? rawObjective
      : `Master core concepts related to ${topic}.`;

  let page: number | null = null;
  let section: string | null = null;
  if (raw.sourceReference && typeof raw.sourceReference === "object") {
    const ref = raw.sourceReference as Record<string, unknown>;
    if (typeof ref.page === "number" && ref.page > 0) page = Math.floor(ref.page);
    if (typeof ref.section === "string" && ref.section.trim()) {
      section = ref.section.trim();
    }
  } else {
    const rawPage = Number(raw.page);
    if (!Number.isNaN(rawPage) && rawPage > 0) {
      page = Math.floor(rawPage);
    }
    if (typeof raw.section === "string" && raw.section.trim()) {
      section = raw.section.trim();
    }
  }

  return {
    question: questionText,
    options,
    correctOptionId,
    explanation,
    topic,
    subtopic,
    difficulty,
    cognitiveLevel,
    sourceReference: { page, section },
    learningObjective,
  };
}

function buildTopicsFromQuestions(
  questions: GeneratedQuestion[],
  existingTopics?: unknown
): TopicItem[] {
  if (Array.isArray(existingTopics) && existingTopics.length > 0) {
    const validExisting: TopicItem[] = [];
    for (const t of existingTopics) {
      if (t && typeof t === "object") {
        const obj = t as Record<string, unknown>;
        const name = String(obj.name ?? obj.topic ?? "").trim();
        if (name) {
          validExisting.push({
            name,
            subtopics: Array.isArray(obj.subtopics)
              ? obj.subtopics.map((s) => String(s).trim()).filter(Boolean)
              : [],
            coverageNotes:
              typeof obj.coverageNotes === "string" && obj.coverageNotes.trim()
                ? obj.coverageNotes.trim()
                : `Covers exam questions on ${name}.`,
            targetQuestionCount:
              typeof obj.targetQuestionCount === "number"
                ? obj.targetQuestionCount
                : undefined,
            sourcePagesOrSections:
              typeof obj.sourcePagesOrSections === "string"
                ? obj.sourcePagesOrSections
                : null,
          });
        }
      }
    }
    if (validExisting.length > 0) {
      return validExisting;
    }
  }

  const topicMap = new Map<string, Set<string>>();
  const topicCounts = new Map<string, number>();

  for (const q of questions) {
    const tName = q.topic || "General Revision";
    if (!topicMap.has(tName)) {
      topicMap.set(tName, new Set());
      topicCounts.set(tName, 0);
    }
    topicCounts.set(tName, (topicCounts.get(tName) ?? 0) + 1);
    if (q.subtopic) {
      topicMap.get(tName)!.add(q.subtopic);
    }
  }

  return Array.from(topicMap.entries()).map(([name, subtopicsSet]) => ({
    name,
    subtopics: Array.from(subtopicsSet),
    coverageNotes: `Covers ${topicCounts.get(name) ?? 1} imported revision question(s) on ${name}.`,
    targetQuestionCount: topicCounts.get(name) ?? 1,
    sourcePagesOrSections: null,
  }));
}

/**
 * Parses a JSON string into a validated GeneratedDeckPayload.
 */
export function parseJsonDeck(
  rawInput: string,
  options?: ImportDeckOptions
): GeneratedDeckPayload {
  const cleaned = stripMarkdownCodeFences(rawInput);
  if (!cleaned) {
    throw new DeckImportError("Please paste or upload non-empty JSON data.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err: unknown) {
    // Check if user pasted a JSON snippet that has leading/trailing prose outside braces
    const firstBrace = cleaned.search(/[\{\[]/);
    const lastBrace = Math.max(
      cleaned.lastIndexOf("}"),
      cleaned.lastIndexOf("]")
    );
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      } catch {
        throw new DeckImportError(
          `Invalid JSON syntax: ${err instanceof Error ? err.message : "Could not parse JSON"}`
        );
      }
    } else {
      throw new DeckImportError(
        `Invalid JSON syntax: ${err instanceof Error ? err.message : "Could not parse JSON"}`
      );
    }
  }

  let rawQuestions: unknown[] = [];
  let rootObj: Record<string, unknown> = {};

  if (Array.isArray(parsed)) {
    rawQuestions = parsed;
  } else if (parsed && typeof parsed === "object") {
    rootObj = parsed as Record<string, unknown>;
    // Handle slight key variations like " questions" (with leading space) or "items" or "cards"
    const qKey = Object.keys(rootObj).find((k) =>
      ["questions", "items", "cards", "quiz", "flashcards"].includes(
        k.trim().toLowerCase()
      )
    );
    if (qKey && Array.isArray(rootObj[qKey])) {
      rawQuestions = rootObj[qKey] as unknown[];
    } else if (rootObj.question || rootObj.prompt) {
      // Single question object
      rawQuestions = [rootObj];
    } else {
      throw new DeckImportError(
        'JSON object must contain a "questions" array of multiple-choice questions.'
      );
    }
  } else {
    throw new DeckImportError(
      "JSON must be an object containing a 'questions' array, or a JSON array of questions."
    );
  }

  if (rawQuestions.length === 0) {
    throw new DeckImportError("The imported JSON contains 0 questions.");
  }

  const defaultTopic =
    options?.customSubject?.trim() ||
    (typeof rootObj.subject === "string" && rootObj.subject.trim()) ||
    "General Revision";

  const questions: GeneratedQuestion[] = rawQuestions.map((item, idx) => {
    if (!item || typeof item !== "object") {
      throw new DeckImportError(
        `Question #${idx + 1} is not a valid JSON object.`
      );
    }
    return normalizeRawQuestion(
      item as Record<string, unknown>,
      idx,
      defaultTopic
    );
  });

  const topics = buildTopicsFromQuestions(questions, rootObj.topics);

  const deckTitle =
    options?.customTitle?.trim() ||
    (typeof rootObj.deckTitle === "string" && rootObj.deckTitle.trim()) ||
    (typeof rootObj.title === "string" && rootObj.title.trim()) ||
    (topics[0]?.name && topics[0].name !== "General Revision"
      ? `${topics[0].name} Revision Deck`
      : "Imported Revision Deck");

  const subject =
    options?.customSubject?.trim() ||
    (typeof rootObj.subject === "string" && rootObj.subject.trim()) ||
    topics[0]?.name ||
    "General Studies";

  const rawDesc =
    options?.customDescription?.trim() ||
    (typeof rootObj.description === "string" ? rootObj.description.trim() : "");
  const description =
    rawDesc.length >= 10
      ? rawDesc
      : `Imported revision deck covering ${topics
          .map((t) => t.name)
          .slice(0, 4)
          .join(", ")} (${questions.length} questions).`;

  const candidatePayload: GeneratedDeckPayload = {
    deckTitle: deckTitle.length >= 3 ? deckTitle : `${deckTitle} Deck`,
    subject: subject.length >= 2 ? subject : "General Studies",
    description,
    topics,
    questions,
  };

  return GeneratedDeckPayloadSchema.parse(candidatePayload);
}

/**
 * RFC-4180 compliant CSV / TSV row parser that handles quoted strings,
 * commas and newlines inside quotes, and escaped double quotes ("").
 */
export function parseCsvRows(csvText: string): string[][] {
  const cleaned = stripMarkdownCodeFences(csvText);
  if (!cleaned) return [];

  // Detect delimiter from first line outside quotes (comma, semicolon, or tab)
  const firstLine = cleaned.split(/\r?\n/)[0] ?? "";
  let delimiter = ",";
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  const tabCount = (firstLine.match(/\t/g) ?? []).length;
  const semiCount = (firstLine.match(/;/g) ?? []).length;
  if (tabCount > commaCount && tabCount >= 4) {
    delimiter = "\t";
  } else if (semiCount > commaCount && semiCount >= 4) {
    delimiter = ";";
  }

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    const next = cleaned[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentCell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentCell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        currentRow.push(currentCell.trim());
        currentCell = "";
      } else if (ch === "\r" && next === "\n") {
        currentRow.push(currentCell.trim());
        if (currentRow.some((cell) => cell.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = "";
        i++;
      } else if (ch === "\n" || ch === "\r") {
        currentRow.push(currentCell.trim());
        if (currentRow.some((cell) => cell.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = "";
      } else {
        currentCell += ch;
      }
    }
  }

  currentRow.push(currentCell.trim());
  if (currentRow.some((cell) => cell.length > 0)) {
    rows.push(currentRow);
  }

  return rows;
}

function normalizeHeaderKey(header: string): string {
  const h = header.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["question", "prompt", "stem", "q", "questiontext"].includes(h)) {
    return "question";
  }
  if (["optiona", "choicea", "a", "option1", "choice1", "answera"].includes(h)) {
    return "optionA";
  }
  if (["optionb", "choiceb", "b", "option2", "choice2", "answerb"].includes(h)) {
    return "optionB";
  }
  if (["optionc", "choicec", "c", "option3", "choice3", "answerc"].includes(h)) {
    return "optionC";
  }
  if (["optiond", "choiced", "d", "option4", "choice4", "answerd"].includes(h)) {
    return "optionD";
  }
  if (
    [
      "correctoptionid",
      "correctanswer",
      "correctoption",
      "correct",
      "answer",
      "ans",
      "key",
    ].includes(h)
  ) {
    return "correctOptionId";
  }
  if (["explanation", "rationale", "reason", "feedback", "notes"].includes(h)) {
    return "explanation";
  }
  if (["topic", "category", "chapter", "module", "unit"].includes(h)) {
    return "topic";
  }
  if (["subtopic", "subcategory", "section"].includes(h)) {
    return "subtopic";
  }
  if (["difficulty", "level"].includes(h)) {
    return "difficulty";
  }
  if (["learningobjective", "objective", "goal"].includes(h)) {
    return "learningObjective";
  }
  if (["page", "pagenumber"].includes(h)) {
    return "page";
  }
  return header.trim();
}

/**
 * Parses a CSV string into a validated GeneratedDeckPayload.
 */
export function parseCsvDeck(
  rawInput: string,
  options?: ImportDeckOptions
): GeneratedDeckPayload {
  const rows = parseCsvRows(rawInput);
  if (rows.length === 0) {
    throw new DeckImportError("Please paste or upload non-empty CSV data.");
  }

  const firstRowNormalized = rows[0].map(normalizeHeaderKey);
  const hasHeader =
    firstRowNormalized.includes("question") ||
    (firstRowNormalized.includes("optionA") &&
      firstRowNormalized.includes("optionB"));

  const defaultHeaders = [
    "question",
    "optionA",
    "optionB",
    "optionC",
    "optionD",
    "correctOptionId",
    "explanation",
    "topic",
    "difficulty",
    "learningObjective",
  ];

  const headers = hasHeader ? firstRowNormalized : defaultHeaders;
  const dataRows = hasHeader ? rows.slice(1) : rows;

  if (dataRows.length === 0) {
    throw new DeckImportError(
      "CSV contains a header row but no question rows. Please add at least one question row."
    );
  }

  const defaultTopic = options?.customSubject?.trim() || "General Revision";

  const questions: GeneratedQuestion[] = dataRows.map((row, idx) => {
    if (row.length < 6 && !hasHeader) {
      throw new DeckImportError(
        `CSV Row #${idx + 1} has only ${row.length} columns. Expected at least 6 columns: question, optionA, optionB, optionC, optionD, correctOptionId.`
      );
    }

    const rowObj: Record<string, unknown> = {};
    headers.forEach((hKey, colIdx) => {
      if (colIdx < row.length) {
        rowObj[hKey] = row[colIdx];
      }
    });

    return normalizeRawQuestion(rowObj, idx, defaultTopic);
  });

  const topics = buildTopicsFromQuestions(questions);
  const deckTitle =
    options?.customTitle?.trim() ||
    (topics[0]?.name && topics[0].name !== "General Revision"
      ? `${topics[0].name} Revision Deck`
      : "Imported CSV Revision Deck");

  const subject =
    options?.customSubject?.trim() || topics[0]?.name || "General Studies";

  const description =
    options?.customDescription?.trim() &&
    options.customDescription.trim().length >= 10
      ? options.customDescription.trim()
      : `Imported CSV revision deck covering ${topics
          .map((t) => t.name)
          .slice(0, 4)
          .join(", ")} (${questions.length} questions).`;

  const candidatePayload: GeneratedDeckPayload = {
    deckTitle: deckTitle.length >= 3 ? deckTitle : `${deckTitle} Deck`,
    subject: subject.length >= 2 ? subject : "General Studies",
    description,
    topics,
    questions,
  };

  return GeneratedDeckPayloadSchema.parse(candidatePayload);
}

/**
 * Automatically detects whether input is JSON or CSV (or uses formatHint)
 * and parses it into a validated GeneratedDeckPayload with zero AI calls.
 */
export function parseImportedDeck(
  rawInput: string,
  options?: ImportDeckOptions
): { payload: GeneratedDeckPayload; detectedFormat: "json" | "csv" } {
  const cleaned = stripMarkdownCodeFences(rawInput);
  if (!cleaned) {
    throw new DeckImportError(
      "Please paste your JSON or CSV questions, or upload a .json / .csv file."
    );
  }

  const hint = options?.formatHint ?? "auto";
  if (hint === "json") {
    return {
      payload: parseJsonDeck(cleaned, options),
      detectedFormat: "json",
    };
  }
  if (hint === "csv") {
    return {
      payload: parseCsvDeck(cleaned, options),
      detectedFormat: "csv",
    };
  }

  // Auto-detect: if it starts with '{' or '[', try JSON first
  const trimmedStart = cleaned.trimStart();
  if (trimmedStart.startsWith("{") || trimmedStart.startsWith("[")) {
    return {
      payload: parseJsonDeck(cleaned, options),
      detectedFormat: "json",
    };
  }

  return {
    payload: parseCsvDeck(cleaned, options),
    detectedFormat: "csv",
  };
}
