"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTheme } from "next-themes";
import {
  User as UserIcon,
  LogOut,
  Sun,
  Moon,
  Monitor,
  ShieldCheck,
  Sparkles,
  ArrowLeft,
} from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function SettingsPage() {
  const router = useRouter();
  const { user, signOut, isFirebaseAvailable } = useAuth();
  const { theme, setTheme } = useTheme();
  const [health, setHealth] = useState<{
    geminiConfigured: boolean;
    geminiModel: string;
    openRouterConfigured?: boolean;
    openRouterModel?: string;
    firebaseConfigured: boolean;
  } | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((data) => setHealth(data))
      .catch(() => {});
  }, []);

  const handleSignOut = async () => {
    await signOut();
    router.push("/");
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10 space-y-6">
      <div>
        <Link href="/dashboard">
          <Button variant="ghost" size="sm" className="mb-2 -ml-2 gap-1.5">
            <ArrowLeft className="h-4 w-4" />
            <span>Back to Dashboard</span>
          </Button>
        </Link>
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
          Account & Study Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage your profile, appearance, and AI exam setter status.
        </p>
      </div>

      {/* Account Profile Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <UserIcon className="h-5 w-5 text-primary" />
            <span>Student Account</span>
          </CardTitle>
          <CardDescription>
            Your active revision session and account status
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col justify-between gap-4 rounded-2xl border border-border/70 bg-secondary/30 p-4 sm:flex-row sm:items-center">
            <div>
              <div className="flex items-center gap-2">
                <p className="font-bold text-foreground">
                  {user.displayName || "Student"}
                </p>
                <Badge variant={user.isGuest ? "secondary" : "success"}>
                  {user.isGuest ? "Guest Session" : "Signed In"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {user.email ||
                  "Studying locally in browser storage. Sign in to sync permanently."}
              </p>
            </div>

            {user.isGuest ? (
              <Link href="/login">
                <Button size="sm">Sign In / Register</Button>
              </Link>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={handleSignOut}
                className="gap-1.5 text-destructive hover:bg-destructive/10"
              >
                <LogOut className="h-4 w-4" />
                <span>Sign Out</span>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Theme Appearance Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Appearance</CardTitle>
          <CardDescription>
            Choose a comfortable colour mode for late-night exam revision
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            <Button
              type="button"
              variant={theme === "light" ? "default" : "outline"}
              onClick={() => setTheme("light")}
              className="gap-2"
            >
              <Sun className="h-4 w-4" />
              <span>Light</span>
            </Button>

            <Button
              type="button"
              variant={theme === "dark" ? "default" : "outline"}
              onClick={() => setTheme("dark")}
              className="gap-2"
            >
              <Moon className="h-4 w-4" />
              <span>Dark</span>
            </Button>

            <Button
              type="button"
              variant={theme === "system" ? "default" : "outline"}
              onClick={() => setTheme("system")}
              className="gap-2"
            >
              <Monitor className="h-4 w-4" />
              <span>System</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* AI & Cloud Service Status Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <span>Environment & Service Status</span>
          </CardTitle>
          <CardDescription>
            Server-side Google Gemini and Firebase integration diagnostics
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between rounded-xl border border-border/70 p-3.5">
            <div className="flex items-center gap-2.5">
              <Sparkles className="h-4 w-4 text-primary" />
              <div>
                <p className="font-semibold">
                  Google Gemini API (Primary Provider)
                </p>
                <p className="text-xs text-muted-foreground">
                  Model: {health?.geminiModel || "gemini-3.5-flash-lite"}
                </p>
              </div>
            </div>
            <Badge
              variant={health?.geminiConfigured ? "success" : "warning"}
            >
              {health?.geminiConfigured
                ? "Primary Active"
                : "Needs GEMINI_API_KEY"}
            </Badge>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border/70 p-3.5">
            <div className="flex items-center gap-2.5">
              <Sparkles className="h-4 w-4 text-emerald-500" />
              <div>
                <p className="font-semibold">
                  OpenRouter API (Automatic Fallback)
                </p>
                <p className="text-xs text-muted-foreground">
                  Model: {health?.openRouterModel || "openrouter/free"} (Used only on Gemini 429/503)
                </p>
              </div>
            </div>
            <Badge
              variant={health?.openRouterConfigured ? "success" : "secondary"}
            >
              {health?.openRouterConfigured
                ? "Fallback Ready"
                : "Not Configured"}
            </Badge>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border/70 p-3.5">
            <div>
              <p className="font-semibold">Firebase Auth & Cloud Firestore</p>
              <p className="text-xs text-muted-foreground">
                Automatic local storage fallback enabled
              </p>
            </div>
            <Badge variant={isFirebaseAvailable ? "success" : "secondary"}>
              {isFirebaseAvailable
                ? "Cloud Sync Active"
                : "Local Persistence Mode"}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
