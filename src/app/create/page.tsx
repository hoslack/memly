"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { DeckCreator } from "@/components/deck-creator";
import { Button } from "@/components/ui/button";

export default function CreateDeckPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-6">
        <Link href="/dashboard">
          <Button variant="ghost" size="sm" className="mb-2 -ml-2 gap-1.5">
            <ArrowLeft className="h-4 w-4" />
            <span>Back to Dashboard</span>
          </Button>
        </Link>
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
          Create a New Revision Deck
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a PDF or paste your study material. Gemini handles titles,
          topics, and questions automatically.
        </p>
      </div>

      <DeckCreator />
    </div>
  );
}
