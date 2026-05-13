import type { VercelRequest, VercelResponse } from '@vercel/node';
import { API_KEY, fetchWithRetry } from './_utils.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { ocrText } = req.body;
    if (!ocrText) return res.status(400).json({ error: 'Missing ocrText' });

    const payload = {
      model: 'sarvam-105b',
      messages: [
        {
          role: 'system',
          content: 'You are a newspaper headline extraction assistant. Given OCR text from a newspaper, extract ONLY the news headlines. Do NOT include section labels, photo captions, or body text. Return a JSON array of headline strings. Return ONLY the JSON array.',
        },
        {
          role: 'user',
          content: `Extract headlines from this newspaper OCR text:\n\n${ocrText.slice(0, 8000)}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 2000,
    };

    const response = await fetchWithRetry('https://api.sarvam.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'api-subscription-key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Chat API error:', response.status, errText);
      return res.status(response.status).json({ error: `Chat API error: ${response.status}` });
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content || '[]';

    let headlines: string[] = [];
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON array in response');
      headlines = JSON.parse(jsonMatch[0]);
    } catch {
      headlines = content.split('\n').map((l: string) => l.replace(/^[-*\d.]+\s*/, '').trim()).filter((l: string) => l.length > 10);
    }

    res.json({ headlines });
  } catch (err) {
    console.error('Extract-headlines error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
}
