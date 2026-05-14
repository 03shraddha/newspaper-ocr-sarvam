// INTEGRATION: import { sttRouter } from './routes/stt.js'; app.use('/api', sttRouter);

import multer from 'multer';
import { Router } from 'express';
import type { Request, Response } from 'express';

const router = Router();

const STT_ENDPOINT = 'https://api.sarvam.ai/speech-to-text';
const API_KEY = process.env.SARVAM_API_KEY || '';

const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;

const audioUpload = multer({
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'audio/wav',
      'audio/mp3',
      'audio/mpeg',
      'audio/webm',
      'audio/ogg',
      'audio/flac',
      'audio/aac',
      'audio/mp4',
    ];
    if (allowed.includes(file.mimetype) || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error(`Audio file required, got: ${file.mimetype}`));
    }
  },
});

/**
 * Forward audio blob to Sarvam STT API with timeout and retry on transient errors.
 */
async function fetchSTTWithRetry(
  audioBuffer: Buffer,
  mimeType: string,
  languageCode: string,
): Promise<{ transcript: string; language_code: string }> {
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const formData = new FormData();
      const audioBlob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
      const baseType = mimeType.split(';')[0];
      const ext = baseType.includes('ogg') ? 'ogg' : baseType.includes('mp4') ? 'mp4' : baseType.includes('flac') ? 'flac' : baseType.includes('wav') ? 'wav' : baseType.includes('aac') ? 'aac' : baseType.includes('mp3') || baseType.includes('mpeg') ? 'mp3' : 'webm';
      formData.append('file', audioBlob, `recording.${ext}`);
      formData.append('model', 'saaras:v3');
      formData.append('mode', 'transcribe');
      if (languageCode) {
        formData.append('language_code', languageCode);
      }

      const response = await fetch(STT_ENDPOINT, {
        method: 'POST',
        headers: { 'api-subscription-key': API_KEY },
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.ok) {
        const data = await response.json() as {
          transcript?: string;
          language_code?: string;
          language_probability?: number;
          request_id?: string;
        };
        return {
          transcript: data.transcript || '',
          language_code: data.language_code || languageCode,
        };
      }

      // Retry on transient server errors
      if ([502, 503, 504].includes(response.status) && attempt <= MAX_RETRIES) {
        const errText = await response.text().catch(() => '');
        console.warn(`STT: transient ${response.status} on attempt ${attempt}/${MAX_RETRIES}, retrying in ${attempt}s… ${errText.slice(0, 100)}`);
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }

      const errText = await response.text().catch(() => '');
      throw new Error(`STT API error ${response.status}: ${errText.slice(0, 200)}`);
    } catch (err) {
      clearTimeout(timer);
      const isAbort = err instanceof Error && err.name === 'AbortError';
      if (isAbort) {
        if (attempt <= MAX_RETRIES) {
          console.warn(`STT: timeout on attempt ${attempt}/${MAX_RETRIES}, retrying…`);
          await new Promise((r) => setTimeout(r, 1000 * attempt));
          continue;
        }
        throw new Error('STT request timed out after 30s');
      }
      if (attempt > MAX_RETRIES) throw err;
      console.warn(`STT: network error on attempt ${attempt}/${MAX_RETRIES}:`, (err as Error).message);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }

  throw new Error('STT: all retry attempts exhausted');
}

/**
 * POST /api/stt
 * Accepts multipart/form-data with:
 *   - file: audio blob (WAV/webm/etc., max 10MB)
 *   - language_code: optional hint (e.g. "hi-IN") — saaras:v3 auto-detects
 * Returns: { transcript: string, language_code: string }
 *       or { transcript: '', error: string } with status 200 on STT failure (never 500)
 */
router.post('/stt', audioUpload.single('file'), async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'No audio file uploaded', transcript: '' });
    return;
  }

  const languageCode = (req.body?.language_code as string | undefined) || 'hi-IN';

  try {
    const result = await fetchSTTWithRetry(file.buffer, file.mimetype, languageCode);
    res.json({ transcript: result.transcript, language_code: result.language_code });
  } catch (err) {
    // Never crash with 500 — client handles gracefully
    console.error('STT route error:', (err as Error).message);
    res.json({ transcript: '', error: (err as Error).message || 'STT failed' });
  }
});

export { router as sttRouter };
