/**
 * useTransliterate — React hook for on-demand transliteration via /api/transliterate-text.
 *
 * Features:
 * - In-memory cache keyed by `${sourceLang}:${text}` — no repeat API calls for same text
 * - 8s AbortController timeout per request
 * - Graceful fallback: returns original text on any error (never throws to caller)
 */

import { useRef, useCallback } from 'react';

// Module-level cache persists across component mounts (intentional — same session, same results)
const transliterateCache = new Map<string, string>();

export function useTransliterate() {
  // Keep a ref to the latest in-flight controller so we can cancel on unmount if needed
  const controllerRef = useRef<AbortController | null>(null);

  const transliterateText = useCallback(
    async (text: string, sourceLang: string): Promise<string> => {
      if (!text.trim()) return text;

      const cacheKey = `${sourceLang}:${text}`;

      // Return cached result immediately — no API call needed
      const cached = transliterateCache.get(cacheKey);
      if (cached !== undefined) return cached;

      const controller = new AbortController();
      controllerRef.current = controller;
      const timer = setTimeout(() => controller.abort(), 8_000);

      try {
        const response = await fetch('/api/transliterate-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            source_language_code: sourceLang,
            target_language_code: 'en-IN',
          }),
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!response.ok) {
          console.warn(`Transliterate API returned ${response.status} — falling back to original text`);
          return text;
        }

        const data = await response.json() as { transliterated_text?: string };
        const result = data.transliterated_text ?? text;

        // Cache the result for this session
        transliterateCache.set(cacheKey, result);
        return result;

      } catch (err) {
        clearTimeout(timer);
        const isAbort = err instanceof Error && err.name === 'AbortError';
        console.warn(
          `Transliterate: ${isAbort ? 'request timed out' : 'network error'} — falling back to original text`,
        );
        return text;
      }
    },
    [],
  );

  return { transliterateText };
}
