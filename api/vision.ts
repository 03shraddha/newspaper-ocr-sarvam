import type { VercelRequest, VercelResponse } from '@vercel/node';
import formidable from 'formidable';
import fs from 'fs';
import { API_KEY } from './_utils.js';

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const form = formidable({ maxFileSize: 10 * 1024 * 1024 });
    const [fields, files] = await form.parse(req);

    const file = files.file?.[0];
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const sourceLang = fields.language?.[0];
    const buffer = fs.readFileSync(file.filepath);

    // Retry logic mirrors fetchWithRetry in _utils.ts; kept separate because FormData body cannot be reused across attempts
    const MAX_RETRIES = 2;
    let lastError = '';
    let lastStatus = 500;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const formData = new FormData();
      const blob = new Blob([buffer], { type: file.mimetype || 'image/png' });
      formData.append('file', blob, file.originalFilename || 'image.png');
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
        // Clean up temp file
        fs.unlinkSync(file.filepath);
        return res.json({ content: data.content || '', request_id: data.request_id || '' });
      }

      lastStatus = response.status;
      lastError = await response.text();
      console.error(`Vision API error (attempt ${attempt}/${MAX_RETRIES}):`, lastStatus, lastError);

      if (![502, 503, 504].includes(lastStatus) || attempt === MAX_RETRIES) break;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }

    fs.unlinkSync(file.filepath);
    res.status(lastStatus).json({ error: `Vision API error: ${lastStatus}`, detail: lastError });
  } catch (err) {
    console.error('Vision route error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
}
