# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start both Vite (port 5173) and Express (port 3001) concurrently
npm run dev:client   # Vite frontend only
npm run dev:server   # Express backend only (tsx watch, auto-reload)
npm run build        # tsc -b && vite build → outputs to dist/
```

## Architecture

Full-stack monorepo: React SPA frontend + Express proxy backend, both in one package.

**Backend** (`server/index.ts`): Express server that proxies three Sarvam AI endpoints. Keeps the API key server-side. Routes:
- `POST /api/vision` — multer file upload → forwards to Sarvam Vision API (`extract_as_markdown`)
- `POST /api/translate` — JSON proxy to Sarvam Translate API, auto-selects model (`mayura:v1` for 11 core languages, `sarvam-translate:v1` for 22 extended)
- `POST /api/extract-headlines` — sends OCR text to sarvam-m chat model for AI headline extraction (fallback)

**Frontend** (`src/`): React 19 + Tailwind v4. Single-page app with three states: `upload → processing → results`.

**Processing pipeline** (orchestrated in `App.tsx`):
1. PDF → images via pdfjs-dist (if PDF uploaded, max 5 pages, 2x scale)
2. Each image → Sarvam Vision OCR → markdown text
3. `headlineParser.ts` extracts headlines from markdown (`#`/`##`/`**bold**` lines, min 10 chars)
4. If <2 headlines found → fallback to `/api/extract-headlines` (sarvam-m AI extraction)
5. Headlines translated progressively one-by-one (150ms delay between requests)

**Vite proxy**: `/api/*` requests from the frontend are proxied to `http://localhost:3001` during development.

## Key Patterns

- **Progressive translation**: Headlines are translated sequentially with UI updates per headline via `onProgress` callback in `translateHeadlines()`. This gives users immediate feedback.
- **Demo mode**: Set `DEMO_MODE=true` in `.env` — all API routes return mock Kannada newspaper data without hitting Sarvam APIs.
- **Model auto-selection**: Extended languages (Assamese, Bodo, Dogri, etc.) use `sarvam-translate:v1` (2000 char limit, formal only); core 11 languages use `mayura:v1` (1000 char limit, 4 translation modes).
- **Auth header casing**: Vision API uses `API-Subscription-Key`, Translate/Chat use `api-subscription-key`.

## Environment Variables (`.env`)

```
SARVAM_API_KEY=<key>   # Required for live API calls
DEMO_MODE=false        # Set true for mock responses
PORT=3001              # Express server port
```

## Styling

Tailwind CSS v4 via `@tailwindcss/vite` plugin. Custom theme colors defined in `src/index.css` under `@theme`. Noto Sans Indic font families loaded from Google Fonts for correct rendering of all 22 Indian scripts. Use class `font-indic` for Indic text display.
