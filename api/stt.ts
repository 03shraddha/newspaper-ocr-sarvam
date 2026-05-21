import type { VercelRequest, VercelResponse } from '@vercel/node';
import formidable from 'formidable';
import fs from 'fs';
import { API_KEY } from './_utils.js';

export const config = {
  api: { bodyParser: false },
};

const STT_ENDPOINT = 'https://api.sarvam.ai/speech-to-text';
const MAX_RETRIES = 2;
const TIMEOUT_MS = 30_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let tempPath: string | null = null;
  try {
    const form = formidable({ maxFileSize: 10 * 1024 * 1024 });
    const [fields, files] = await form.parse(req);

    const file = files.file?.[0];
    if (!file) return res.status(400).json({ transcript: '', error: 'No audio file uploaded' });

    tempPath = file.filepath;
    const buffer = fs.readFileSync(file.filepath);
    const mimeType = file.mimetype || 'audio/webm';
    const languageCode = fields.language_code?.[0] || 'hi-IN';

    const baseType = mimeType.split(';')[0];
    const ext =
      baseType.includes('ogg') ? 'ogg' :
      baseType.includes('mp4') ? 'mp4' :
      baseType.includes('flac') ? 'flac' :
      baseType.includes('wav') ? 'wav' :
      baseType.includes('aac') ? 'aac' :
      baseType.includes('mp3') || baseType.includes('mpeg') ? 'mp3' : 'webm';

    let lastErr = 'STT failed';

    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const formData = new FormData();
        const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
        formData.append('file', blob, `recording.${ext}`);
        formData.append('model', 'saaras:v3');
        formData.append('mode', 'transcribe');
        if (languageCode) formData.append('language_code', languageCode);

        const response = await fetch(STT_ENDPOINT, {
          method: 'POST',
          headers: { 'api-subscription-key': API_KEY },
          body: formData,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (response.ok) {
          const data = await response.json() as { transcript?: string; language_code?: string };
          fs.unlinkSync(file.filepath);
          return res.json({ transcript: data.transcript || '', language_code: data.language_code || languageCode });
        }

        if ([502, 503, 504].includes(response.status) && attempt <= MAX_RETRIES) {
          lastErr = `STT API error ${response.status}`;
          await new Promise((r) => setTimeout(r, 1000 * attempt));
          continue;
        }

        const errText = await response.text().catch(() => '');
        lastErr = `STT API error ${response.status}: ${errText.slice(0, 200)}`;
        break;
      } catch (err) {
        clearTimeout(timer);
        const isAbort = err instanceof Error && err.name === 'AbortError';
        if (isAbort && attempt <= MAX_RETRIES) {
          lastErr = 'STT request timed out';
          await new Promise((r) => setTimeout(r, 1000 * attempt));
          continue;
        }
        lastErr = isAbort ? 'STT request timed out after 30s' : (err as Error).message;
        break;
      }
    }

    if (tempPath) fs.unlinkSync(tempPath);
    return res.json({ transcript: '', error: lastErr });
  } catch (err) {
    if (tempPath) try { fs.unlinkSync(tempPath); } catch {}
    console.error('STT handler error:', err);
    return res.json({ transcript: '', error: (err as Error).message || 'STT failed' });
  }
}
