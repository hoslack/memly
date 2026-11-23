"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Play,
  BookOpen,
  Calendar,
  Layers,
  CheckCircle2,
  RotateCcw,
  FileText,
} from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import {
  getDeckWithQuestions,
  getStudySession,
  saveStudySession,
} from "@/lib/storage/repository";
import {
  DeckRecord,
  QuestionRecord,
  StudySessionRecord,
} from "@/lib/schemas/study";
import {
  createRevisionQueue,
  serializeQueueToSessionRecord,
} from "@/lib/revision/queue";
import { formatRelativeDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

export default function DeckDetailsPage() {
  const params = useParams<{ deckId: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [deck, setDeck] = useState<DeckRecord | null>(null);
  const [questions, setQuestions] = useState<QuestionRecord[]>([]);
  const [session, setSession] = useState<StudySessionRecord | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!params?.deckId) return;
    let active = true;

    async function load() {
      setLoading(true);
      try {
        const uid = user?.uid || "guest_public";
        const res = await getDeckWithQuestions(uid, params.deckId);
        const sess =
          user?.uid && user.uid !== "guest_ssr"
            ? await getStudySession(user.uid, params.deckId)
            : null;
        if (!active) return;
        if (res) {
          setDeck(res.deck);
          setQuestions(res.questions);
          setSession(sess);
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [params?.deckId, user?.uid]);

  const handleResetAndRevise = async () => {
    if (!deck || questions.length === 0) return;
    const fresh = createRevisionQueue({
      sessionId: `${user.uid}_${deck.id}`,
      userId: user.uid,
      deckId: deck.id,
      questionIds: questions.map((q) => q.id),
      shouldShuffle: true,
    });
    await saveStudySession(serializeQueueToSessionRecord(fresh));
    router.push(`/decks/${deck.id}/revise`);
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <Card className="animate-pulse">
          <CardContent className="p-8 space-y-4">
            <div className="h-5 w-32 rounded bg-secondary" />
            <div className="h-8 w-2/3 rounded bg-secondary" />
            <div className="h-24 w-full rounded-xl bg-secondary" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!deck) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 text-center">
        <h1 className="text-xl font-bold">Deck not found</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This deck may have been deleted or belongs to another account.
        </p>
        <Link href="/dashboard" className="mt-5 inline-block">
          <Button>Back to Dashboard</Button>
        </Link>
      </div>
    );
  }

  const completedCount = session?.completedQuestionIds?.length ?? 0;
  const totalCount = deck.questionCount || 1;
  const progressPct = Math.min(
    100,
    Math.round((completedCount / totalCount) * 100)
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <Link href="/dashboard">
        <Button variant="ghost" size="sm" className="mb-4 -ml-2 gap-1.5">
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Dashboard</span>
        </Button>
      </Link>

      {/* Deck Overview Header Card */}
      <Card className="border-border/80 shadow-md">
        <CardContent className="p-6 sm:p-8">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="default">{deck.subject}</Badge>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  {formatRelativeDate(deck.createdAt)}
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" />
                  {deck.sourceFileName}
                </span>
              </div>
              <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
                {deck.title}
              </h1>
              <p className="max-w-2xl text-sm text-muted-foreground">
                {deck.description}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="lg"
                onClick={() => router.push(`/decks/${deck.id}/revise`)}
                className="gap-2"
              >
                <Play className="h-4 w-4 fill-current" />
                <span>
                  {completedCount > 0 && completedCount < totalCount
                    ? "Continue Revising"
                    : "Start Revising"}
                </span>
              </Button>
              {completedCount > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleResetAndRevise}
                  className="gap-1.5"
                >
                  <RotateCcw className="h-4 w-4" />
                  <span>Restart Queue</span>
                </Button>
              )}
            </div>
          </div>

          <div className="mt-6 space-y-2 border-t border-border/60 pt-5">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-muted-foreground">Revision Progress</span>
              <span>
                {completedCount} / {deck.questionCount} questions completed (
                {progressPct}%)
              </span>
            </div>
            <Progress value={progressPct} />
          </div>
        </CardContent>
      </Card>

      {/* Topic Coverage Breakdown */}
      <div className="mt-8 space-y-4">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold tracking-tight">
            Topic Coverage Plan ({deck.topics.length} Major Topics)
          </h2>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {deck.topics.map((topic) => {
            const topicQuestions = questions.filter(
              (q) =>
                q.topic.toLowerCase().includes(topic.name.toLowerCase()) ||
                topic.name.toLowerCase().includes(q.topic.toLowerCase())
            );
            const topicCompleted = topicQuestions.filter((q) =>
              session?.completedQuestionIds?.includes(q.id)
            ).length;

            return (
              <Card key={topic.name} className="border-border/70">
                <CardContent className="p-5 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-bold text-foreground">{topic.name}</h3>
                    <Badge variant="secondary" className="shrink-0 text-xs">
                      {topicCompleted}/{topicQuestions.length} mastered
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {topic.coverageNotes}
                  </p>
                  {topic.subtopics.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {topic.subtopics.map((sub) => (
                        <span
                          key={sub}
                          className="rounded-md bg-secondary/70 px-2 py-0.5 text-[11px] font-medium text-secondary-foreground"
                        >
                          {sub}
                        </span>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Question Bank Preview */}
      <div className="mt-8 space-y-4">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold tracking-tight">
            Examination Questions ({questions.length})
          </h2>
        </div>

        <div className="space-y-2.5">
          {questions.map((q, idx) => {
            const isMastered = session?.completedQuestionIds?.includes(q.id);
            return (
              <Card key={q.id} className="border-border/60">
                <CardContent className="flex items-start justify-between gap-4 p-4">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-extrabold text-muted-foreground">
                        Q{String(idx + 1).padStart(2, "0")}
                      </span>
                      <Badge variant="secondary" className="text-[11px]">
                        {q.topic}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="capitalize text-[11px]"
                      >
                        {q.difficulty}
                      </Badge>
                    </div>
                    <p className="text-sm font-semibold text-foreground">
                      {q.question}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Objective: {q.learningObjective}
                    </p>
                  </div>

                  {isMastered && (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
