"use client";

import React from "react";
import Link from "next/link";
import { DeckCreator } from "@/components/deck-creator";
import { DeckList } from "@/components/deck-list";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      {/* Hero Section */}
      <section className="mb-8 text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-5xl">
          What are we revising today?
        </h1>

        <p className="mx-auto mt-2.5 max-w-lg text-sm text-muted-foreground sm:text-base">
          Paste or upload your questions to start revising.
        </p>
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
