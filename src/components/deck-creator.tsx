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
} from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { saveGeneratedDeck } from "@/lib/storage/repository";
import { SAMPLE_DEVELOPMENT_DECK_PAYLOAD } from "@/lib/sample-deck";
import { GeneratedDeckPayloadSchema } from "@/lib/schemas/deck";
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

interface DeckCreatorProps {
  onDeckCreated?: (deckId: string) => void;
  defaultTab?: "pdf" | "text";
}

export function DeckCreator({
  onDeckCreated,
  defaultTab = "pdf",
}: DeckCreatorProps) {
  const router = useRouter();
  const { user, getIdToken } = useAuth();
  const [activeTab, setActiveTab] = useState<"pdf" | "text">(defaultTab);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showQuotaModal, setShowQuotaModal] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeStageIndex, setActiveStageIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

    // Advance through the meaningful backend stages realistically while waiting for the server response
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
        // Non-JSON response (e.g. Vercel 504 Gateway Timeout plain text)
        if (response.status === 504 || response.status === 503 || response.status === 429) {
          clearInterval(stageInterval);
          setIsGenerating(false);
          setShowQuotaModal(true);
          return;
        }
        throw new Error(
          "The AI server took too long to respond. Please try a shorter section of notes or try the Sample Deck below."
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
              AI Exam Setter Active
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
            You will be taken straight to your flashcards as soon as generation
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
          <div className="mb-6 grid grid-cols-2 gap-2 rounded-xl bg-secondary/70 p-1.5">
            <button
              type="button"
              onClick={() => {
                setActiveTab("pdf");
                setErrorMessage(null);
              }}
              className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-all ${
                activeTab === "pdf"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <FileUp className="h-4 w-4" />
              <span>Upload a PDF</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab("text");
                setErrorMessage(null);
              }}
              className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-all ${
                activeTab === "text"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <FileText className="h-4 w-4" />
              <span>Paste Notes</span>
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
                  <p className="font-semibold">Unable to generate deck</p>
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

          {/* Tab 1: PDF Drag and Drop Area */}
          {activeTab === "pdf" ? (
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
            /* Tab 2: Large Pasted Notes Area */
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
                activeTab === "pdf"
                  ? !selectedFile
                  : pastedText.trim().length < 120
              }
              className="w-full sm:flex-1 gap-2 text-base shadow-md"
            >
              <Sparkles className="h-5 w-5" />
              <span>Start Revising Now</span>
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

      {/* Friendly Quota Reached Modal Inviting User to Test the Sample Deck */}
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
                  High Study Demand
                </Badge>

                <h3
                  id="quota-modal-title"
                  className="text-xl font-extrabold tracking-tight text-foreground sm:text-2xl"
                >
                  Our AI exam setter is taking a quick breather!
                </h3>

                <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                  Free AI generation quota is temporarily full right now. Don’t
                  worry—your uploaded material is still here. While it resets,
                  why not jump in and test the interactive flashcards with our{" "}
                  <span className="font-semibold text-foreground">
                    General Knowledge (Math & Geography)
                  </span>{" "}
                  sample deck?
                </p>

                <div className="mt-7 flex w-full flex-col gap-2.5">
                  <Button
                    type="button"
                    size="lg"
                    onClick={handleLoadSampleDeck}
                    className="w-full gap-2 text-base shadow-md"
                  >
                    <Zap className="h-5 w-5" />
                    <span>Try Sample Deck (Math & Geography)</span>
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setShowQuotaModal(false)}
                    className="w-full text-xs text-muted-foreground hover:text-foreground"
                  >
                    Back to my notes
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
