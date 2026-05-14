// INTEGRATION: import { transliterateRouter } from './routes/transliterate.js'; app.use('/api', transliterateRouter);

import { Router } from 'express';
import type { Request, Response } from 'express';

const router = Router();

const TRANSLITERATE_ENDPOINT = 'https://api.sarvam.ai/transliterate';
const API_KEY = process.env.SARVAM_API_KEY || '';

// All 11 languages supported by Sarvam transliterate API
const SUPPORTED_TRANSLITERATE_LANGS = new Set([
  'en-IN', 'hi-IN', 'bn-IN', 'gu-IN', 'kn-IN',
  'ml-IN', 'mr-IN', 'od-IN', 'pa-IN', 'ta-IN', 'te-IN',
]);

/**
 * Fetch with 8s AbortController timeout + retry on 502/503/504 (max 2 retries).
 * Returns the Response or throws on network error / timeout.
 */
async function fetchTransliterateWithRetry(
  text: string,
  sourceLangCode: string,
  targetLangCode: string,
  maxRetries = 2,
): Promise<string> {
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);

    try {
      const response = await fetch(TRANSLITERATE_ENDPOINT, {
        method: 'POST',
        headers: {
          'api-subscription-key': API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: text,
          source_language_code: sourceLangCode,
          target_language_code: targetLangCode,
          spoken_form: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.ok) {
        const data = await response.json() as {
          transliterated_text?: string;
          source_language_code?: string;
          request_id?: string;
        };
        return data.transliterated_text ?? text;
      }

      // Retry on transient server errors only
      if ([502, 503, 504].includes(response.status) && attempt <= maxRetries) {
        console.warn(`Transliterate: transient ${response.status} on attempt ${attempt}/${maxRetries}, retrying in ${attempt}s…`);
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }

      // Non-retryable HTTP error — log and fall back to original text
      const errText = await response.text().catch(() => '');
      console.error(`Transliterate: non-retryable error ${response.status}:`, errText);
      return text;

    } catch (err) {
      clearTimeout(timer);
      const isAbort = err instanceof Error && err.name === 'AbortError';
      console.error(
        `Transliterate: ${isAbort ? 'timeout' : 'network error'} on attempt ${attempt}:`,
        (err as Error).message,
      );
      if (attempt <= maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }
      return text;
    }
  }

  return text;
}

// POST /api/transliterate-text
// Body: { text: string, source_language_code: string, target_language_code?: string }
// Returns: { transliterated_text: string }
// NEVER returns a 5xx — always 200 (graceful degradation, falls back to original text)
router.post('/transliterate-text', async (req: Request, res: Response) => {
  const { text, source_language_code, target_language_code = 'en-IN' } = req.body as {
    text?: unknown;
    source_language_code?: unknown;
    target_language_code?: unknown;
  };

  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'Missing or empty text field' });
    return;
  }

  if (typeof source_language_code !== 'string' || !source_language_code.trim()) {
    res.status(400).json({ error: 'Missing or empty source_language_code field' });
    return;
  }

  // Passthrough: if source language is not supported by Sarvam transliterate, return original text
  if (!SUPPORTED_TRANSLITERATE_LANGS.has(source_language_code)) {
    res.json({ transliterated_text: text });
    return;
  }

  try {
    const targetLang = typeof target_language_code === 'string' && target_language_code.trim()
      ? target_language_code
      : 'en-IN';

    const transliterated = await fetchTransliterateWithRetry(text, source_language_code, targetLang);
    res.json({ transliterated_text: transliterated });
  } catch (err) {
    // Safety net — must never 500 to client; fall back to original text
    console.error('Transliterate route unexpected error:', err);
    res.json({ transliterated_text: text });
  }
});

export { router as transliterateRouter };
