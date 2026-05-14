/**
 * useLanguageDetect — best-effort Language ID hook.
 *
 * Exports a single async function `detectLanguage(text)` that calls the
 * backend /api/detect-language endpoint. Never throws; returns null on any
 * failure so the rest of the app continues unaffected.
 */

const TIMEOUT_MS = 6_000;

export function useLanguageDetect() {
  /**
   * Detect the language of the given text snippet.
   * Returns a BCP-47 language code (e.g. "hi-IN") or null if detection
   * fails, times out, or returns an unsupported language.
   */
  async function detectLanguage(text: string): Promise<string | null> {
    if (!text || !text.trim()) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch('/api/detect-language', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) return null;

      const data = await response.json() as { language_code?: string | null };
      return data.language_code ?? null;
    } catch {
      // Covers AbortError (timeout), network errors, JSON parse failures
      clearTimeout(timer);
      return null;
    }
  }

  return { detectLanguage };
}
