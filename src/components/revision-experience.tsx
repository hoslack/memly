"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, PanInfo } from "motion/react";
import {
  X,
  CheckCircle2,
  XCircle,
  ArrowRight,
  SkipForward,
  BookOpen,
  Lightbulb,
  Repeat,
  Keyboard,
} from "lucide-react";
import { DeckRecord, QuestionRecord } from "@/lib/schemas/study";
import { OptionId } from "@/lib/schemas/deck";
import {
  RevisionQueueState,
  createRevisionQueue,
  getCurrentQuestionId,
  recordQueueAnswer,
  skipCurrentQuestion,
  getQueueProgressMetrics,
  serializeQueueToSessionRecord,
  deserializeSessionRecordToQueue,
} from "@/lib/revision/queue";
import {
  getStudySession,
  saveStudySession,
  recordUserQuestionAttempt,
} from "@/lib/storage/repository";
import { CompletionScreen } from "./completion-screen";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import { Progress } from "./ui/progress";

interface RevisionExperienceProps {
  userId: string;
  deck: DeckRecord;
  questions: QuestionRecord[];
}

export function RevisionExperience({
  userId,
  deck,
  questions,
}: RevisionExperienceProps) {
  const router = useRouter();
  const [queueState, setQueueState] = useState<RevisionQueueState | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState<OptionId | null>(
    null
  );
  const [focusedIndex, setFocusedIndex] = useState<number>(0);
  const [feedbackState, setFeedbackState] = useState<
    "idle" | "correct" | "incorrect"
  >("idle");
  const questionStartTimeRef = useRef<number>(Date.now());
  const autoAdvanceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize or restore persisted revision queue
  useEffect(() => {
    let mounted = true;

    async function initSession() {
      const existing = await getStudySession(userId, deck.id);
      if (!mounted) return;

      if (
        existing &&
        existing.status === "active" &&
        existing.activeQueue &&
        existing.activeQueue.length > 0
      ) {
        setQueueState(deserializeSessionRecordToQueue(existing));
      } else if (existing && existing.status === "completed") {
        setQueueState(deserializeSessionRecordToQueue(existing));
      } else {
        const freshQueue = createRevisionQueue({
          sessionId: `${userId}_${deck.id}`,
          userId,
          deckId: deck.id,
          questionIds: questions.map((q) => q.id),
          shouldShuffle: true,
        });
        setQueueState(freshQueue);
        await saveStudySession(serializeQueueToSessionRecord(freshQueue));
      }
      questionStartTimeRef.current = Date.now();
    }

    initSession();

    return () => {
      mounted = false;
      if (autoAdvanceTimerRef.current) {
        clearTimeout(autoAdvanceTimerRef.current);
      }
    };
  }, [userId, deck.id, questions]);

  const currentQuestionId = queueState
    ? getCurrentQuestionId(queueState)
    : null;
  const currentQuestion =
    questions.find((q) => q.id === currentQuestionId) ?? null;

  const advanceToNextQuestion = useCallback(
    async (isCorrect: boolean) => {
      if (!queueState || !currentQuestion) return;

      if (autoAdvanceTimerRef.current) {
        clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }

      const elapsedSec = Math.max(
        1,
        Math.round((Date.now() - questionStartTimeRef.current) / 1000)
      );

      const nextState = recordQueueAnswer(
        queueState,
        currentQuestion.id,
        isCorrect,
        3,
        elapsedSec
      );

      setQueueState(nextState);
      setSelectedOptionId(null);
      setFeedbackState("idle");
      setFocusedIndex(0);
      questionStartTimeRef.current = Date.now();

      await Promise.all([
        saveStudySession(serializeQueueToSessionRecord(nextState)),
        recordUserQuestionAttempt({
          userId,
          deckId: deck.id,
          questionId: currentQuestion.id,
          isCorrect,
        }),
      ]);
    },
    [queueState, currentQuestion, userId, deck.id]
  );

  // Instant tap-to-answer handler
  const handleSelectOption = useCallback(
    (optionId: OptionId) => {
      if (!currentQuestion || feedbackState !== "idle") return;

      setSelectedOptionId(optionId);
      const isRight = optionId === currentQuestion.correctOptionId;

      if (isRight) {
        setFeedbackState("correct");
        // Automatically advance after a short 950ms celebration delay
        autoAdvanceTimerRef.current = setTimeout(() => {
          advanceToNextQuestion(true);
        }, 950);
      } else {
        setFeedbackState("incorrect");
      }
    },
    [currentQuestion, feedbackState, advanceToNextQuestion]
  );

  // Skip current question to return later
  const handleSkipQuestion = useCallback(async () => {
    if (!queueState || !currentQuestion || feedbackState !== "idle") return;
    if (queueState.activeQueue.length <= 1) return;

    const nextState = skipCurrentQuestion(queueState, currentQuestion.id, 3);
    setQueueState(nextState);
    setSelectedOptionId(null);
    setFocusedIndex(0);
    questionStartTimeRef.current = Date.now();
    await saveStudySession(serializeQueueToSessionRecord(nextState));
  }, [queueState, currentQuestion, feedbackState]);

  // Restart a fresh revision session
  const handleReviseAgain = useCallback(async () => {
    const freshQueue = createRevisionQueue({
      sessionId: `${userId}_${deck.id}`,
      userId,
      deckId: deck.id,
      questionIds: questions.map((q) => q.id),
      shouldShuffle: true,
    });
    setQueueState(freshQueue);
    setSelectedOptionId(null);
    setFeedbackState("idle");
    setFocusedIndex(0);
    questionStartTimeRef.current = Date.now();
    await saveStudySession(serializeQueueToSessionRecord(freshQueue));
  }, [userId, deck.id, questions]);

  // Exit and persist progress
  const handleExitSession = useCallback(async () => {
    if (autoAdvanceTimerRef.current) {
      clearTimeout(autoAdvanceTimerRef.current);
    }
    if (queueState) {
      await saveStudySession(serializeQueueToSessionRecord(queueState));
    }
    router.push("/dashboard");
  }, [queueState, router]);

  // Desktop Keyboard Shortcuts: 1-4, ArrowUp/ArrowDown, Enter, Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!currentQuestion || !queueState || queueState.status === "completed")
        return;

      if (e.key === "Escape") {
        e.preventDefault();
        handleExitSession();
        return;
      }

      if (feedbackState === "incorrect") {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight") {
          e.preventDefault();
          advanceToNextQuestion(false);
        }
        return;
      }

      if (feedbackState === "correct") {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          advanceToNextQuestion(true);
        }
        return;
      }

      const opts = currentQuestion.options;
      if (e.key === "1" && opts[0]) {
        e.preventDefault();
        setFocusedIndex(0);
        handleSelectOption(opts[0].id);
      } else if (e.key === "2" && opts[1]) {
        e.preventDefault();
        setFocusedIndex(1);
        handleSelectOption(opts[1].id);
      } else if (e.key === "3" && opts[2]) {
        e.preventDefault();
        setFocusedIndex(2);
        handleSelectOption(opts[2].id);
      } else if (e.key === "4" && opts[3]) {
        e.preventDefault();
        setFocusedIndex(3);
        handleSelectOption(opts[3].id);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) => (prev + 1) % opts.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => (prev - 1 + opts.length) % opts.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const target = opts[focusedIndex];
        if (target) {
          handleSelectOption(target.id);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    currentQuestion,
    queueState,
    feedbackState,
    focusedIndex,
    handleSelectOption,
    advanceToNextQuestion,
    handleExitSession,
  ]);

  // Swipe gesture handler (Swipe left to skip, Swipe right to confirm/continue)
  const handleDragEnd = (
    _: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo
  ) => {
    const threshold = 95;
    if (info.offset.x < -threshold) {
      // Swipe Left -> Skip if unanswered, or continue if incorrect feedback is open
      if (feedbackState === "idle") {
        handleSkipQuestion();
      } else if (feedbackState === "incorrect") {
        advanceToNextQuestion(false);
      }
    } else if (info.offset.x > threshold) {
      // Swipe Right -> Confirm focused option or advance
      if (feedbackState === "incorrect") {
        advanceToNextQuestion(false);
      } else if (feedbackState === "correct") {
        advanceToNextQuestion(true);
      } else if (currentQuestion) {
        const opt = currentQuestion.options[focusedIndex];
        if (opt) {
          handleSelectOption(opt.id);
        }
      }
    }
  };

  if (!queueState) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4">
        <Card className="animate-pulse">
          <CardContent className="p-8 space-y-4">
            <div className="h-4 w-32 rounded bg-secondary" />
            <div className="h-8 w-full rounded bg-secondary" />
            <div className="space-y-3 pt-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-14 w-full rounded-xl bg-secondary" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const metrics = getQueueProgressMetrics(queueState);

  if (metrics.isCompleted || !currentQuestion) {
    return (
      <CompletionScreen
        deck={deck}
        queueState={queueState}
        onReviseAgain={handleReviseAgain}
        onReturnDashboard={() => router.push("/dashboard")}
      />
    );
  }

  const questionStatus =
    queueState.questionStatuses[currentQuestion.id] ?? "NEW";
  const displayNumber = String(metrics.completedCount + 1).padStart(2, "0");
  const displayTotal = String(metrics.totalQuestions).padStart(2, "0");

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-between px-4 py-4 sm:px-6 sm:py-6">
      {/* Top Distraction-Free Progress Header */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleExitSession}
              aria-label="Exit revision session and save progress"
              className="h-9 w-9 rounded-xl text-muted-foreground hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </Button>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Question {displayNumber} of {displayTotal}
              </p>
              <h1 className="max-w-[230px] truncate text-sm font-semibold text-foreground sm:max-w-md">
                {deck.title}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs font-semibold">
            <span className="rounded-lg bg-emerald-500/10 px-2.5 py-1 text-emerald-700 dark:text-emerald-300">
              Completed: {metrics.completedCount} / {metrics.totalQuestions}
            </span>
            <span className="hidden rounded-lg bg-secondary px-2.5 py-1 text-muted-foreground sm:inline-block">
              Remaining: {metrics.remainingCount}
            </span>
          </div>
        </div>

        <Progress value={metrics.progressPercentage} className="h-2" />
      </div>

      {/* Center Interactive Flashcard */}
      <div className="my-auto py-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={`${currentQuestion.id}_${queueState.totalAttempts}`}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.18}
            onDragEnd={handleDragEnd}
            className="touch-pan-y"
          >
            <Card className="overflow-hidden border-border/80 shadow-lg">
              <CardContent className="p-5 sm:p-8">
                {/* Topic & Status Badges */}
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      variant="default"
                      className="uppercase tracking-wider text-[11px]"
                    >
                      TOPIC: {currentQuestion.topic}
                    </Badge>
                    {currentQuestion.subtopic && (
                      <Badge variant="secondary" className="text-[11px]">
                        {currentQuestion.subtopic}
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {questionStatus === "RETRY" && (
                      <Badge variant="warning" className="gap-1 text-[11px]">
                        <Repeat className="h-3 w-3" />
                        Retry Queue
                      </Badge>
                    )}
                    <Badge
                      variant="outline"
                      className="capitalize text-[11px] text-muted-foreground"
                    >
                      {currentQuestion.difficulty}
                    </Badge>
                  </div>
                </div>

                {/* Question Stem */}
                <h2 className="text-lg font-bold leading-snug text-foreground sm:text-xl">
                  {currentQuestion.question}
                </h2>

                {/* Four Answer Options */}
                <div className="mt-6 space-y-3" role="radiogroup">
                  {currentQuestion.options.map((option, idx) => {
                    const isSelected = selectedOptionId === option.id;
                    const isCorrectOption =
                      option.id === currentQuestion.correctOptionId;
                    const isKeyboardFocused =
                      feedbackState === "idle" && focusedIndex === idx;

                    let optionStyle =
                      "border-border/80 bg-background hover:border-primary/50 hover:bg-accent/40";
                    let badgeStyle =
                      "bg-secondary text-secondary-foreground group-hover:bg-primary/15 group-hover:text-primary";

                    if (feedbackState === "correct" && isCorrectOption) {
                      optionStyle =
                        "border-emerald-500 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100 ring-2 ring-emerald-500/30";
                      badgeStyle = "bg-emerald-600 text-white";
                    } else if (feedbackState === "incorrect") {
                      if (isCorrectOption) {
                        optionStyle =
                          "border-emerald-500 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100 ring-1 ring-emerald-500/30";
                        badgeStyle = "bg-emerald-600 text-white";
                      } else if (isSelected) {
                        optionStyle =
                          "border-rose-500 bg-rose-500/10 text-rose-950 dark:text-rose-100 ring-2 ring-rose-500/30";
                        badgeStyle = "bg-rose-600 text-white";
                      } else {
                        optionStyle = "border-border/40 opacity-55";
                      }
                    } else if (isKeyboardFocused) {
                      optionStyle =
                        "border-primary/70 bg-primary/5 ring-1 ring-primary/20";
                    }

                    return (
                      <motion.button
                        key={option.id}
                        type="button"
                        disabled={feedbackState !== "idle"}
                        onClick={() => {
                          setFocusedIndex(idx);
                          handleSelectOption(option.id);
                        }}
                        whileTap={
                          feedbackState === "idle" ? { scale: 0.99 } : {}
                        }
                        className={`group flex w-full items-start gap-3.5 rounded-2xl border p-4 text-left transition-all ${optionStyle}`}
                      >
                        <span
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-extrabold transition-colors ${badgeStyle}`}
                        >
                          {option.id}
                        </span>

                        <span className="flex-1 pt-0.5 text-sm font-medium leading-relaxed sm:text-base">
                          {option.text}
                        </span>

                        {feedbackState !== "idle" && isCorrectOption && (
                          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        )}
                        {feedbackState === "incorrect" &&
                          isSelected &&
                          !isCorrectOption && (
                            <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
                          )}
                      </motion.button>
                    );
                  })}
                </div>

                {/* Feedback Panel */}
                <AnimatePresence>
                  {feedbackState === "correct" && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="mt-5 flex items-center justify-between rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-900 dark:text-emerald-200"
                    >
                      <div className="flex items-center gap-2.5">
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        <div>
                          <p className="text-sm font-bold">
                            Spot on! Marked as completed.
                          </p>
                          <p className="text-xs opacity-85">
                            Advancing to next question...
                          </p>
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => advanceToNextQuestion(true)}
                        className="text-xs font-bold"
                      >
                        Next
                      </Button>
                    </motion.div>
                  )}

                  {feedbackState === "incorrect" && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="mt-6 space-y-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 sm:p-5"
                    >
                      <div className="flex items-start gap-3">
                        <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                        <div className="space-y-1.5 text-sm">
                          <p className="font-bold text-foreground">
                            Why{" "}
                            <span className="text-emerald-600 dark:text-emerald-400">
                              Option {currentQuestion.correctOptionId}
                            </span>{" "}
                            is correct:
                          </p>
                          <p className="leading-relaxed text-foreground/90">
                            {currentQuestion.explanation}
                          </p>

                          {(currentQuestion.sourceReference?.page ||
                            currentQuestion.sourceReference?.section) && (
                            <p className="pt-1 text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                              <BookOpen className="h-3.5 w-3.5 text-primary" />
                              <span>
                                Source:{" "}
                                {[
                                  currentQuestion.sourceReference.page
                                    ? `Page ${currentQuestion.sourceReference.page}`
                                    : null,
                                  currentQuestion.sourceReference.section,
                                ]
                                  .filter(Boolean)
                                  .join(" • ")}
                              </span>
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 border-t border-border/60 pt-3 sm:flex-row sm:items-center sm:justify-between">
                        <span className="text-xs font-medium text-muted-foreground">
                          Added back to your revision queue to retry after a few
                          questions.
                        </span>
                        <Button
                          type="button"
                          onClick={() => advanceToNextQuestion(false)}
                          className="w-full sm:w-auto gap-1.5"
                        >
                          <span>Got it, Continue</span>
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </CardContent>
            </Card>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom Accessible Controls & Keyboard Hints */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          {feedbackState === "idle" && metrics.remainingCount > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleSkipQuestion}
              className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <SkipForward className="h-3.5 w-3.5" />
              <span>Skip for later (Swipe left)</span>
            </Button>
          )}
        </div>

        <div className="hidden items-center gap-1.5 sm:flex">
          <Keyboard className="h-3.5 w-3.5" />
          <span>Keys 1–4 or Arrows to select • Enter to confirm • Esc to exit</span>
        </div>
      </div>
    </div>
  );
}
