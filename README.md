# Chat with Regional News

**An AI-powered news intelligence system for India's 22 official languages.**

Upload regional news in any Indian language — as a PDF, image, or audio recording. The app extracts every word, identifies headlines, auto-detects the source language, translates to your chosen language, classifies stories by topic, and lets you have a full conversation with the content — all through Sarvam AI's India-native language stack.

---

## Who This Is For

- **Researchers & journalists** tracking news across Indian language regions
- **NRIs & diaspora** staying connected to hometown regional press
- **Policy makers & NGOs** needing multilingual news intelligence
- **Educators** teaching media literacy across language barriers
- **Developers** exploring India-native AI APIs end-to-end

---

## Why This Exists

India publishes news in 22 official languages across 13 distinct scripts. A farmer in Karnataka reading *Kannada Prabha* and a policy researcher in Delhi reading the *Hindustan Times* are consuming the same national story through completely different linguistic lenses. This app bridges that gap: upload any regional news page, and within seconds you can read it in any Indian language, ask questions about the content, hear headlines read aloud, and speak your questions instead of typing them.

The core technical challenge is building a pipeline that can reliably go from a scanned PDF (often with mixed scripts, complex layouts, and print artifacts) to structured, translated, queryable, voice-accessible content — using AI models that understand Indian languages natively, not as an afterthought.

---

## How It Works — Full Architecture

The system uses **every Sarvam AI API** across three layers: ingestion, processing, and interaction. Here is the complete data flow.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                  INPUT                                        │
├───────────────────┬──────────────────┬─────────────────┬─────────────────────┤
│   PDF / Image     │   Long Audio     │  Short Mic Clip │     Live Mic        │
│                   │   (up to 60 min) │  (up to 30s)    │                     │
│ Sarvam Vision /   │  STT Batch API   │  STT REST API   │  STT WebSocket      │
│ Doc Intelligence  │  saaras:v3       │  saaras:v3      │  saaras:v3          │
│ sarvam-vision 3B  │  async: create   │  POST audio →   │  PCM 16kHz chunks   │
│ sync POST or      │  → upload →      │  transcript     │  → base64 JSON      │
│ async job → ZIP   │  start → poll    │                 │  → live text        │
│ → markdown        │  → transcript    │                 │                     │
└─────────┬─────────┴────────┬─────────┴────────┬────────┴──────────┬──────────┘
          │                  │                  │                   │
          └──────────────────┴──────────────────┘                   │
                             │                                       │
                             ▼                              fills chat input
                       ┌───────────┐                        from transcript
                       │ Raw Text  │
                       └─────┬─────┘
                             │
