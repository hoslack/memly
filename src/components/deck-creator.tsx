"use client";

import React, { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import {
  FileUp,
  FileText,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Loader2,
  BookOpen,
  X,
  ArrowRight,
  Zap,
  Coffee,
  FileCode2,
  Table,
  Copy,
  Check,
  Wand2,
  Upload,
} from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { saveGeneratedDeck } from "@/lib/storage/repository";
import { SAMPLE_DEVELOPMENT_DECK_PAYLOAD } from "@/lib/sample-deck";
import { GeneratedDeckPayloadSchema } from "@/lib/schemas/deck";
import {
  parseImportedDeck,
  EXTERNAL_AI_JSON_PROMPT,
  EXTERNAL_AI_CSV_PROMPT,
} from "@/lib/import/deck-importer";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";

export type ProcessingStageId =
  | "uploading"
  | "extracting"
  | "analyzing"
  | "generating"
  | "validating"
  | "preparing";

interface ProcessingStageInfo {
  id: ProcessingStageId;
  label: string;
  description: string;
}

export const PROCESSING_STAGES: ProcessingStageInfo[] = [
  {
    id: "uploading",
    label: "Uploading document",
    description: "Checking file structure, size, and readability...",
  },
  {
    id: "extracting",
    label: "Extracting text",
    description:
      "Extracting selectable text from every page while preserving page numbers...",
  },
  {
    id: "analyzing",
    label: "Analysing study material",
    description:
      "Building a full-document topic coverage plan so no chapter is missed...",
  },
  {
    id: "generating",
    label: "Generating questions",
    description:
      "Writing examination-style multiple-choice questions with plausible distractors...",
  },
  {
    id: "validating",
    label: "Checking questions and answers",
    description:
      "Verifying 4 distinct options, single correct answers, and removing duplicates...",
  },
  {
    id: "preparing",
    label: "Preparing revision deck",
    description: "Saving flashcards and initializing your revision queue...",
  },
];

const EXAMPLE_JSON_SNIPPET = `{
  "deckTitle": "Computer Networks: OSI & TCP/IP",
  "subject": "Computer Science",
  "description": "Revision questions covering OSI model layers, routing, and transport protocols.",
  "questions": [
    {
      "question": "Which layer of the OSI model is responsible for logical addressing and routing packets across networks?",
      "options": [
        { "id": "A", "text": "Data Link Layer" },
        { "id": "B", "text": "Network Layer" },
        { "id": "C", "text": "Transport Layer" },
        { "id": "D", "text": "Session Layer" }
      ],
      "correctOptionId": "B",
      "explanation": "The Network Layer (Layer 3) handles logical IP addressing and routing packets between different networks.",
      "topic": "OSI Model",
      "difficulty": "easy",
      "learningObjective": "Identify the core responsibilities of Layer 3 in the OSI model."
    }
  ]
}`;

const EXAMPLE_CSV_SNIPPET = `question,optionA,optionB,optionC,optionD,correctOptionId,explanation,topic,difficulty
"Which layer of the OSI model handles logical addressing and routing?","Data Link Layer","Network Layer","Transport Layer","Session Layer","B","The Network Layer (Layer 3) handles logical IP addressing and routing across networks.","OSI Model","easy"
"Which transport layer protocol provides reliable, connection-oriented delivery?","UDP","ICMP","TCP","ARP","C","TCP uses a 3-way handshake, sequence numbers, and acknowledgments to guarantee reliable delivery.","Transport Protocols","medium"`;

interface DeckCreatorProps {
  onDeckCreated?: (deckId: string) => void;
  defaultTab?: "import" | "pdf" | "text";
}

export function DeckCreator({
  onDeckCreated,
  defaultTab = "import",
}: DeckCreatorProps) {
  const router = useRouter();
  const { user, getIdToken } = useAuth();
  const [activeTab, setActiveTab] = useState<"import" | "pdf" | "text">(
    defaultTab
  );
  const [importFormat, setImportFormat] = useState<"auto" | "json" | "csv">(
    "auto"
  );
  const [importData, setImportData] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [customSubject, setCustomSubject] = useState("");
  const [importedFileName, setImportedFileName] = useState<string | null>(null);
  const [showPromptHelper, setShowPromptHelper] = useState(true);
  const [activePromptTab, setActivePromptTab] = useState<"json" | "csv">(
    "json"
  );
  const [copiedPromptType, setCopiedPromptType] = useState<
    "json" | "csv" | null
  >(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showQuotaModal, setShowQuotaModal] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeStageIndex, setActiveStageIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);

  const handleCopyPrompt = async (type: "json" | "csv") => {
    const textToCopy =
      type === "json" ? EXTERNAL_AI_JSON_PROMPT : EXTERNAL_AI_CSV_PROMPT;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedPromptType(type);
      setTimeout(() => setCopiedPromptType(null), 2500);
    } catch {
      // Fallback ignored
    }
  };

  const handleImportFileUpload = async (file: File | null) => {
    setErrorMessage(null);
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    const isJson =
      lowerName.endsWith(".json") || file.type === "application/json";
    const isCsv =
      lowerName.endsWith(".csv") ||
      lowerName.endsWith(".tsv") ||
      lowerName.endsWith(".txt") ||
      file.type === "text/csv";

    if (!isJson && !isCsv) {
      setErrorMessage(
        `Unsupported file "${file.name}". Please upload a .json or .csv file.`
      );
      return;
    }

    try {
      const text = await file.text();
      setImportData(text);
      setImportedFileName(file.name);
      if (isJson) setImportFormat("json");
      else if (lowerName.endsWith(".csv") || lowerName.endsWith(".tsv"))
        setImportFormat("csv");

      if (!customTitle) {
        const cleanTitle = file.name
          .replace(/\.(json|csv|tsv|txt)$/i, "")
          .replace(/[_\-]+/g, " ")
          .trim();
        if (cleanTitle.length >= 3) {
          setCustomTitle(cleanTitle);
        }
      }
    } catch {
      setErrorMessage("Could not read the selected file.");
    }
  };

  const handleCreateFromImport = async () => {
    setErrorMessage(null);
    const trimmed = importData.trim();
    if (!trimmed) {
      setErrorMessage(
        "Please paste your JSON or CSV questions below, or upload a .json / .csv file."
      );
      return;
    }

    setIsGenerating(true);
    setActiveStageIndex(PROCESSING_STAGES.length - 2);

    try {
      const { payload, detectedFormat } = parseImportedDeck(trimmed, {
        customTitle: customTitle.trim() || undefined,
        customSubject: customSubject.trim() || undefined,
        formatHint: importFormat,
      });

      setActiveStageIndex(PROCESSING_STAGES.length - 1);

      const { deck } = await saveGeneratedDeck({
        userId: user.uid,
        payload,
        sourceFileName:
          importedFileName ||
          (detectedFormat === "json"
            ? "Imported Questions (.json)"
            : "Imported Questions (.csv)"),
        sourceType: detectedFormat,
        aiMetadata: {
          primaryProvider: "import",
          actualProvider: "import",
          model: `direct-${detectedFormat}-import`,
          modelUsed: `direct-${detectedFormat}-import`,
          fallbackUsed: false,
          generatedAt: new Date().toISOString(),
          generationDurationMs: 10,
        },
      });

      if (onDeckCreated) {
        onDeckCreated(deck.id);
      } else {
        router.push(`/decks/${deck.id}/revise`);
      }
    } catch (err: unknown) {
      setIsGenerating(false);
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Could not parse the provided JSON/CSV data. Please check the format and try again."
      );
    }
  };

  const validateClientFile = (file: File): string | null => {
    if (!file) return "Please select a PDF file.";
    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      return `Unsupported file "${file.name}". Please upload a PDF document (.pdf).`;
    }
    if (file.size === 0) {
      return "The selected PDF file is empty (0 bytes).";
    }
    if (file.size > 20 * 1024 * 1024) {
      return `File is too large (${(file.size / (1024 * 1024)).toFixed(
        1
      )} MB). Maximum allowed size is 20 MB.`;
    }
    return null;
  };

  const handleFileSelect = (file: File | null) => {
    setErrorMessage(null);
    if (!file) {
      setSelectedFile(null);
      return;
    }
    const validationErr = validateClientFile(file);
    if (validationErr) {
      setErrorMessage(validationErr);
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
  };

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files?.[0] || null;
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  }, []);

  const handleGenerate = async () => {
    if (activeTab === "import") {
      await handleCreateFromImport();
      return;
    }

    setErrorMessage(null);
    setShowQuotaModal(false);

    if (activeTab === "pdf") {
      if (!selectedFile) {
        setErrorMessage("Please drop or browse a PDF file first.");
        return;
      }
      const err = validateClientFile(selectedFile);
      if (err) {
        setErrorMessage(err);
        return;
      }
    } else {
      const trimmed = pastedText.trim();
      if (trimmed.length < 120) {
        setErrorMessage(
          "Please paste at least a full paragraph of study notes (minimum 120 characters) so Gemini has enough material to write realistic exam questions."
        );
        return;
      }
    }

    setIsGenerating(true);
    setActiveStageIndex(0);

    const stageInterval = setInterval(() => {
      setActiveStageIndex((prev) =>
        prev < PROCESSING_STAGES.length - 2 ? prev + 1 : prev
      );
    }, 2800);

    try {
      const idToken = await getIdToken();
      const headers: Record<string, string> = {};
      if (idToken) {
        headers["Authorization"] = `Bearer ${idToken}`;
      }

      const idempotencyKey = `job_${user.uid}_${Date.now()}`;
      let response: Response;

      if (activeTab === "pdf" && selectedFile) {
        const formData = new FormData();
        formData.append("file", selectedFile);
        formData.append("idempotencyKey", idempotencyKey);

        response = await fetch("/api/decks/generate", {
          method: "POST",
          headers,
          body: formData,
        });
      } else {
        headers["Content-Type"] = "application/json";
        response = await fetch("/api/decks/generate", {
          method: "POST",
          headers,
          body: JSON.stringify({
            text: pastedText.trim(),
            idempotencyKey,
          }),
        });
      }

      let data: {
        success?: boolean;
        error?: string;
        code?: string;
        deck?: unknown;
        meta?: Record<string, unknown>;
      } = {};

      const rawResponseText = await response.text();
      try {
        data = rawResponseText ? JSON.parse(rawResponseText) : {};
      } catch {
        if (
          response.status === 504 ||
          response.status === 503 ||
          response.status === 429
        ) {
          clearInterval(stageInterval);
          setIsGenerating(false);
          setShowQuotaModal(true);
          return;
        }
        throw new Error(
          "The AI server took too long to respond. Try importing ready JSON or CSV questions instead (zero AI credits needed)."
        );
      }

      if (!response.ok || !data.success) {
        const isQuotaOrRateLimit =
          response.status === 429 ||
          response.status === 503 ||
          response.status === 504 ||
          data.code === "AI_QUOTA_EXCEEDED" ||
          data.code === "GEMINI_QUOTA_EXCEEDED" ||
          data.code === "RATE_LIMIT_EXCEEDED" ||
          (typeof data.error === "string" &&
            (data.error.toLowerCase().includes("quota") ||
              data.error.toLowerCase().includes("temporarily full") ||
              data.error.toLowerCase().includes("rate limit")));

        if (isQuotaOrRateLimit) {
          clearInterval(stageInterval);
          setIsGenerating(false);
          setShowQuotaModal(true);
          return;
        }

        throw new Error(
          data.error ||
            "Failed to generate exam questions from your material. Please try again."
        );
      }

      clearInterval(stageInterval);
      setActiveStageIndex(PROCESSING_STAGES.length - 2); // validating

      const validatedPayload = GeneratedDeckPayloadSchema.parse(data.deck);

      setActiveStageIndex(PROCESSING_STAGES.length - 1); // preparing

      const { deck } = await saveGeneratedDeck({
        userId: user.uid,
        payload: validatedPayload,
        sourceFileName:
          (typeof data.meta?.sourceFileName === "string"
            ? data.meta.sourceFileName
            : null) ||
          (activeTab === "pdf"
            ? selectedFile?.name || "notes.pdf"
            : "Pasted Notes"),
        sourceType: activeTab,
        aiMetadata: {
          primaryProvider:
            (data.meta?.primaryProvider as "gemini" | "openrouter") || "gemini",
          actualProvider:
            (data.meta?.actualProvider as "gemini" | "openrouter") || "gemini",
          model:
            (typeof data.meta?.model === "string" ? data.meta.model : null) ||
            (typeof data.meta?.modelUsed === "string"
              ? data.meta.modelUsed
              : null) ||
            "gemini-3.5-flash-lite",
          modelUsed:
            (typeof data.meta?.modelUsed === "string"
              ? data.meta.modelUsed
              : null) || "gemini-3.5-flash-lite",
          fallbackUsed: Boolean(data.meta?.fallbackUsed),
          generatedAt:
            (typeof data.meta?.generatedAt === "string"
              ? data.meta.generatedAt
              : null) || new Date().toISOString(),
          contentHash:
            typeof data.meta?.contentHash === "string"
              ? data.meta.contentHash
              : undefined,
          generationDurationMs:
            typeof data.meta?.generationDurationMs === "number"
              ? data.meta.generationDurationMs
              : undefined,
        },
      });

      if (onDeckCreated) {
        onDeckCreated(deck.id);
      } else {
        router.push(`/decks/${deck.id}/revise`);
      }
    } catch (err: unknown) {
      clearInterval(stageInterval);
      setIsGenerating(false);
      const msg =
        err instanceof Error
          ? err.message
          : "Something went wrong while analysing your notes.";
      if (
        msg.toLowerCase().includes("quota") ||
        msg.toLowerCase().includes("temporarily full")
      ) {
        setShowQuotaModal(true);
      } else {
        setErrorMessage(msg);
      }
    }
  };

  const handleLoadSampleDeck = async () => {
    setErrorMessage(null);
    setShowQuotaModal(false);
    setIsGenerating(true);
    setActiveStageIndex(PROCESSING_STAGES.length - 1);

    try {
      const { deck } = await saveGeneratedDeck({
        userId: user.uid,
        payload: SAMPLE_DEVELOPMENT_DECK_PAYLOAD,
        sourceFileName: "General_Knowledge_Math_Geography.pdf (Sample)",
        sourceType: "sample",
        aiMetadata: {
          primaryProvider: "sample",
          actualProvider: "sample",
          model: "sample-general-knowledge",
          modelUsed: "sample-general-knowledge",
          fallbackUsed: false,
          generatedAt: new Date().toISOString(),
          generationDurationMs: 120,
        },
      });

      if (onDeckCreated) {
        onDeckCreated(deck.id);
      } else {
        router.push(`/decks/${deck.id}/revise`);
      }
    } catch (err: unknown) {
      setIsGenerating(false);
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to load sample deck."
      );
    }
  };

  if (isGenerating) {
    return (
      <Card className="overflow-hidden border-primary/20 shadow-lg">
        <CardContent className="p-6 sm:p-8">
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Loader2 className="h-7 w-7 animate-spin" />
            </div>
            <Badge variant="default" className="mb-2">
              {activeTab === "import"
                ? "Building Deck Instantly"
                : "AI Exam Setter Active"}
            </Badge>
            <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
              {PROCESSING_STAGES[activeStageIndex]?.label}
            </h2>
            <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
              {PROCESSING_STAGES[activeStageIndex]?.description}
            </p>
          </div>

          <div className="mt-8 space-y-3">
            {PROCESSING_STAGES.map((stage, idx) => {
              const isDone = idx < activeStageIndex;
              const isCurrent = idx === activeStageIndex;

              return (
                <div
                  key={stage.id}
                  className={`flex items-center gap-3.5 rounded-xl border p-3.5 transition-all ${
                    isCurrent
                      ? "border-primary/40 bg-primary/5 shadow-sm"
                      : isDone
                      ? "border-emerald-500/20 bg-emerald-500/5 opacity-90"
                      : "border-border/50 opacity-50"
                  }`}
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center">
                    {isDone ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                    ) : isCurrent ? (
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    ) : (
                      <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
                    )}
                  </div>
                  <div className="flex-1 text-left">
                    <p
                      className={`text-sm font-semibold ${
                        isCurrent ? "text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {stage.label}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            You will be taken straight to your flashcards as soon as preparation
            completes.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="overflow-hidden border-border/80 shadow-md">
        <CardContent className="p-5 sm:p-7">
          {/* Input Method Selector Tabs */}
          <div className="mb-6 grid grid-cols-1 gap-2 rounded-xl bg-secondary/70 p-1.5 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => {
                setActiveTab("import");
                setErrorMessage(null);
              }}
              className={`flex items-center justify-center gap-2 rounded-lg py-2.5 px-3 text-sm font-semibold transition-all ${
                activeTab === "import"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <FileCode2 className="h-4 w-4 text-primary" />
              <span>Import JSON / CSV</span>
              <Badge
                variant="secondary"
                className="ml-0.5 px-1.5 py-0 text-[10px] text-emerald-600 dark:text-emerald-400"
              >
                No Credits
              </Badge>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab("pdf");
                setErrorMessage(null);
              }}
              className={`flex items-center justify-center gap-2 rounded-lg py-2.5 px-3 text-sm font-semibold transition-all ${
                activeTab === "pdf"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <FileUp className="h-4 w-4" />
              <span>AI from PDF</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab("text");
                setErrorMessage(null);
              }}
              className={`flex items-center justify-center gap-2 rounded-lg py-2.5 px-3 text-sm font-semibold transition-all ${
                activeTab === "text"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <FileText className="h-4 w-4" />
              <span>AI from Notes</span>
            </button>
          </div>

          {/* Error Alert Banner */}
          <AnimatePresence>
            {errorMessage && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="mb-5 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
                role="alert"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="flex-1">
                  <p className="font-semibold">Unable to create deck</p>
                  <p className="mt-0.5 opacity-90">{errorMessage}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setErrorMessage(null)}
                  className="rounded-lg p-1 hover:bg-destructive/15"
                  aria-label="Dismiss error"
                >
                  <X className="h-4 w-4" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Tab 1: Direct JSON / CSV Import (Zero AI Credits) */}
          {activeTab === "import" ? (
            <div className="space-y-5">
              {/* Step-by-Step Instructions & Ready-to-Copy AI Prompts */}
              <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4 sm:p-5">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm font-bold text-foreground sm:text-base">
                      <Wand2 className="h-4 w-4 shrink-0 text-primary" />
                      <span>
                        How to generate questions from your PDF for free (Zero
                        API Credits)
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Follow these 3 quick steps using any free AI assistant
                      (ChatGPT, Claude, Gemini, or DeepSeek):
                    </p>
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowPromptHelper((prev) => !prev)}
                    className="shrink-0 self-start text-xs font-semibold text-primary"
                  >
                    {showPromptHelper
                      ? "Hide prompt box"
                      : "Show AI prompt box"}
                  </Button>
                </div>

                {/* 3-Step Visual Guide */}
                <ol className="mt-3.5 grid gap-2.5 text-xs sm:grid-cols-3">
                  <li className="rounded-xl border border-border/70 bg-background/90 p-3">
                    <span className="font-extrabold text-primary">
                      Step 1: Copy Prompt
                    </span>
                    <p className="mt-1 text-muted-foreground leading-relaxed">
                      Choose the{" "}
                      <span className="font-semibold text-foreground">
                        JSON
                      </span>{" "}
                      (recommended) or{" "}
                      <span className="font-semibold text-foreground">CSV</span>{" "}
                      prompt below and click{" "}
                      <span className="font-semibold text-foreground">
                        Copy Prompt
                      </span>
                      .
                    </p>
                  </li>
                  <li className="rounded-xl border border-border/70 bg-background/90 p-3">
                    <span className="font-extrabold text-primary">
                      Step 2: Attach PDF in AI Chat
                    </span>
                    <p className="mt-1 text-muted-foreground leading-relaxed">
                      Open ChatGPT, Claude, or Gemini, attach your lecture PDF
                      (or paste your notes), and send the copied prompt.
                    </p>
                  </li>
                  <li className="rounded-xl border border-border/70 bg-background/90 p-3">
                    <span className="font-extrabold text-primary">
                      Step 3: Paste Result Below
                    </span>
                    <p className="mt-1 text-muted-foreground leading-relaxed">
                      Copy the AI&apos;s JSON or CSV reply, paste it into the
                      box below, and click{" "}
                      <span className="font-semibold text-foreground">
                        Create Deck
                      </span>
                      .
                    </p>
                  </li>
                </ol>

                {/* Quick Copy Buttons & Expandable Prompt Box */}
                <div className="mt-4 space-y-3 border-t border-primary/15 pt-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setActivePromptTab("json");
                          setShowPromptHelper(true);
                        }}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                          activePromptTab === "json"
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "bg-background text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Option 1: JSON Prompt (Recommended)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActivePromptTab("csv");
                          setShowPromptHelper(true);
                        }}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                          activePromptTab === "csv"
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "bg-background text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Option 2: CSV Prompt
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        onClick={() => handleCopyPrompt(activePromptTab)}
                        className="gap-1.5 text-xs shadow-sm"
                      >
                        {copiedPromptType === activePromptTab ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        <span>
                          {copiedPromptType === activePromptTab
                            ? `Copied ${activePromptTab.toUpperCase()} Prompt!`
                            : `Copy ${activePromptTab.toUpperCase()} Prompt`}
                        </span>
                      </Button>
                    </div>
                  </div>

                  {showPromptHelper && (
                    <div className="space-y-1.5">
                      <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl border border-border bg-background p-3.5 font-mono text-[11px] leading-relaxed text-foreground/90">
                        {activePromptTab === "csv"
                          ? EXTERNAL_AI_CSV_PROMPT
                          : EXTERNAL_AI_JSON_PROMPT}
                      </pre>
                    </div>
                  )}
                </div>
              </div>

              {/* Optional Deck Title & Subject Overrides */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="import-deck-title"
                    className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    Deck Title (Optional for JSON)
                  </label>
                  <input
                    id="import-deck-title"
                    type="text"
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    placeholder="e.g. Week 5 Macroeconomics Midterm"
                    className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div>
                  <label
                    htmlFor="import-deck-subject"
                    className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    Subject (Optional)
                  </label>
                  <input
                    id="import-deck-subject"
                    type="text"
                    value={customSubject}
                    onChange={(e) => setCustomSubject(e.target.value)}
                    placeholder="e.g. Economics, Biology, Networking"
                    className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              {/* Format Controls & File Upload / Sample Fillers */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Format:
                  </span>
                  {(["auto", "json", "csv"] as const).map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => setImportFormat(fmt)}
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold uppercase transition-colors ${
                        importFormat === fmt
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {fmt === "auto" ? "Auto-Detect" : fmt}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={importFileInputRef}
                    type="file"
                    accept=".json,.csv,.tsv,.txt,application/json,text/csv"
                    className="hidden"
                    onChange={(e) =>
                      handleImportFileUpload(e.target.files?.[0] || null)
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => importFileInputRef.current?.click()}
                    className="gap-1.5 text-xs"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    <span>Upload .JSON / .CSV file</span>
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setImportFormat("json");
                      setImportData(EXAMPLE_JSON_SNIPPET);
                      setErrorMessage(null);
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Load JSON example
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setImportFormat("csv");
                      setImportData(EXAMPLE_CSV_SNIPPET);
                      setErrorMessage(null);
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Load CSV example
                  </Button>
                </div>
              </div>

              {/* JSON / CSV Paste Textarea */}
              <div className="space-y-1.5">
                <textarea
                  id="import-data-textarea"
                  rows={10}
                  value={importData}
                  onChange={(e) => {
                    setImportData(e.target.value);
                    setImportedFileName(null);
                  }}
                  placeholder={
                    importFormat === "csv"
                      ? 'question,optionA,optionB,optionC,optionD,correctOptionId,explanation,topic,difficulty\n"What is 15 + 27?","32","42","45","52","B","15 + 27 equals 42.","Math","easy"'
                      : 'Paste your JSON or CSV questions here...\n\nSupports full Memly deck JSON, a simple JSON array of questions, or CSV rows with columns:\nquestion, optionA, optionB, optionC, optionD, correctOptionId, explanation, topic, difficulty'
                  }
                  className="w-full resize-y rounded-2xl border border-input bg-background p-4 font-mono text-xs leading-relaxed text-foreground placeholder:font-sans placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {importedFileName
                      ? `Loaded from file: ${importedFileName}`
                      : "Instant local creation — 0 AI tokens or OpenRouter credits used"}
                  </span>
                  <span>
                    {importData.trim().length.toLocaleString()} characters
                  </span>
                </div>
              </div>
            </div>
          ) : activeTab === "pdf" ? (
            /* Tab 2: PDF Drag and Drop Area */
            <div>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDragging(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDragging(false);
                }}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`group relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-all sm:p-10 ${
                  isDragging
                    ? "border-primary bg-primary/5"
                    : selectedFile
                    ? "border-emerald-500/50 bg-emerald-500/5"
                    : "border-border hover:border-primary/50 hover:bg-accent/40"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  onChange={(e) =>
                    handleFileSelect(e.target.files?.[0] || null)
                  }
                />

                {selectedFile ? (
                  <div className="flex flex-col items-center">
                    <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-7 w-7" />
                    </div>
                    <p className="text-base font-bold text-foreground">
                      {selectedFile.name}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • PDF
                      ready for AI analysis
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-3 text-xs text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedFile(null);
                      }}
                    >
                      Remove file & choose another
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <div className="mb-3.5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary transition-transform group-hover:scale-105">
                      <FileUp className="h-7 w-7" />
                    </div>
                    <p className="text-base font-bold text-foreground">
                      Drop your lecture PDF here, or{" "}
                      <span className="text-primary underline underline-offset-4">
                        browse files
                      </span>
                    </p>
                    <p className="mt-1.5 max-w-sm text-xs text-muted-foreground">
                      Supports lecture slides, study guides & textbooks up to 20
                      MB. Text is extracted page-by-page and topics are detected
                      automatically.
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Tab 3: Large Pasted Notes Area */
            <div className="space-y-2">
              <label
                htmlFor="notes-textarea"
                className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Paste your lecture notes, study guide, or chapter text
              </label>
              <textarea
                id="notes-textarea"
                rows={8}
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder="Paste your raw notes, definitions, lecture transcript, or textbook paragraphs here... Memly will identify every examinable topic and turn it into multiple-choice flashcards."
                className="w-full resize-y rounded-2xl border border-input bg-background p-4 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Minimum 120 characters required</span>
                <span>
                  {pastedText.trim().length.toLocaleString()} characters
                </span>
              </div>
            </div>
          )}

          {/* Primary Action Button */}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button
              type="button"
              size="lg"
              onClick={handleGenerate}
              disabled={
                activeTab === "import"
                  ? importData.trim().length === 0
                  : activeTab === "pdf"
                  ? !selectedFile
                  : pastedText.trim().length < 120
              }
              className="w-full sm:flex-1 gap-2 text-base shadow-md"
            >
              <Sparkles className="h-5 w-5" />
              <span>
                {activeTab === "import"
                  ? "Create Deck from JSON / CSV"
                  : "Start Revising Now"}
              </span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Instant Sample Exam Deck Option (Zero API Credits needed) */}
          <div className="mt-5 flex flex-col items-center justify-between gap-2 border-t border-border/60 pt-4 sm:flex-row">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <BookOpen className="h-3.5 w-3.5 text-primary" />
              <span>Want to test the flashcard experience right away?</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleLoadSampleDeck}
              className="gap-1.5 text-xs font-semibold text-primary hover:bg-primary/10"
            >
              <Zap className="h-3.5 w-3.5" />
              <span>Try Sample Deck (Math & Geography)</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Friendly Quota Reached Modal Inviting User to Import JSON/CSV or Test the Sample Deck */}
      <AnimatePresence>
        {showQuotaModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="quota-modal-title"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 12 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="relative w-full max-w-md rounded-3xl border border-border bg-card p-6 text-card-foreground shadow-2xl sm:p-8"
            >
              <button
                type="button"
                onClick={() => setShowQuotaModal(false)}
                aria-label="Close modal"
                className="absolute right-4 top-4 rounded-xl p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>

              <div className="flex flex-col items-center text-center">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
                  <Coffee className="h-7 w-7" />
                </div>

                <Badge variant="warning" className="mb-2">
                  Out of AI Credits
                </Badge>

                <h3
                  id="quota-modal-title"
                  className="text-xl font-extrabold tracking-tight text-foreground sm:text-2xl"
                >
                  Use JSON / CSV Import with zero AI credits!
                </h3>

                <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                  Your API quota on Gemini / OpenRouter is currently exhausted.
                  You can bypass API limits completely by switching to{" "}
                  <span className="font-semibold text-foreground">
                    Import JSON / CSV
                  </span>{" "}
                  — copy our prompt into free ChatGPT/Claude with your PDF and
                  paste the questions right in!
                </p>

                <div className="mt-7 flex w-full flex-col gap-2.5">
                  <Button
                    type="button"
                    size="lg"
                    onClick={() => {
                      setShowQuotaModal(false);
                      setActiveTab("import");
                    }}
                    className="w-full gap-2 text-base shadow-md"
                  >
                    <FileCode2 className="h-5 w-5" />
                    <span>Switch to JSON / CSV Import</span>
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleLoadSampleDeck}
                    className="w-full gap-2 text-sm"
                  >
                    <Zap className="h-4 w-4" />
                    <span>Try Sample Deck (Math & Geography)</span>
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
