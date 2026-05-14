// INTEGRATION: import { ttsRouter } from './routes/tts.js'; app.use('/api', ttsRouter);

import { Router } from 'express';
import type { Request, Response } from 'express';

const router = Router();

const TTS_ENDPOINT = 'https://api.sarvam.ai/text-to-speech';
const API_KEY = process.env.SARVAM_API_KEY || '';

// Only these 11 language codes are supported by Sarvam TTS
const TTS_SUPPORTED_LANGS = new Set([
  'hi-IN', 'bn-IN', 'ta-IN', 'te-IN', 'gu-IN',
  'kn-IN', 'ml-IN', 'mr-IN', 'pa-IN', 'od-IN', 'en-IN',
]);

// Speaker defaults per language (bulbul:v3 voices)
const SPEAKER_MAP: Record<string, string> = {
  'hi-IN': 'anushka',
  'en-IN': 'meera',
  'ta-IN': 'pavithra',
  'te-IN': 'hema',
  'bn-IN': 'riya',
  'gu-IN': 'anushka',
  'kn-IN': 'anushka',
  'ml-IN': 'anushka',
  'mr-IN': 'anushka',
  'pa-IN': 'anushka',
  'od-IN': 'anushka',
};

const MAX_TTS_CHARS = 2500;
const TIMEOUT_MS = 15_000;

/**
 * Fetch TTS from Sarvam with AbortController timeout and retry on 502/503/504.
 */
async function fetchTTSWithRetry(
  text: string,
  languageCode: string,
  speaker: string,
  maxRetries = 2,
): Promise<{ audio_base64: string }> {
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(TTS_ENDPOINT, {
        method: 'POST',
        headers: {
          'api-subscription-key': API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: [text],
          target_language_code: languageCode,
          speaker,
          model: 'bulbul:v3',
          speech_sample_rate: 22050,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.ok) {
        const data = await response.json() as { audios?: string[]; request_id?: string };
        const audio = data.audios?.[0];
        if (!audio) throw new Error('No audio returned from TTS API');
        return { audio_base64: audio };
      }

      // Retry on transient server errors
      if ([502, 503, 504].includes(response.status) && attempt <= maxRetries) {
        console.warn(`TTS: transient ${response.status} on attempt ${attempt}/${maxRetries}, retrying in ${attempt}s…`);
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }

      const errText = await response.text().catch(() => '');
      throw new Error(`TTS API error ${response.status}: ${errText.slice(0, 200)}`);

    } catch (err) {
      clearTimeout(timer);
      const isAbort = err instanceof Error && err.name === 'AbortError';
      if (isAbort) {
        if (attempt <= maxRetries) {
          console.warn(`TTS: timeout on attempt ${attempt}/${maxRetries}, retrying…`);
          await new Promise((r) => setTimeout(r, 1000 * attempt));
          continue;
        }
        throw new Error('TTS request timed out after 15s');
      }
      // Re-throw non-abort errors on last attempt
      if (attempt > maxRetries) throw err;
      console.warn(`TTS: network error on attempt ${attempt}/${maxRetries}:`, (err as Error).message);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }

  throw new Error('TTS: all retry attempts exhausted');
}

/**
 * POST /api/tts
 * Body: { text: string, language_code: string, speaker?: string }
 * Returns: { audio_base64: string, content_type: 'audio/wav' }
 *          or { error: string } with status 200 on failure (never 500)
 */
router.post('/tts', async (req: Request, res: Response) => {
  const { text, language_code, speaker } = req.body as {
    text?: unknown;
    language_code?: unknown;
    speaker?: unknown;
  };

  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'Missing or empty text field' });
    return;
  }

  if (typeof language_code !== 'string' || !language_code.trim()) {
    res.status(400).json({ error: 'Missing or empty language_code field' });
    return;
  }

  // Map unsupported languages to en-IN fallback
  const effectiveLang = TTS_SUPPORTED_LANGS.has(language_code) ? language_code : 'en-IN';

  // Determine speaker: use provided speaker, else pick language default
  const effectiveSpeaker =
    (typeof speaker === 'string' && speaker.trim()) ||
    SPEAKER_MAP[effectiveLang] ||
    'anushka';

  // Truncate to API limit
  const truncatedText = text.slice(0, MAX_TTS_CHARS);

  try {
    const result = await fetchTTSWithRetry(truncatedText, effectiveLang, effectiveSpeaker);
    res.json({ audio_base64: result.audio_base64, content_type: 'audio/wav' });
  } catch (err) {
    // Never crash with 500 — client handles gracefully
    console.error('TTS route error:', (err as Error).message);
    res.json({ error: (err as Error).message || 'TTS failed' });
  }
});

export { router as ttsRouter };
