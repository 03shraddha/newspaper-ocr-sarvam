# Chat with a Regional Newspaper

**An AI-powered newspaper intelligence system for India's 22 official languages.**

Upload a regional newspaper in any Indian language. This app extracts every word, identifies headlines, classifies topics, translates to your chosen language, and lets you have a conversation with the full content — all powered by Sarvam AI's India-native language models.

---

## Why This Exists

India publishes newspapers in 22 official languages across 13 distinct scripts. A farmer in Karnataka reading Kannada Prabha and a policy researcher in Delhi reading the Hindustan Times are consuming the same national story through completely different linguistic lenses. This app bridges that gap: upload any regional newspaper page, and within seconds you can read it in any of India's languages, ask questions about the content, and see headlines organized by topic.

The core technical challenge is building a pipeline that can reliably go from a scanned PDF (often with mixed scripts, complex layouts, and print artifacts) to structured, translated, queryable content — using AI models that actually understand Indian languages natively, not as an afterthought.

---

## AI Pipeline Architecture

The system orchestrates five Sarvam AI models/APIs in sequence. Each stage feeds the next, and the pipeline is designed to degrade gracefully when individual stages produce partial results.

```
                          PDF                        Image
                           |                           |
                           v                           v
               +------------------------+    +------------------+
               | Document Intelligence  |    |   Sarvam Vision  |
               | (sarvam-vision 3B VLM) |    |  (sarvam-vision) |
               | Async job: create ->   |    | extract_as_md    |
               | upload -> process ->   |    | Single-image OCR |
               | download ZIP -> .md    |    +------------------+
               +------------------------+             |
                           |                          |
                           +----------+---------------+
                                      |
                                      v
                            Raw Markdown (OCR output)
                                      |
                      +---------------+---------------+
                      |                               |
                      v                               v
             Structural Parse               AI Headline Extraction
             (regex: #, ##, **)             (sarvam-m 24B chat model)
             Fast, zero-cost                Fallback when <2 headlines
                      |                     found structurally
                      +---------------+---------------+
                                      |
                                      v
                              Headline Objects[]
                                      |
                      +---------------+---------------+
                      |               |               |
                      v               v               v
                Translation     Topic Classify    Chat Context
              (mayura:v1 or     (keyword match    (sarvam-m 24B)
             sarvam-translate    on English text)  Full OCR text
                  :v1)                             in system prompt
                      |               |               |
                      v               v               v
                 Translated      8 Topic Buckets   Conversational
                 Headlines       water | power |   Q&A over the
                 (progressive    farmers | ...     newspaper
                  UI updates)
```

### Stage 1: Document OCR

**For PDFs** — The system uses Sarvam's Document Intelligence API, a purpose-built document processing pipeline that operates on the PDF natively (not rasterized images). This is critical for Indian-language newspapers where complex layouts, mixed scripts, and small print make image-based OCR unreliable.

The Document Intelligence flow is asynchronous and job-based:
1. Create a processing job with language hint and output format
2. Obtain a presigned upload URL and PUT the PDF to cloud storage
3. Start the job and poll for completion (typically 15-60s for a newspaper page)
4. Download the output ZIP containing structured Markdown

**For images** — Single images go through the Vision API directly using the `extract_as_markdown` prompt type, which instructs the 3B VLM to preserve document structure (headings, bold text, columns) in its output.

Both paths produce **Markdown text** that preserves the document's semantic structure — headings become `#`/`##`, emphasis becomes `**bold**`, and the reading order follows column layout.

### Stage 2: Headline Extraction (Dual Strategy)

The system uses a two-tier approach:

**Tier 1 — Structural parsing** (`headlineParser.ts`): Since the OCR output is Markdown, headlines naturally appear as `#` headings or `**bold**` standalone lines. A regex parser extracts these with a minimum length threshold (10 chars) to filter out section labels and photo captions. This is fast, deterministic, and free.

**Tier 2 — AI extraction** (fallback): If structural parsing finds fewer than 2 headlines (common with poorly-formatted scans or non-standard layouts), the system sends the OCR text to `sarvam-m` (24B parameter multilingual chat model) with a carefully constrained prompt that returns a JSON array of headline strings. Temperature is set to 0.1 to minimize hallucination.

### Stage 3: Translation

Headlines are translated **progressively** — one at a time with 150ms delays between API calls. Each translated headline triggers a React state update, so the user sees results streaming in rather than waiting for a batch to complete. This is a deliberate UX choice: for a user scanning a newspaper, seeing the first 3 headlines immediately is more valuable than seeing all 15 after a 10-second wait.

**Model selection** is automatic:
- **mayura:v1** — For the core 11 languages (Hindi, Bengali, Tamil, etc.). Supports 4 translation modes (formal, modern-colloquial, classic-colloquial, code-mixed). 1000 char limit.
- **sarvam-translate:v1** — For extended languages (Assamese, Bodo, Dogri, Kashmiri, etc.). Formal mode only. 2000 char limit.

### Stage 4: Topic Classification

Headlines are classified into 8 categories: Water, Power, Farmers, Politics, Sports, Economy, Education, Health.

Classification uses **keyword matching against English text** — which means the system needs English translations before it can classify. The pipeline handles three cases:

1. **Source is English** — classify directly on original text
2. **Target is English** — classify after translation, reusing the translated text
3. **Neither is English** — perform a separate English translation pass solely for classification, then translate to the actual target language

