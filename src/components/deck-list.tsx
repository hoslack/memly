"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Play,
  BookOpen,
  Calendar,
  CheckCircle2,
  Clock,
  Info,
  Layers,
} from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import {
  listUserDecks,
  getStudySession,
} from "@/lib/storage/repository";
import { DeckRecord, StudySessionRecord } from "@/lib/schemas/study";
import { formatRelativeDate } from "@/lib/utils";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import { Progress } from "./ui/progress";

interface DeckWithProgress {
  deck: DeckRecord;
  session: StudySessionRecord | null;
}

export function DeckList() {
  const { user } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<DeckWithProgress[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDecks = useCallback(async () => {
    setLoading(true);
    try {
      const decks = await listUserDecks(user?.uid);
      const enriched = await Promise.all(
        decks.map(async (deck) => {
          const session =
            user?.uid && user.uid !== "guest_ssr"
              ? await getStudySession(user.uid, deck.id)
              : null;
          return { deck, session };
        })
      );
      setItems(enriched);
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => {
    loadDecks();
  }, [loadDecks]);

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {[1, 2].map((n) => (
          <Card key={n} className="animate-pulse border-border/60">
            <CardContent className="p-6 space-y-4">
              <div className="h-5 w-24 rounded-full bg-secondary" />
              <div className="h-6 w-3/4 rounded-lg bg-secondary" />
              <div className="h-3 w-full rounded-full bg-secondary" />
              <div className="h-10 w-full rounded-xl bg-secondary" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <Card className="border-dashed border-border/80 bg-card/50">
        <CardContent className="flex flex-col items-center justify-center py-10 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
            <Layers className="h-6 w-6" />
          </div>
          <h3 className="text-base font-bold text-foreground">
            No revision decks yet
          </h3>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            Paste your JSON or CSV questions above (or upload a .json / .csv
            file) to build your first exam flashcard deck automatically.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {items.map(({ deck, session }) => {
        const completedCount = session?.completedQuestionIds?.length ?? 0;
        const totalCount = deck.questionCount || 1;
        const percent = Math.min(
          100,
          Math.round((completedCount / totalCount) * 100)
        );
        const isFinished =
          session?.status === "completed" || completedCount >= totalCount;

        return (
          <Card
            key={deck.id}
            className="group relative flex flex-col justify-between transition-all hover:border-primary/40 hover:shadow-md"
          >
            <CardContent className="flex flex-1 flex-col justify-between p-5 sm:p-6">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <Badge variant="default" className="max-w-[200px] truncate">
                    {deck.subject}
                  </Badge>
                  <div className="flex items-center gap-1">
                    <Link
                      href={`/decks/${deck.id}`}
                      aria-label={`View details for ${deck.title}`}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      >
                        <Info className="h-4 w-4" />
                      </Button>
                    </Link>
                  </div>
                </div>

                <Link href={`/decks/${deck.id}`} className="block mt-2.5">
                  <h3 className="line-clamp-2 text-lg font-bold tracking-tight text-foreground group-hover:text-primary transition-colors">
                    {deck.title}
                  </h3>
                </Link>

                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {deck.description}
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1 font-medium">
                    <BookOpen className="h-3.5 w-3.5 text-primary" />
                    {deck.questionCount} questions
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {formatRelativeDate(deck.createdAt)}
                  </span>
                </div>
              </div>

              <div className="mt-5 space-y-3 border-t border-border/60 pt-4">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-muted-foreground">
                      {isFinished ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Mastered
                        </span>
                      ) : completedCount > 0 ? (
                        <span className="inline-flex items-center gap-1 text-foreground font-semibold">
                          <Clock className="h-3.5 w-3.5 text-primary" />
                          In progress
                        </span>
                      ) : (
                        "Not started"
                      )}
                    </span>
                    <span className="font-bold text-foreground">
                      {completedCount} / {deck.questionCount} ({percent}%)
                    </span>
                  </div>
                  <Progress
                    value={percent}
                    indicatorClassName={
                      isFinished ? "bg-emerald-500" : "bg-primary"
                    }
                  />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <Button
                    type="button"
                    onClick={() => router.push(`/decks/${deck.id}/revise`)}
                    className="w-full gap-2"
                    variant={isFinished ? "outline" : "default"}
                  >
                    <Play className="h-4 w-4 fill-current" />
                    <span>
                      {isFinished
                        ? "Revise Again"
                        : completedCount > 0
                        ? "Continue Revising"
                        : "Start Revising"}
                    </span>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
