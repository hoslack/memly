# Memly — AI-Powered Exam Revision Flashcard Web App

> **Upload your notes. Start answering questions. Repeat until you know everything.**

Memly is a production-minded, mobile-first exam revision application built for students who want to revise as efficiently as possible. Upload a lecture PDF or paste raw study notes, and Google Gemini acts as an experienced examination setter—reading the entire document, creating a full-document topic coverage plan, and generating verified four-option multiple-choice flashcards with explanations and an adaptive retry queue.

---

## 1. Technology Stack

- **Framework:** Next.js 15 (App Router) + React 19 + TypeScript
- **Styling & UI:** Tailwind CSS, shadcn/ui components, `next-themes` (Light / Dark / System mode), Lucide React icons
- **Animations & Gestures:** Motion (`motion/react`) for smooth card transitions and mobile swipe interactions
- **Primary AI Provider:** Official `@google/genai` SDK (`gemini-3.5-flash-lite` configurable via `GEMINI_MODEL`)
- **Fallback AI Provider:** OpenRouter (`openrouter/free` configurable via `OPENROUTER_MODEL`) — automatically invoked **only** when Gemini experiences HTTP 429 quota exhaustion/rate limits or HTTP 500/503 temporary service unavailability
- **Shared PDF Processing Pipeline (`src/lib/pdf/extract-text.ts`):**
  - Provider-agnostic PDF text extraction using `pdfjs-dist` + `pdf-lib` structural validation (and optional `tesseract.js` OCR fallback)
  - Extracts selectable text from every page **once per upload**, preserving page boundaries (`PAGE 1:`, `PAGE 2:`, ...) and chunking large documents cleanly
  - Passes the exact same normalized extracted text and page references to **all configured AI providers** (Gemini primary, OpenRouter fallback, and any additional providers) without re-uploading or re-extracting the PDF
- **Authentication & Storage:** Firebase Authentication (Google & Email/Password + zero-friction Guest Mode), Cloud Firestore, Firebase Storage, plus automatic browser `localStorage` offline persistence
- **Validation & Testing:** Zod structured schemas + Vitest test suite

---

## 2. Project Setup & Installation

### Prerequisites
- Node.js 20+ and npm

### Install Dependencies
```bash
npm install
```

### Environment Variables
Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Configure your server-side AI keys and Firebase variables inside `.env.local`:

| Variable | Scope | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | **Server-only** | Primary Google Gemini API key from Google AI Studio. Never exposed to the browser. |
| `GEMINI_MODEL` | **Server-only** | Primary Gemini model identifier (defaults to `gemini-3.5-flash-lite`). |
| `OPENROUTER_API_KEY` | **Server-only** | Fallback OpenRouter API key. Only called if Gemini returns 429/500/503. |
| `OPENROUTER_MODEL` | **Server-only** | Fallback OpenRouter model (defaults to `openrouter/free`). |
| `OPENROUTER_SITE_URL` | **Server-only** | Application URL header for OpenRouter (`http://localhost:3000`). |
| `OPENROUTER_APP_NAME` | **Server-only** | Application title header for OpenRouter (`Exam Revision App`). |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Client | Firebase Web API Key (`memly-bb934` configured). |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Client | Firebase Auth Domain (`memly-bb934.firebaseapp.com`). |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Client | Firebase Project ID (`memly-bb934`). |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Client | Firebase Storage Bucket (`memly-bb934.firebasestorage.app`). |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Client | Firebase Messaging Sender ID. |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Client | Firebase App ID. |
| `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` | Client | Firebase Analytics Measurement ID. |

---

## 3. Shared PDF Extraction & AI Provider Architecture

The application uses a **single shared PDF text extraction pipeline** (`src/lib/pdf/extract-text.ts`) that extracts and normalizes text once per upload before passing the extracted study material to the AI provider system:

```text
PDF Upload → Shared PDF Text Extraction (pdfjs-dist, PAGE 1..N) → AI Service → Gemini (Primary)
                                                                             ↳ OpenRouter (Fallback on 429/503)
```

```
src/lib/
  pdf/
    extract-text.ts    # Shared provider-agnostic PDF text extraction, page markers & chunking
  ai/
    ai-service.ts      # Centralised AI execution service, caching & provider fallback
    gemini.ts          # Primary Google Gemini provider integration
    openrouter.ts      # Secondary OpenRouter fallback provider integration
    prompts.ts         # Shared document-analysis & question-generation prompts
    schemas.ts         # Shared Zod validation schemas
    fallback.ts        # Intelligent error classification (isEligibleForFallback)
```

### When Fallback Triggers (`isEligibleForFallback`)
- **Eligible for OpenRouter Fallback:**
  - HTTP `429` rate limit or daily/monthly quota exhaustion (`RESOURCE_EXHAUSTED`)
  - HTTP `500` / `503` temporary service unavailability or high-demand spikes
  - Transient upstream network timeouts
- **NOT Eligible for Fallback (Reported Directly):**
  - Invalid Gemini API key (`401` / `API_KEY_INVALID`)
  - Malformed request or invalid arguments (`400` / `INVALID_ARGUMENT`)
  - Unsupported model configuration
  - User upload validation failures (`PdfValidationError`, `InsufficientMaterialError`)

### Provider Tracking Metadata (`aiMetadata`)
Every generated deck records which provider served the request:
```json
{
  "primaryProvider": "gemini",
  "actualProvider": "openrouter",
  "model": "openrouter/free",
  "fallbackUsed": true,
  "generatedAt": "2026-11-20T18:00:00.000Z"
}
```

---

## 4. Firebase Setup

1. Your Firebase project (`memly-bb934`) client credentials are configured in `.env.local`.
2. In the [Firebase Console](https://console.firebase.google.com/project/memly-bb934):
   - **Authentication:** Enable **Google** and **Email/Password** sign-in providers.
   - **Cloud Firestore:** Create a Firestore database and deploy the security rules in [`firestore.rules`](./firestore.rules) and composite indexes in [`firestore.indexes.json`](./firestore.indexes.json).
   - **Firebase Storage:** Enable Storage and deploy [`storage.rules`](./storage.rules).

---

## 5. Local Development & Verification Commands

Run the development server:
```bash
npm run dev
```

Run TypeScript type checking:
```bash
npm run typecheck
```

Run automated unit & fallback tests:
```bash
npm test
```

Run production build:
```bash
npm run build
```
