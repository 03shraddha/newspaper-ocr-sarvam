/**
 * End-to-end tests that hit real Sarvam AI APIs.
 * Requires SARVAM_API_KEY in .env — tests are skipped automatically if missing.
 *
 * Run with: SARVAM_API_KEY=<key> npm run test:e2e
 */
import { describe, it, expect, beforeAll } from 'vitest';
import supertest from 'supertest';

process.env.NODE_ENV = 'test';

const { app } = await import('../server/index.js');
const request = supertest(app);

const HAS_KEY = !!process.env.SARVAM_API_KEY;
const skipIfNoKey = HAS_KEY ? it : it.skip;

describe('E2E — Sarvam API (requires SARVAM_API_KEY)', () => {
  beforeAll(() => {
    if (!HAS_KEY) {
      console.warn('⚠️  SARVAM_API_KEY not set — skipping E2E tests. Copy .env.example → .env and add your key.');
    }
  });

  skipIfNoKey('health check reports key as configured', async () => {
    const res = await request.get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.hasApiKey).toBe(true);
  });

  skipIfNoKey('translates English → Hindi', async () => {
    const res = await request.post('/api/translate').send({
      input: 'The farmers went to the market today.',
      source_language_code: 'en-IN',
      target_language_code: 'hi-IN',
    });
    expect(res.status).toBe(200);
    expect(res.body.translated_text).toBeTruthy();
    expect(typeof res.body.translated_text).toBe('string');
  });

  skipIfNoKey('translates into extended language (Assamese)', async () => {
    const res = await request.post('/api/translate').send({
      input: 'Today is a good day.',
      source_language_code: 'en-IN',
      target_language_code: 'as-IN',
    });
    expect(res.status).toBe(200);
    expect(res.body.translated_text).toBeTruthy();
  });

  skipIfNoKey('extracts headlines from OCR text via sarvam-105b', async () => {
    const ocrText = `
# Farmers March to Delhi Demanding MSP Hike
Thousands of farmers from Punjab and Haryana started their march...

# India Beats Australia in Final Test Match
The Indian cricket team defeated Australia by an innings and 50 runs...

## State Government Announces New School Scholarship Scheme
Students from low-income families will benefit from the new policy...
`.trim();

    const res = await request.post('/api/extract-headlines').send({ ocrText });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.headlines)).toBe(true);
    expect(res.body.headlines.length).toBeGreaterThan(0);
  });

  skipIfNoKey('chat responds in the requested target language', async () => {
    const res = await request.post('/api/chat').send({
      messages: [{ role: 'user', content: 'What is in this newspaper?' }],
      newspaperContext: '# Farmers Demand MSP Increase\nFarmers across India are protesting for higher minimum support prices.',
      targetLang: 'hi-IN',
    });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBeTruthy();
    expect(typeof res.body.reply).toBe('string');
  });

  skipIfNoKey('full pipeline — classify then translate then chat', async () => {
    // Step 1: classify
    const classifyRes = await request.post('/api/classify-topics').send({
      headlines: [
        { id: '1', englishText: 'Farmers demand MSP hike for wheat crop' },
        { id: '2', englishText: 'India wins cricket world cup final' },
      ],
    });
    expect(classifyRes.status).toBe(200);
    expect(classifyRes.body.classifications[0].topic).toBe('farmers');
    expect(classifyRes.body.classifications[1].topic).toBe('sports');

    // Step 2: translate one headline
    const translateRes = await request.post('/api/translate').send({
      input: 'Farmers demand MSP hike for wheat crop',
      source_language_code: 'en-IN',
      target_language_code: 'hi-IN',
    });
    expect(translateRes.status).toBe(200);
    expect(translateRes.body.translated_text).toBeTruthy();

    // Step 3: chat about it
    const chatRes = await request.post('/api/chat').send({
      messages: [{ role: 'user', content: 'Tell me about the farmers news' }],
      newspaperContext: 'Farmers demand MSP hike for wheat crop. Thousands marched in Delhi.',
      targetLang: 'en-IN',
    });
    expect(chatRes.status).toBe(200);
    expect(chatRes.body.reply).toBeTruthy();
  });
});
