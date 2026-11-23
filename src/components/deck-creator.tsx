"use client";

import React, { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import {
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Loader2,
  BookOpen,
  X,
  ArrowRight,
  Zap,
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
import {
  parseImportedDeck,
  EXTERNAL_AI_JSON_PROMPT,
  EXTERNAL_AI_CSV_PROMPT,
} from "@/lib/import/deck-importer";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";

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
}

export function DeckCreator({ onDeckCreated }: DeckCreatorProps) {
  const router = useRouter();
  const { user } = useAuth();
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const importFileInputRef = useRef<HTMLInputElement>(null);

  const handleCopyPrompt = async (type: "json" | "csv") => {
    const textToCopy =
      type === "json" ? EXTERNAL_AI_JSON_PROMPT : EXTERNAL_AI_CSV_PROMPT;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedPromptType(type);
      setTimeout(() => setCopiedPromptType(null), 2500);
    } catch {
      // Clipboard fallback ignored
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

    setIsCreating(true);

    try {
      const { payload, detectedFormat } = parseImportedDeck(trimmed, {
        customTitle: customTitle.trim() || undefined,
        customSubject: customSubject.trim() || undefined,
        formatHint: importFormat,
      });

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
      setIsCreating(false);
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Could not parse the provided JSON/CSV data. Please check the format and try again."
      );
    }
  };

  const handleLoadSampleDeck = async () => {
    setErrorMessage(null);
    setIsCreating(true);

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
      setIsCreating(false);
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to load sample deck."
      );
    }
  };

  if (isCreating) {
    return (
      <Card className="overflow-hidden border-primary/20 shadow-lg">
        <CardContent className="p-6 sm:p-8">
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Loader2 className="h-7 w-7 animate-spin" />
            </div>
            <Badge variant="default" className="mb-2">
              Building Deck Instantly
            </Badge>
            <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
              Preparing revision deck
            </h2>
            <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
              Validating questions, saving flashcards, and initializing your
              revision queue...
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden border-border/80 shadow-md">
      <CardContent className="p-5 sm:p-7">
        {/* Header Bar */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <FileCode2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground sm:text-lg">
                Import Questions (JSON or CSV)
              </h2>
              <p className="text-xs text-muted-foreground">
                Create an exam revision deck directly from ready-made questions
              </p>
            </div>
          </div>

          <Badge
            variant="secondary"
            className="gap-1 px-2.5 py-1 text-xs text-emerald-600 dark:text-emerald-400"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Zero AI Credits Needed</span>
          </Badge>
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

        <div className="space-y-5">
          {/* Step-by-Step Instructions & Ready-to-Copy AI Prompts */}
          <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4 sm:p-5">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-bold text-foreground sm:text-base">
                  <Wand2 className="h-4 w-4 shrink-0 text-primary" />
                  <span>
                    How to generate questions from your PDF for free (Zero API
                    Credits)
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
                {showPromptHelper ? "Hide prompt box" : "Show AI prompt box"}
              </Button>
            </div>

            {/* 3-Step Visual Guide */}
            <ol className="mt-3.5 grid gap-2.5 text-xs sm:grid-cols-3">
              <li className="rounded-xl border border-border/70 bg-background/90 p-3">
                <span className="font-extrabold text-primary">
                  Step 1: Copy Prompt
                </span>
                <p className="mt-1 leading-relaxed text-muted-foreground">
                  Choose the{" "}
                  <span className="font-semibold text-foreground">JSON</span>{" "}
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
                <p className="mt-1 leading-relaxed text-muted-foreground">
                  Open ChatGPT, Claude, or Gemini, attach your lecture PDF (or
                  paste your notes), and send the copied prompt.
                </p>
              </li>
              <li className="rounded-xl border border-border/70 bg-background/90 p-3">
                <span className="font-extrabold text-primary">
                  Step 3: Paste Result Below
                </span>
                <p className="mt-1 leading-relaxed text-muted-foreground">
                  Copy the AI&apos;s JSON or CSV reply, paste it into the box
                  below, and click{" "}
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
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setActivePromptTab("json");
                      setShowPromptHelper(true);
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                      activePromptTab === "json"
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "bg-background text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <FileCode2 className="h-3.5 w-3.5" />
                    <span>Option 1: JSON Prompt (Recommended)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActivePromptTab("csv");
                      setShowPromptHelper(true);
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                      activePromptTab === "csv"
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "bg-background text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Table className="h-3.5 w-3.5" />
                    <span>Option 2: CSV Prompt</span>
                  </button>
                </div>

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

        {/* Primary Action Button */}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            size="lg"
            onClick={handleCreateFromImport}
            disabled={importData.trim().length === 0}
            className="w-full gap-2 text-base shadow-md sm:flex-1"
          >
            <Sparkles className="h-5 w-5" />
            <span>Create Deck from JSON / CSV</span>
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Instant Sample Exam Deck Option */}
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
  );
}
