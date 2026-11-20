"use client";

import React from "react";
import { motion } from "motion/react";
import {
  Trophy,
  RotateCcw,
  LayoutDashboard,
  CheckCircle2,
  Repeat,
  Clock,
  Target,
  BookOpen,
} from "lucide-react";
import { DeckRecord } from "@/lib/schemas/study";
import { RevisionQueueState, getQueueProgressMetrics } from "@/lib/revision/queue";
import { formatDurationSeconds } from "@/lib/utils";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";

interface CompletionScreenProps {
  deck: DeckRecord;
  queueState: RevisionQueueState;
  onReviseAgain: () => void;
  onReturnDashboard: () => void;
}

export function CompletionScreen({
  deck,
  queueState,
  onReviseAgain,
  onReturnDashboard,
}: CompletionScreenProps) {
  const metrics = getQueueProgressMetrics(queueState);

  return (
    <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-2xl flex-col justify-center px-4 py-10">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <Card className="overflow-hidden border-primary/25 shadow-xl">
          <CardContent className="p-6 sm:p-9">
            <div className="flex flex-col items-center text-center">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{
                  type: "spring",
                  stiffness: 260,
                  damping: 18,
                  delay: 0.1,
                }}
                className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 shadow-sm"
              >
                <Trophy className="h-8 w-8" />
              </motion.div>

              <Badge variant="success" className="mb-2">
                Revision Deck Complete
              </Badge>

              <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
                You nailed every question!
              </h1>

              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                You completed <span className="font-semibold text-foreground">{deck.title}</span>.
                Every single question was answered correctly.
              </p>
            </div>

            {/* Key Performance Metrics Grid */}
            <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-border/70 bg-secondary/40 p-4 text-center">
                <div className="mx-auto mb-1.5 flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <BookOpen className="h-4 w-4" />
                </div>
                <p className="text-2xl font-extrabold text-foreground">
                  {metrics.totalQuestions}
                </p>
                <p className="text-xs font-medium text-muted-foreground">
                  Questions Answered
                </p>
              </div>

              <div className="rounded-2xl border border-border/70 bg-secondary/40 p-4 text-center">
                <div className="mx-auto mb-1.5 flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <p className="text-2xl font-extrabold text-foreground">
                  {metrics.firstAttemptCorrectCount}
                </p>
                <p className="text-xs font-medium text-muted-foreground">
                  First-Try Correct
                </p>
              </div>

              <div className="rounded-2xl border border-border/70 bg-secondary/40 p-4 text-center">
                <div className="mx-auto mb-1.5 flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
                  <Repeat className="h-4 w-4" />
                </div>
                <p className="text-2xl font-extrabold text-foreground">
                  {metrics.retryCount}
                </p>
                <p className="text-xs font-medium text-muted-foreground">
                  Needed Retries
                </p>
              </div>

              <div className="rounded-2xl border border-border/70 bg-secondary/40 p-4 text-center">
                <div className="mx-auto mb-1.5 flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Target className="h-4 w-4" />
                </div>
                <p className="text-2xl font-extrabold text-foreground">
                  {metrics.totalAttempts}
                </p>
                <p className="text-xs font-medium text-muted-foreground">
                  Total Attempts
                </p>
              </div>

              <div className="rounded-2xl border border-border/70 bg-secondary/40 p-4 text-center">
                <div className="mx-auto mb-1.5 flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Clock className="h-4 w-4" />
                </div>
                <p className="text-2xl font-extrabold text-foreground">
                  {formatDurationSeconds(queueState.elapsedSeconds)}
                </p>
                <p className="text-xs font-medium text-muted-foreground">
                  Time Spent
                </p>
              </div>

              <div className="rounded-2xl border border-border/70 bg-secondary/40 p-4 text-center">
                <div className="mx-auto mb-1.5 flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <Trophy className="h-4 w-4" />
                </div>
                <p className="text-2xl font-extrabold text-foreground">
                  {metrics.accuracyPercentage}%
                </p>
                <p className="text-xs font-medium text-muted-foreground">
                  Session Accuracy
                </p>
              </div>
            </div>

            {/* Topics Covered Summary */}
            <div className="mt-7 rounded-2xl border border-border/70 bg-background/60 p-4">
              <p className="mb-2.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Topics Covered ({deck.topics.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {deck.topics.map((topic) => (
                  <Badge
                    key={topic.name}
                    variant="secondary"
                    className="px-3 py-1 text-xs font-medium"
                  >
                    {topic.name}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Primary Actions */}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button
                type="button"
                size="lg"
                onClick={onReviseAgain}
                className="w-full sm:flex-1 gap-2"
              >
                <RotateCcw className="h-4 w-4" />
                <span>Revise Again</span>
              </Button>

              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={onReturnDashboard}
                className="w-full sm:flex-1 gap-2"
              >
                <LayoutDashboard className="h-4 w-4" />
                <span>Return to Dashboard</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
