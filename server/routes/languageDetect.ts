import { Router } from 'express';
import type { Request, Response } from 'express';

// INTEGRATION REQUIRED in server/index.ts:
//   import { languageDetectRouter } from './routes/languageDetect.js';
//   app.use('/api', languageDetectRouter);   // add before error handler

const router = Router();

const LID_ENDPOINT = 'https://api.sarvam.ai/text-lid';
const API_KEY = process.env.SARVAM_API_KEY || '';

// Exhaustive list of languages supported by Sarvam text-lid
const SUPPORTED_LID_LANGS = new Set([
  'en-IN', 'hi-IN', 'bn-IN', 'gu-IN', 'kn-IN',
  'ml-IN', 'mr-IN', 'od-IN', 'pa-IN', 'ta-IN', 'te-IN',
]);

/**
 * Fetch with AbortController timeout + retry on 502/503/504.
 * Returns the Response (possibly non-ok) or throws on network error / timeout.
 */
async function fetchLidWithRetry(
  text: string,
  maxRetries = 2,
): Promise<{ language_code: string | null; script_code: string | null }> {
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(LID_ENDPOINT, {
        method: 'POST',
        headers: {
          'api-subscription-key': API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ input: text.slice(0, 1000) }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.ok) {
        const data = await response.json() as {
          language_code?: string;
          script_code?: string;
          request_id?: string;
        };
        return {
          language_code: data.language_code ?? null,
          script_code: data.script_code ?? null,
        };
      }

      // Retry on transient server errors only
      if ([502, 503, 504].includes(response.status) && attempt <= maxRetries) {
        console.warn(`LID: transient ${response.status} on attempt ${attempt}/${maxRetries}, retrying in ${attempt}s…`);
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }

      // Non-retryable HTTP error — log and return null
      const errText = await response.text().catch(() => '');
      console.error(`LID: non-retryable error ${response.status}:`, errText);
      return { language_code: null, script_code: null };

    } catch (err) {
      clearTimeout(timer);
      const isAbort = err instanceof Error && err.name === 'AbortError';
      console.error(`LID: ${isAbort ? 'timeout' : 'network error'} on attempt ${attempt}:`, (err as Error).message);
      if (attempt <= maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }
      return { language_code: null, script_code: null };
    }
  }

  return { language_code: null, script_code: null };
}

// POST /api/detect-language
// Body: { text: string }
// Returns: { language_code: "hi-IN", script_code: "Deva" } | { language_code: null }
// NEVER returns a 5xx — always 200 (best-effort feature, graceful degradation)
router.post('/detect-language', async (req: Request, res: Response) => {
  const { text } = req.body as { text?: unknown };

  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'Missing or empty text field' });
    return;
  }

  try {
    const { language_code, script_code } = await fetchLidWithRetry(text);

    // Validate: only return codes we actually support
    if (!language_code || !SUPPORTED_LID_LANGS.has(language_code)) {
      res.json({ language_code: null });
      return;
    }

    res.json({ language_code, script_code: script_code ?? null });
  } catch (err) {
    // Safety net — must never 500 to client
    console.error('LID route unexpected error:', err);
    res.json({ language_code: null });
  }
});

export { router as languageDetectRouter };
