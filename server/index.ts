import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';
import { transliterateRouter } from './routes/transliterate.js';
import { languageDetectRouter } from './routes/languageDetect.js';
import { attachSTTStreamServer } from './routes/sttStream.js';
import { docTranslateRouter } from './routes/docTranslate.js';
import { sttBatchRouter } from './routes/sttBatch.js';
import { ttsRouter } from './routes/tts.js';
import { sttRouter } from './routes/stt.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3001;
const API_KEY = process.env.SARVAM_API_KEY || '';

app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174'] }));
app.use(express.json({ limit: '50mb' }));

const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/jpg'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${file.mimetype}`));
  },
});

// ─── Translation helper (reused by ingestion + API) ───
const EXTENDED_LANGS = ['as-IN','brx-IN','doi-IN','kok-IN','ks-IN','mai-IN','mni-IN','ne-IN','sa-IN','sat-IN','sd-IN','ur-IN'];

// ─── Retry helper for transient API errors ───
async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 2): Promise<Response> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, options);
    if (response.ok || ![502, 503, 504].includes(response.status) || attempt === maxRetries) {
      return response;
    }
    console.error(`Retrying ${url} (attempt ${attempt}/${maxRetries}): ${response.status}`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
  return fetch(url, options); // unreachable, satisfies TS
}

async function translateText(input: string, sourceLang: string, targetLang: string): Promise<string> {
  const needsExtended = EXTENDED_LANGS.includes(sourceLang) || EXTENDED_LANGS.includes(targetLang);
  const model = needsExtended ? 'sarvam-translate:v1' : 'mayura:v1';
  const charLimit = model === 'mayura:v1' ? 1000 : 2000;

  const response = await fetchWithRetry('https://api.sarvam.ai/translate', {
    method: 'POST',
    headers: { 'api-subscription-key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: input.slice(0, charLimit),
      source_language_code: sourceLang,
      target_language_code: targetLang,
      model,
      mode: 'formal',
    }),
  });

  if (!response.ok) throw new Error(`Translation failed: ${response.status}`);
  const data = await response.json() as any;
  return data.translated_text || '';
}

// ════════════════════════════════════════════════════
// EXISTING ROUTES (Manual Scan Mode)
// ════════════════════════════════════════════════════

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', hasApiKey: !!API_KEY });
});

