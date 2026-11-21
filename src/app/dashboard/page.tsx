"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Plus, X, Sparkles } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { DeckCreator } from "@/components/deck-creator";
import { DeckList } from "@/components/deck-list";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function DashboardPage() {
  const { user } = useAuth();
  const [showCreator, setShowCreator] = useState(false);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
              What are we revising today?
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload your notes and let AI prepare you for your exams.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={() => setShowCreator((prev) => !prev)}
            variant={showCreator ? "outline" : "default"}
            className="gap-2"
          >
            {showCreator ? (
              <>
                <X className="h-4 w-4" />
                <span>Close Upload</span>
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                <span>New Revision Deck</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {user.isGuest && (
        <div className="mb-6 flex flex-col justify-between gap-3 rounded-2xl border border-primary/25 bg-primary/5 p-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 shrink-0 text-primary" />
            <p className="text-xs sm:text-sm text-foreground">
              You are studying in <span className="font-bold">Guest Mode</span>.
              Your progress is saved in this browser. Sign in anytime to sync
              your decks permanently across devices.
            </p>
          </div>
          <Link href="/login">
            <Button variant="outline" size="sm" className="shrink-0">
              Save Account
            </Button>
          </Link>
        </div>
      )}

      {showCreator && (
        <div className="mb-10">
          <DeckCreator />
        </div>
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold tracking-tight text-foreground">
            All Available Decks
          </h2>
          <Badge variant="secondary" className="text-xs">
            Personal progress auto-saved
          </Badge>
        </div>
        <DeckList />
      </div>
    </div>
  );
}
