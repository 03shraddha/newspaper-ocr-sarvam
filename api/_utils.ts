// Shared utilities for Vercel serverless functions

export const API_KEY = process.env.SARVAM_API_KEY || '';

// Must stay in sync with EXTENDED_LANGS in src/lib/languages.ts
export const EXTENDED_LANGS = [
  'as-IN', 'brx-IN', 'doi-IN', 'kok-IN', 'ks-IN', 'mai-IN',
  'mni-IN', 'ne-IN', 'sa-IN', 'sat-IN', 'sd-IN', 'ur-IN',
];

export async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 2): Promise<Response> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, options);
    if (response.ok || ![502, 503, 504].includes(response.status) || attempt === maxRetries) {
      return response;
    }
    console.error(`Retrying ${url} (attempt ${attempt}/${maxRetries}): ${response.status}`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
  return fetch(url, options);
}

export async function translateText(input: string, sourceLang: string, targetLang: string): Promise<string> {
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
