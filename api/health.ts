import type { VercelRequest, VercelResponse } from '@vercel/node';
import { API_KEY } from './_utils.js';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.json({ status: 'ok', hasApiKey: !!API_KEY });
}