┌────────────────────────────▼────────────────────────────────────────────────┐
│                            PROCESSING                                         │
│                                                                               │
│  1. Detect language    text-lid API — runs in parallel, never blocks OCR     │
│                                                                               │
│  2. Extract headlines  regex on #/## markdown headings (< 1ms, zero cost)   │
│                        → if fewer than 2 found: sarvam-30b AI fallback       │
│                                                                               │
│  3. Classify topics    keyword scoring → 8 buckets                           │
│                        Politics · Economy · Farmers · Sports · Health…       │
│                                                                               │
│  4. Translate          mayura:v1 for 11 core langs                           │
│                        sarvam-translate:v1 for all 22 langs                  │
│                        4 concurrent requests · each result streams to UI     │
│                                                                               │
│  5. Build chat context full OCR text (≤10k chars) + topic index injected    │
│                        into sarvam-105b system prompt · last 10 turns kept  │
└────────────────────────────┬────────────────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────────────────┐
│                             OUTPUT                                             │
├──────────────────────┬──────────────────────┬───────────────────────────────┤
│    Headlines Tab     │     Topics Tab        │          Chat Tab             │
│                      │                       │                               │
│  Translated          │  8 category cards     │  Q&A over full OCR text      │
│  headlines with      │  with story counts    │  sarvam-105b · 128k context  │
│  topic badges        │  and summaries        │  responds in target language  │
│                      │                       │                               │
│  🔊 TTS button       │  Download Tab         │  🎤 Mic button → STT REST    │
│  bulbul:v3 · 11 langs│  Doc Translate API    │  ⚡ Live voice → STT Stream  │
│  en-IN fallback      │  → full translated    │  🔊 Speaker on each response │
│                      │  PDF streamed to      │  auto-speak toggle           │
│  Aa/अ Transliterate  │  browser              │                               │
│  native → Roman      │                       │                               │
│  in-memory cache     │                       │                               │
└──────────────────────┴──────────────────────┴───────────────────────────────┘
```

---

## All Sarvam AI APIs Used

| API | Endpoint | Model | Used For |
|-----|----------|-------|----------|
| Document Intelligence | `POST /doc-digitization/job/v1` | sarvam-vision 3B VLM | Async PDF OCR — async job, ZIP output |
| Vision | `POST /vision` | sarvam-vision 3B VLM | Single-image OCR, `extract_as_markdown` |
| Language Identification | `POST /text-lid` | — | Auto-detect source language from OCR text |
| Chat Completions | `POST /v1/chat/completions` | sarvam-30b | Headline extraction fallback (fast, cheap) |
| Chat Completions | `POST /v1/chat/completions` | sarvam-105b | Conversational Q&A over news content |
| Translate | `POST /translate` | mayura:v1 | Translation for 11 core Indian languages |
| Translate | `POST /translate` | sarvam-translate:v1 | Translation for all 22 Indian languages |
| Transliterate | `POST /transliterate` | — | Native script → Roman toggle on headlines |
| Text-to-Speech | `POST /text-to-speech` | bulbul:v3 | Read headlines and chat responses aloud |
| Speech-to-Text (REST) | `POST /speech-to-text` | saaras:v3 | Mic button → transcript in chat input |
| Speech-to-Text (WebSocket) | `WSS /speech-to-text/ws` | saaras:v3 | Live streaming transcription panel |
| Speech-to-Text (Batch) | `POST /speech-to-text/job/v1` | saaras:v3 | Long audio upload (podcasts, radio, up to 60 min) |
| Doc Translate | `POST /parse/translatepdf` | — | Download full translated PDF of the uploaded content |

---

## Project Structure

```
newspaper-ocr/
│
├── server/
│   ├── index.ts                     # Express server — existing core routes
│   ├── routes/                      # New Sarvam API route modules
│   │   ├── languageDetect.ts        # POST /api/detect-language   (text-lid)
│   │   ├── transliterate.ts         # POST /api/transliterate-text
│   │   ├── tts.ts                   # POST /api/tts               (bulbul:v3)
│   │   ├── stt.ts                   # POST /api/stt               (saaras:v3 REST)
│   │   ├── sttStream.ts             # WS   /ws/stt                (saaras:v3 stream proxy)
│   │   ├── sttBatch.ts              # POST /api/stt-batch[-status](saaras:v3 batch)
│   │   └── docTranslate.ts          # POST /api/doc-translate     (translatepdf)
│   └── services/
│       ├── topicClassifier.ts       # Keyword-based 8-topic classification
│       └── ranker.ts                # Headline importance scoring
│
├── src/
│   ├── App.tsx                      # Pipeline orchestrator — all 6 processing stages
│   ├── components/
│   │   ├── ChatInterface.tsx        # Q&A chat, mic button, live voice panel trigger, TTS
│   │   ├── LiveVoicePanel.tsx       # Floating streaming STT overlay
│   │   ├── HeadlineCard.tsx         # Headline + TTS button + Aa/अ transliteration toggle
│   │   ├── HeadlineList.tsx         # Headline list + topic filter chips + PDF download
│   │   ├── FileUpload.tsx           # Drag-and-drop: PDF / Image / Audio (MP3, WAV)
│   │   ├── LanguageSelector.tsx     # Source (auto-detect + badge) + target pickers
│   │   ├── TopicCards.tsx           # 8 topic cards with grouped headline summaries
│   │   ├── ProgressSteps.tsx        # 6-stage visual pipeline progress bar
│   │   ├── ImagePreview.tsx         # PDF page thumbnails
│   │   ├── DarkModeToggle.tsx       # Light / dark theme
│   │   └── SuccessAnimation.tsx     # Completion animation
│   ├── hooks/                       # React hooks — one per new Sarvam API
│   │   ├── useLanguageDetect.ts     # Fires LID in parallel, never blocks pipeline
│   │   ├── useTransliterate.ts      # In-memory cache, 8s timeout, graceful passthrough
│   │   ├── useTTS.ts                # Blob URL playback, toggle-to-stop, speakingId state
│   │   ├── useTTSChat.ts            # Chat TTS with auto-speak toggle
│   │   ├── useSTT.ts                # MediaRecorder → REST transcription
│   │   ├── useSTTStream.ts          # AudioContext PCM → WebSocket proxy → live transcript
│   │   └── useDocTranslate.ts       # PDF translation with progress updates
│   ├── services/
│   │   ├── api.ts                   # Frontend API client — all core endpoints
│   │   ├── audioApi.ts              # Batch STT upload + polling (same pattern as PDF OCR)
│   │   ├── headlineParser.ts        # Regex Markdown → headlines (Tier 1)
│   │   └── pdfToImages.ts           # PDF → image blobs via pdfjs-dist (preview only)
│   └── lib/
│       ├── types.ts                 # TypeScript interfaces
│       ├── languages.ts             # 23 languages with native names + scripts
│       └── topics.ts                # Topic metadata, grouping, summary builders
│
├── tests/
│   ├── unit.test.ts                 # headlineParser + topicClassifier (pure logic)
│   └── server.test.ts               # All 12 API route groups, 80 tests, fetch mocked
│
└── vite.config.ts                   # Vite + Tailwind + proxy (/api → :3001, /ws → :3001)
```

---

## Performance Design

Every Sarvam API call in this app follows the same contract: **the UI is never blocked waiting for a network response**.

| Technique | Where used |
|-----------|-----------|
| Fire-and-forget parallel call | Language ID runs alongside OCR, not after it |
| Progressive state updates | Each translated headline pushed to UI as soon as its Promise resolves |
| Batch concurrency (4 at a time) | Headline translation — 4 parallel requests, not sequential |
| Optimistic UI state | TTS `speakingId` set before fetch starts — button reacts instantly |
| Blob URL audio playback | TTS audio decoded in memory, no disk write, URL revoked after `ended` |
| In-memory cache | Transliteration results cached per `${lang}:${text}` — no repeat API calls |
| AbortController timeouts | Every API call: LID 10s, Transliterate 8s, TTS 15s, STT 25s, Doc Translate 120s |
| Never-500 contract | All new routes return HTTP 200 with `{ error }` in body — client never crashes |
| Retry on transient errors | 2 retries with backoff on 502/503/504 for every Sarvam API call |
| Streaming WebSocket audio | STT streaming sends 256ms PCM chunks (4096 samples at 16kHz) — low latency |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Tailwind CSS v4 |
| Backend | Express 5, TypeScript |
| Dev tooling | Vite 7, tsx watch, concurrently |
| PDF rendering | pdfjs-dist (client-side, preview only) |
| WebSocket | ws (server-side proxy for streaming STT) |
| AI models | All Sarvam AI APIs (see table above) |
| Tests | Vitest + Supertest — 80 tests, fetch fully mocked |
| Deployment | Vercel (serverless `/api` routes + static frontend) |

---

## Supported Languages

All 22 languages in the Eighth Schedule of the Indian Constitution, plus English:

| Language | Script | Code | Language | Script | Code |
|----------|--------|------|----------|--------|------|
| Hindi | देवनागरी | `hi-IN` | Assamese | অসমীয়া | `as-IN` |
| Bengali | বাংলা | `bn-IN` | Urdu | اردو | `ur-IN` |
| Tamil | தமிழ் | `ta-IN` | Sanskrit | संस्कृतम् | `sa-IN` |
| Telugu | తెలుగు | `te-IN` | Nepali | नेपाली | `ne-IN` |
| Marathi | मराठी | `mr-IN` | Dogri | डोगरी | `doi-IN` |
| Gujarati | ગુજરાતી | `gu-IN` | Bodo | बड़ो | `brx-IN` |
| Kannada | ಕನ್ನಡ | `kn-IN` | Konkani | कोंकणी | `kok-IN` |
| Malayalam | മലയാളം | `ml-IN` | Maithili | मैथिली | `mai-IN` |
| Punjabi | ਪੰਜਾਬੀ | `pa-IN` | Sindhi | سنڌي | `sd-IN` |
| Odia | ଓଡ଼ିଆ | `od-IN` | Kashmiri | कॉशुर | `ks-IN` |
| English | Latin | `en-IN` | Manipuri | মণিপুরী | `mni-IN` |
| | | | Santali | ᱥᱟᱱᱛᱟᱲᱤ | `sat-IN` |

> **TTS and Transliteration** support 11 of the above languages. Unsupported languages fall back to English for TTS, and pass text through unchanged for transliteration.

---

## Getting Started

### Prerequisites

- Node.js 18+
- A [Sarvam AI](https://dashboard.sarvam.ai) API key (free credits on signup)

### Setup

```bash
git clone https://github.com/03shraddha/newspaper-ocr-sarvam
cd newspaper-ocr-sarvam
npm install
```

Create a `.env` file in the project root:

```env
SARVAM_API_KEY=your_key_here
DEMO_MODE=false
PORT=3001
```

### Development

```bash
npm run dev          # Starts Vite (port 5173) + Express (port 3001) concurrently
npm run dev:client   # Frontend only
npm run dev:server   # Backend only (tsx watch, auto-reload)
npm run build        # TypeScript compile + Vite production build
npm run test         # 80 unit + server tests (no network, fetch fully mocked)
```

### Demo Mode

Set `DEMO_MODE=true` in `.env` to use mock responses without hitting any Sarvam API. Useful for frontend iteration without spending API credits.

---

## Design

The visual identity draws from Indian print culture: terracotta and sandalwood tones, typewriter fonts (Special Elite, Courier Prime) for headings, and ornamental dividers that echo traditional news layouts. A tricolor gradient (saffron → gold → indigo) runs along the header border. Dark mode shifts to warm charcoal tones rather than pure black.

All 13 Indic scripts render correctly through system fonts and a dedicated `.font-indic` class targeting fonts with broad Unicode coverage for Indian scripts.

---

## License

MIT
