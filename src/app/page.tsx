"use client";

import React from "react";
import Link from "next/link";
import { Sparkles, CheckCircle2, Repeat, Zap } from "lucide-react";
import { DeckCreator } from "@/components/deck-creator";
import { DeckList } from "@/components/deck-list";
import { Badge } from "@/components/ui/badge";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      {/* Hero Section */}
      <section className="mb-8 text-center">
        <Badge
          variant="default"
          className="mb-3 gap-1.5 px-3 py-1 text-xs font-semibold"
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>Upload your notes. Start answering questions.</span>
        </Badge>

        <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-5xl">
          What are we revising today?
        </h1>

        <p className="mx-auto mt-3 max-w-xl text-base text-muted-foreground sm:text-lg">
          Upload your notes and let AI prepare you for your exams.
        </p>

        {/* Three-step zero-friction promise pills */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3 text-xs font-medium text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary/70 px-3 py-1">
            <Zap className="h-3.5 w-3.5 text-primary" />
            1. Paste JSON/CSV or upload PDF
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary/70 px-3 py-1">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            2. Answer exam questions
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary/70 px-3 py-1">
            <Repeat className="h-3.5 w-3.5 text-amber-500" />
            3. Repeat until you know everything
          </span>
        </div>
      </section>

      {/* Main Upload / Paste Deck Creator */}
      <section aria-label="Create a revision deck">
        <DeckCreator />
      </section>

      {/* Previously Created Decks */}
      <section className="mt-12" aria-label="Your revision decks">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-foreground">
              Available Revision Decks
            </h2>
            <p className="text-xs text-muted-foreground">
              Shared decks available to everyone — with your own personal progress
            </p>
          </div>
          <Link
            href="/dashboard"
            className="text-xs font-semibold text-primary hover:underline"
          >
            View all decks →
          </Link>
        </div>

        <DeckList />
      </section>
    </div>
  );
}
