import type { VercelRequest, VercelResponse } from '@vercel/node';
import { translateText } from './_utils.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { input, source_language_code = 'auto', target_language_code } = req.body;
    if (!input || !target_language_code) {
      return res.status(400).json({ error: 'Missing required fields: input and target_language_code' });
    }

    const translated = await translateText(input, source_language_code, target_language_code);
    res.json({ translated_text: translated });
  } catch (err) {
    console.error('Translate error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
}