// POST /api/vision — OCR image via Sarvam Vision (retries on 502/503)
app.post('/api/vision', upload.single('file'), async (req: express.Request, res: express.Response) => {
  try {
    const file = req.file;
    if (!file) { res.status(400).json({ error: 'No file uploaded' }); return; }

    // Language hint from client improves OCR for specific Indian scripts
    const sourceLang = req.body?.language;
    const MAX_RETRIES = 3;
    let lastError = '';
    let lastStatus = 500;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const formData = new FormData();
      const fileBlob = new Blob([new Uint8Array(file.buffer)], { type: file.mimetype });
      formData.append('file', fileBlob, file.originalname);
      formData.append('prompt_type', 'extract_as_markdown');
      if (sourceLang && sourceLang !== 'auto') {
        formData.append('language', sourceLang);
      }

      const response = await fetch('https://api.sarvam.ai/vision', {
        method: 'POST',
        headers: { 'API-Subscription-Key': API_KEY },
        body: formData,
      });

      if (response.ok) {
        const data = await response.json() as any;
        res.json({ content: data.content || '', request_id: data.request_id || '' });
        return;
      }

      lastStatus = response.status;
      lastError = await response.text();
      console.error(`Vision API error (attempt ${attempt}/${MAX_RETRIES}):`, lastStatus, lastError);

      // Only retry on 502/503/504 (server-side transient errors)
      if (![502, 503, 504].includes(lastStatus) || attempt === MAX_RETRIES) break;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }

    res.status(lastStatus).json({ error: `Vision API error: ${lastStatus}`, detail: lastError });
  } catch (err) {
    console.error('Vision route error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ════════════════════════════════════════════════════
// DOCUMENT INTELLIGENCE — Full PDF OCR via Sarvam Document Intelligence API
// ════════════════════════════════════════════════════

const pdfUpload = multer({
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error(`Expected PDF, got: ${file.mimetype}`));
  },
});

const DOC_INTEL_BASE = 'https://api.sarvam.ai/doc-digitization/job/v1';

// POST /api/doc-intelligence — Upload PDF, create job, start, return jobId
app.post('/api/doc-intelligence', (req, res, next) => { req.setTimeout(300_000); res.setTimeout(300_000); next(); }, pdfUpload.single('file'), async (req: express.Request, res: express.Response) => {
  try {
    const file = req.file;
    if (!file) { res.status(400).json({ error: 'No PDF uploaded' }); return; }

    const sourceLang = req.body?.language || 'hi-IN';
    const lang = sourceLang === 'auto' ? 'hi-IN' : sourceLang;

    // Create job
    const createRes = await fetch(DOC_INTEL_BASE, {
      method: 'POST',
      headers: { 'api-subscription-key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_parameters: { language: lang, output_format: 'md' } }),
    });
    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error('Doc Intel create error:', createRes.status, errText);
      res.status(createRes.status).json({ error: `Failed to create job: ${createRes.status}` });
      return;
    }
    const jobData = await createRes.json() as any;
    const jobId = jobData.job_id;
    console.log(`Doc Intel job created: ${jobId}`);

    // Get upload URL
    const uploadUrlRes = await fetch(`${DOC_INTEL_BASE}/upload-files`, {
      method: 'POST',
      headers: { 'api-subscription-key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId, files: [file.originalname || 'document.pdf'] }),
    });
    if (!uploadUrlRes.ok) {
      res.status(500).json({ error: 'Failed to get upload URL' });
      return;
    }
    const uploadUrlData = await uploadUrlRes.json() as any;
    const fileName = Object.keys(uploadUrlData.upload_urls || {})[0];
    const presignedUrl = uploadUrlData.upload_urls?.[fileName]?.file_url;
    if (!presignedUrl) {
      res.status(500).json({ error: 'No presigned URL returned' });
      return;
    }

    // Upload PDF
    const uploadRes = await fetch(presignedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf', 'x-ms-blob-type': 'BlockBlob' },
      body: new Uint8Array(file.buffer),
    });
    if (!uploadRes.ok) {
      const errText = await uploadRes.text().catch(() => '');
      console.error('Doc Intel file upload error:', uploadRes.status, errText);
      res.status(500).json({ error: 'Failed to upload PDF' });
      return;
    }

    // Start job
    const startRes = await fetch(`${DOC_INTEL_BASE}/${jobId}/start`, {
      method: 'POST',
      headers: { 'api-subscription-key': API_KEY },
    });
    if (!startRes.ok) {
      res.status(500).json({ error: 'Failed to start processing' });
      return;
    }

    console.log(`Doc Intel job ${jobId} uploaded and started`);
    res.json({ jobId });
  } catch (err) {
    console.error('Doc Intelligence route error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/doc-status — Check job status; if done, download and return markdown
app.post('/api/doc-status', async (req: express.Request, res: express.Response) => {
  try {
    const { jobId } = req.body;
    if (!jobId) { res.status(400).json({ error: 'Missing jobId' }); return; }

    const statusRes = await fetch(`${DOC_INTEL_BASE}/${jobId}/status`, {
      method: 'GET',
      headers: { 'api-subscription-key': API_KEY },
    });
    if (!statusRes.ok) {
      res.status(500).json({ error: 'Failed to check job status' });
      return;
    }

    const statusData = await statusRes.json() as any;
    const jobState = statusData.job_state;

    if (['Accepted', 'Pending', 'Running'].includes(jobState)) {
      res.json({ state: jobState });
      return;
    }

    if (jobState === 'Failed') {
      res.json({ state: 'Failed', error: 'Document processing failed' });
      return;
    }

    // Completed — download and extract
    const dlRes = await fetch(`${DOC_INTEL_BASE}/${jobId}/download-files`, {
      method: 'POST',
      headers: { 'api-subscription-key': API_KEY },
    });
    if (!dlRes.ok) {
      res.status(500).json({ error: 'Failed to get download URL' });
      return;
    }
    const dlData = await dlRes.json() as any;
    const dlFileName = Object.keys(dlData.download_urls || {})[0];
    const downloadUrl = dlData.download_urls?.[dlFileName]?.file_url;
    if (!downloadUrl) {
      res.status(500).json({ error: 'No download URL returned' });
      return;
    }

    const zipRes = await fetch(downloadUrl);
    if (!zipRes.ok) {
      res.status(500).json({ error: 'Failed to download output' });
      return;
    }
    const zipBuffer = Buffer.from(await zipRes.arrayBuffer());
    const zip = new AdmZip(zipBuffer);

    let markdown = '';
    for (const entry of zip.getEntries()) {
      if (entry.entryName.endsWith('.md')) {
        markdown += entry.getData().toString('utf-8') + '\n\n';
      }
    }

    if (!markdown.trim()) {
      res.status(500).json({ error: 'No content extracted from PDF' });
      return;
    }

    // Strip base64-embedded images from markdown — they bloat context and are useless for text chat
    const cleanMarkdown = markdown
      .replace(/!\[[^\]]*\]\(data:[^)]+\)/g, '')   // ![alt](data:image/...base64...)
      .replace(/\[.*?\]:\s*data:[^\s]+/g, '')       // [ref]: data:image/...
      .replace(/\n{3,}/g, '\n\n')                    // collapse excess blank lines
      .trim();

    console.log(`Doc Intel ${jobId} done — extracted ${markdown.length} chars, cleaned to ${cleanMarkdown.length} chars`);
    res.json({ state: jobState, content: cleanMarkdown, request_id: jobId });
  } catch (err) {
    console.error('Doc status route error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/translate — Translate text
app.post('/api/translate', async (req: express.Request, res: express.Response) => {
  try {
    const { input, source_language_code = 'auto', target_language_code } = req.body;

    if (!input || !target_language_code) {
      res.status(400).json({ error: 'Missing required fields: input and target_language_code' });
      return;
    }

    const translated = await translateText(input, source_language_code, target_language_code);
    res.json({ translated_text: translated });
  } catch (err) {
    console.error('Translate route error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/extract-headlines — AI headline extraction (fallback)
app.post('/api/extract-headlines', async (req: express.Request, res: express.Response) => {
  try {
    const { ocrText } = req.body;
    if (!ocrText) { res.status(400).json({ error: 'Missing ocrText' }); return; }

    const payload = {
      // sarvam-30b: sufficient for structured headline extraction (105b reserved for Q&A)
      model: 'sarvam-30b',
      messages: [
        {
          role: 'system',
          content: 'You are a newspaper headline extraction assistant. Given OCR text from a newspaper, extract ONLY the news headlines. Do NOT include section labels, photo captions, or body text. Return a JSON array of headline strings. Return ONLY the JSON array.'
        },
        {
          role: 'user',
          content: `Extract headlines from this newspaper OCR text:\n\n${ocrText.slice(0, 8000)}`
        }
      ],
      temperature: 0.1,
      max_tokens: 2000,
    };

    const response = await fetchWithRetry('https://api.sarvam.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'api-subscription-key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Chat API error:', response.status, errText);
      res.status(response.status).json({ error: `Chat API error: ${response.status}` });
      return;
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content || '[]';

    let headlines: string[] = [];
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON array in response');
      headlines = JSON.parse(jsonMatch[0]);
    } catch {
      headlines = content.split('\n').map((l: string) => l.replace(/^[-*\d.]+\s*/, '').trim()).filter((l: string) => l.length > 10);
    }

    res.json({ headlines });
  } catch (err) {
    console.error('Extract-headlines route error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ════════════════════════════════════════════════════
// CLASSIFY TOPICS — Keyword-based topic classification
// ════════════════════════════════════════════════════

import { classifyTopic } from './services/topicClassifier.js';

// ════════════════════════════════════════════════════
// TTS ROUTE — Text-to-speech via Sarvam Bulbul v3
// ════════════════════════════════════════════════════

app.use('/api', ttsRouter);

// ════════════════════════════════════════════════════
// STT ROUTE — Speech-to-text via Sarvam saaras:v3
// ════════════════════════════════════════════════════

app.use('/api', sttRouter);

app.post('/api/classify-topics', (req: express.Request, res: express.Response) => {
  try {
    const { headlines } = req.body;
    if (!Array.isArray(headlines)) {
      res.status(400).json({ error: 'Missing headlines array' });
      return;
    }

    const classifications = headlines.map((h: { id: string; englishText: string }) => ({
      id: h.id,
      topic: classifyTopic(h.englishText || ''),
    }));

    res.json({ classifications });
  } catch (err) {
    console.error('Classify-topics route error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ════════════════════════════════════════════════════
// CHAT ROUTE — Conversational Q&A over newspaper content
// ════════════════════════════════════════════════════

app.post('/api/chat', async (req: express.Request, res: express.Response) => {
  try {
    const { messages, newspaperContext, targetLang, topicSummary } = req.body;

    if (!messages?.length) {
      res.status(400).json({ error: 'Missing messages' });
      return;
    }

    // Map language code to name for the prompt
    const LANG_NAMES: Record<string, string> = {
      'hi-IN': 'Hindi', 'en-IN': 'English', 'bn-IN': 'Bengali', 'ta-IN': 'Tamil',
      'te-IN': 'Telugu', 'mr-IN': 'Marathi', 'gu-IN': 'Gujarati', 'kn-IN': 'Kannada',
      'ml-IN': 'Malayalam', 'pa-IN': 'Punjabi', 'od-IN': 'Odia', 'as-IN': 'Assamese',
      'ur-IN': 'Urdu', 'sa-IN': 'Sanskrit', 'ne-IN': 'Nepali', 'doi-IN': 'Dogri',
      'brx-IN': 'Bodo', 'kok-IN': 'Konkani', 'mai-IN': 'Maithili', 'sd-IN': 'Sindhi',
      'ks-IN': 'Kashmiri', 'mni-IN': 'Manipuri', 'sat-IN': 'Santali',
    };
    const langName = LANG_NAMES[targetLang] || 'English';

    const topicSection = topicSummary
      ? `\n\n--- TOPIC INDEX ---\nThe following topics were identified in this newspaper. Use this to quickly locate relevant content when the user asks about a specific topic:\n${topicSummary}\n--- END TOPIC INDEX ---`
      : '';

    const systemPrompt = `You are a helpful Indian news analysis assistant called "Chat with Regional News". The user has uploaded news content and you have the full OCR-extracted text below. Answer the user's questions about the news content — find relevant articles, summarize topics, explain what matters for farmers/students/businesses/etc.

Rules:
- ALWAYS respond in ${langName}, regardless of what language the user asks in.
- You have the FULL newspaper text, not just headlines. Use all of it to answer questions thoroughly.
- When listing headlines or articles, use numbered lists.
- Be specific — quote actual text from the newspaper.
- If the user asks about a topic not covered in the newspaper, say so honestly.
- Keep answers concise but informative.
- When the user asks about a specific topic (water, farmers, politics, sports, etc.), refer to the TOPIC INDEX below for relevant headlines, then search the full text for details.
${topicSection}

═══ NEWSPAPER OCR TEXT ═══
${(newspaperContext || '').replace(/!\[[^\]]*\]\(data:[^)]+\)/g, '').replace(/\n{3,}/g, '\n\n').slice(0, 10000)}
═══ END ═══`;

    const payload = {
      // sarvam-105b: high-quality reasoning needed for open-ended Q&A
      model: 'sarvam-105b',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.slice(-10),
      ],
      temperature: 0.3,
      max_tokens: 2000,
    };

    const response = await fetchWithRetry('https://api.sarvam.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'api-subscription-key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Chat API error:', response.status, errText);
      res.status(response.status).json({ error: `Chat API error: ${response.status}` });
      return;
    }

    const data = await response.json() as any;
    const reply = data.choices?.[0]?.message?.content || 'Sorry, I could not generate a response.';

    res.json({ reply });
  } catch (err) {
    console.error('Chat route error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── Transliterate router ───
app.use('/api', transliterateRouter);

// ─── Language detect router ───
app.use('/api', languageDetectRouter);

// ─── Doc Translate router — full PDF translation via Sarvam translatepdf ───
app.use('/api', docTranslateRouter);

// ─── STT Batch router — async audio transcription via Sarvam batch STT API ───
app.use('/api', sttBatchRouter);

// ─── Error handler ───
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Server error:', err.message);
  res.status(500).json({ error: err.message });
});

export { app };

// Only start listening when run directly (not when imported by tests)
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMain || process.env.NODE_ENV !== 'test') {
  const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`API key: ${API_KEY ? 'configured' : 'MISSING'}`);
  });
  attachSTTStreamServer(server);
}
