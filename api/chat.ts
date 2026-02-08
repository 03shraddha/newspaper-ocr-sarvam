import type { VercelRequest, VercelResponse } from '@vercel/node';
import { API_KEY, fetchWithRetry } from './_utils.js';

const LANG_NAMES: Record<string, string> = {
  'hi-IN': 'Hindi', 'en-IN': 'English', 'bn-IN': 'Bengali', 'ta-IN': 'Tamil',
  'te-IN': 'Telugu', 'mr-IN': 'Marathi', 'gu-IN': 'Gujarati', 'kn-IN': 'Kannada',
  'ml-IN': 'Malayalam', 'pa-IN': 'Punjabi', 'od-IN': 'Odia', 'as-IN': 'Assamese',
  'ur-IN': 'Urdu', 'sa-IN': 'Sanskrit', 'ne-IN': 'Nepali', 'doi-IN': 'Dogri',
  'brx-IN': 'Bodo', 'kok-IN': 'Konkani', 'mai-IN': 'Maithili', 'sd-IN': 'Sindhi',
  'ks-IN': 'Kashmiri', 'mni-IN': 'Manipuri', 'sat-IN': 'Santali',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, newspaperContext, targetLang, topicSummary } = req.body;
    if (!messages?.length) return res.status(400).json({ error: 'Missing messages' });

    const langName = LANG_NAMES[targetLang] || 'English';

    const topicSection = topicSummary
      ? `\n\n--- TOPIC INDEX ---\nThe following topics were identified in this newspaper. Use this to quickly locate relevant content when the user asks about a specific topic:\n${topicSummary}\n--- END TOPIC INDEX ---`
      : '';

    const systemPrompt = `You are a helpful Indian newspaper analysis assistant called "Samachar Scan". The user has uploaded a newspaper and you have the full OCR-extracted text below. Answer the user's questions about the newspaper content — find relevant articles, summarize topics, explain what matters for farmers/students/businesses/etc.

Rules:
- ALWAYS respond in ${langName}, regardless of what language the user asks in.
- You have the FULL newspaper text, not just headlines. Use all of it to answer questions thoroughly.
- When listing headlines or articles, use numbered lists.
- Be specific — quote actual text from the newspaper.
- If the user asks about a topic not covered in the newspaper, say so honestly.
- Keep answers concise but informative.
- When the user asks about a specific topic (water, farmers, politics, sports, etc.), refer to the TOPIC INDEX below for relevant headlines, then search the full text for details.
${topicSection}

═══ NEWSPAPER OCR TEXT ═══
${(newspaperContext || '').replace(/!\[[^\]]*\]\(data:[^)]+\)/g, '').replace(/\n{3,}/g, '\n\n').slice(0, 10000)}
═══ END ═══`;

    const payload = {
      model: 'sarvam-m',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.slice(-10),
      ],
      temperature: 0.3,
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
    const reply = data.choices?.[0]?.message?.content || 'Sorry, I could not generate a response.';

    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
}
