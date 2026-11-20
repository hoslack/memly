"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { getDeckWithQuestions } from "@/lib/storage/repository";
import { DeckRecord, QuestionRecord } from "@/lib/schemas/study";
import { RevisionExperience } from "@/components/revision-experience";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function ReviseDeckPage() {
  const params = useParams<{ deckId: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [data, setData] = useState<{
    deck: DeckRecord;
    questions: QuestionRecord[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!params?.deckId || !user?.uid || user.uid === "guest_ssr") return;
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await getDeckWithQuestions(user.uid, params.deckId);
        if (!active) return;
        if (!res) {
          setError("Revision deck not found or you do not have access to it.");
        } else {
          setData(res);
        }
      } catch (err: unknown) {
        if (!active) return;
        setError(
          err instanceof Error
            ? err.message
            : "Unable to load revision deck."
        );
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [params?.deckId, user?.uid]);

  if (loading) {
    return (
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-4">
        <Card className="animate-pulse">
          <CardContent className="p-8 space-y-5">
            <div className="h-4 w-40 rounded bg-secondary" />
            <div className="h-8 w-full rounded bg-secondary" />
            <div className="space-y-3 pt-4">
              {[1, 2, 3, 4].map((n) => (
                <div key={n} className="h-14 w-full rounded-2xl bg-secondary" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
        <Card>
          <CardContent className="flex flex-col items-center p-8 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/15 text-destructive">
              <AlertCircle className="h-6 w-6" />
            </div>
            <h1 className="text-lg font-bold text-foreground">
              Could not open revision session
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {error || "This deck could not be found."}
            </p>
            <Link href="/dashboard" className="mt-6 w-full">
              <Button className="w-full gap-2">
                <ArrowLeft className="h-4 w-4" />
                <span>Back to Dashboard</span>
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <RevisionExperience
      userId={user.uid}
      deck={data.deck}
      questions={data.questions}
    />
  );
}
