"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Sparkles,
  Sun,
  Moon,
  User as UserIcon,
  LogIn,
  Layers,
} from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";

export function Navbar() {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const pathname = usePathname();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Hide top navbar inside the distraction-free revision flashcard view
  if (pathname?.includes("/revise")) {
    return null;
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="flex items-center gap-2.5 text-lg font-extrabold tracking-tight text-foreground transition-opacity hover:opacity-90"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Sparkles className="h-5 w-5" />
            </div>
            <span>Memly</span>
          </Link>

          <nav className="hidden items-center gap-1 sm:flex">
            <Link href="/dashboard">
              <Button
                variant={pathname === "/dashboard" ? "secondary" : "ghost"}
                size="sm"
                className="gap-1.5 font-medium"
              >
                <Layers className="h-4 w-4" />
                My Decks
              </Button>
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {mounted && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Toggle color theme"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4 text-amber-400" />
              ) : (
                <Moon className="h-4 w-4 text-slate-700" />
              )}
            </Button>
          )}

          {user.isGuest ? (
            <div className="flex items-center gap-2">
              <Badge
                variant="secondary"
                className="hidden sm:inline-flex text-xs font-medium"
              >
                Guest Mode
              </Badge>
              <Link href="/login">
                <Button variant="outline" size="sm" className="gap-1.5">
                  <LogIn className="h-3.5 w-3.5" />
                  <span>Sign in</span>
                </Button>
              </Link>
            </div>
          ) : (
            <Link href="/settings">
              <Button variant="outline" size="sm" className="gap-2">
                <UserIcon className="h-3.5 w-3.5 text-primary" />
                <span className="max-w-[130px] truncate">
                  {user.displayName || user.email}
                </span>
              </Button>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