The keyword classifier (`topicClassifier.ts`) scores each headline against topic-specific word lists. Multi-word matches (e.g., "power cut") score higher than single words. A headline needs at least 1 match point to be classified; unmatched headlines appear as "uncategorized."

### Stage 5: Conversational Q&A

After OCR, the **full extracted text** (not just headlines) is injected into a system prompt for `sarvam-m`. The chat model receives:
- The complete OCR output (up to 24,000 chars)
- A topic index summarizing classified headlines
- Instructions to always respond in the user's target language

This means a user can upload a Kannada newspaper, set the target to Hindi, and ask "What news is important for farmers?" — the model will search through the full Kannada OCR text and respond in Hindi.

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | React 19, Tailwind CSS v4 | Component-driven UI with utility-first styling |
| Backend | Express 5, TypeScript | Thin proxy layer to keep API keys server-side |
| Dev tooling | Vite 7, tsx watch, concurrently | HMR for frontend, auto-reload for backend |
| PDF rendering | pdfjs-dist | Client-side PDF-to-image for previews |
| AI models | Sarvam AI (Vision, Document Intelligence, Translate, Chat) | India-native multilingual models |

### Why Sarvam AI?

Most multilingual AI models treat Indian languages as secondary — trained primarily on English with Indian languages as fine-tuning. Sarvam's models are **India-first**: the `sarvam-m` 24B model and `sarvam-vision` 3B VLM are trained with Indian languages as primary targets. This matters for newspaper OCR where script rendering, conjunct characters (like Kannada ottaksharas or Hindi half-letters), and code-mixed text (English words in Devanagari) are the norm, not edge cases.

---

## Project Structure

```
samachar-scan/
├── server/
│   ├── index.ts                 # Express server — all API routes
│   └── services/
│       └── topicClassifier.ts   # Keyword-based headline topic classification
├── src/
│   ├── App.tsx                  # Main orchestrator — the full processing pipeline
│   ├── components/
│   │   ├── ChatInterface.tsx    # Conversational Q&A with newspaper context
│   │   ├── TopicCards.tsx       # Topic-grouped headline summary cards
│   │   ├── HeadlineList.tsx     # Translated headline list with originals toggle
│   │   ├── HeadlineCard.tsx     # Individual headline with badges and copy
│   │   ├── FileUpload.tsx       # Drag-and-drop PDF/image upload
│   │   ├── LanguageSelector.tsx # Source (auto-detect) + target language pickers
│   │   ├── ProgressSteps.tsx    # 5-stage visual pipeline progress
│   │   ├── ImagePreview.tsx     # PDF page preview thumbnails
│   │   ├── DarkModeToggle.tsx   # Light/dark theme with localStorage
│   │   └── SuccessAnimation.tsx # Completion celebration animation
│   ├── services/
│   │   ├── api.ts               # Frontend API client (all Sarvam endpoints)
│   │   ├── headlineParser.ts    # Markdown → headline extraction (regex)
│   │   └── pdfToImages.ts       # PDF → image blobs via pdfjs-dist
│   ├── lib/
│   │   ├── types.ts             # TypeScript interfaces (Headline, ChatMessage, etc.)
│   │   ├── languages.ts         # All 22 languages with native names + scripts
│   │   └── topics.ts            # Topic metadata, grouping, and summary builders
│   └── index.css                # Tailwind v4 theme — Indian color palette + dark mode
└── vite.config.ts               # Vite + Tailwind plugin + API proxy to Express
```

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

---

## Getting Started

### Prerequisites

- Node.js 18+
- A [Sarvam AI](https://dashboard.sarvam.ai) API key

### Setup

```bash
git clone <repo-url> && cd samachar-scan
npm install
```

Create a `.env` file in the project root:

```env
SARVAM_API_KEY=your_api_key_here
DEMO_MODE=false
PORT=3001
```

### Development

```bash
npm run dev          # Starts Vite (port 5173) + Express (port 3001) concurrently
npm run dev:client   # Frontend only
npm run dev:server   # Backend only
npm run build        # Production build
```

### Demo Mode

Set `DEMO_MODE=true` in `.env` to use mock responses without hitting Sarvam APIs. Useful for UI development and testing.

---

## API Routes

| Method | Route | Purpose | Sarvam Model |
|--------|-------|---------|-------------|
| `POST` | `/api/vision` | Single image OCR | sarvam-vision (Vision API) |
| `POST` | `/api/doc-intelligence` | Full PDF OCR | sarvam-vision (Document Intelligence) |
| `POST` | `/api/translate` | Text translation | mayura:v1 / sarvam-translate:v1 |
| `POST` | `/api/extract-headlines` | AI headline extraction | sarvam-m (Chat API) |
| `POST` | `/api/classify-topics` | Keyword topic classification | N/A (local) |
| `POST` | `/api/chat` | Conversational Q&A | sarvam-m (Chat API) |

---

## Design

The visual identity draws from Indian print culture: terracotta and sandalwood tones, typewriter fonts (Special Elite, Courier Prime) for headings, and ornamental dividers that echo traditional newspaper layouts. A tricolor gradient (saffron-gold-indigo) runs along the header. Dark mode shifts to warm charcoal tones rather than pure black.

All 13 Indic scripts render correctly through system fonts and a dedicated `.font-indic` class that targets Calibri/Segoe UI — fonts with broad Unicode coverage for Indian scripts on Windows.

---

## License

MIT
