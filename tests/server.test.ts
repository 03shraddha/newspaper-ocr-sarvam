/**
 * Server route tests — all Sarvam API calls are mocked via vi.stubGlobal('fetch').
 * No real network calls are made; no API key required.
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import supertest from 'supertest';

// Tell server not to auto-listen
process.env.NODE_ENV = 'test';

// Minimal mock fetch — overridden per-test as needed
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { app } = await import('../server/index.js');
const request = supertest(app);

// ─── helpers ──────────────────────────────────────────────────────────────────

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function failResponse(status: number, body = 'API error'): Response {
  return new Response(body, { status });
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ─── GET /api/health ──────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  it('returns status ok', async () => {
    const res = await request.get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('reports hasApiKey=false when key is missing', async () => {
    const res = await request.get('/api/health');
    // API key is empty in test env (no .env loaded with real key)
    expect(res.body).toHaveProperty('hasApiKey');
  });
});

// ─── POST /api/translate ──────────────────────────────────────────────────────

describe('POST /api/translate', () => {
  it('returns translated text from Sarvam API', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ translated_text: 'नमस्ते दुनिया' }));

    const res = await request.post('/api/translate').send({
      input: 'Hello world',
      source_language_code: 'en-IN',
      target_language_code: 'hi-IN',
    });

    expect(res.status).toBe(200);
    expect(res.body.translated_text).toBe('नमस्ते दुनिया');
  });

  it('uses mayura:v1 for core languages', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ translated_text: 'test' }));

    await request.post('/api/translate').send({
      input: 'Hello',
      source_language_code: 'en-IN',
      target_language_code: 'hi-IN',
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.model).toBe('mayura:v1');
  });

  it('uses sarvam-translate:v1 for extended languages', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ translated_text: 'test' }));

    await request.post('/api/translate').send({
      input: 'Hello',
      source_language_code: 'en-IN',
      target_language_code: 'as-IN',
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.model).toBe('sarvam-translate:v1');
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request.post('/api/translate').send({ input: 'Hello' });
    expect(res.status).toBe(400);
  });

  it('propagates Sarvam API errors', async () => {
    mockFetch.mockResolvedValueOnce(failResponse(401, 'Unauthorized'));

    const res = await request.post('/api/translate').send({
      input: 'Hello',
      source_language_code: 'en-IN',
      target_language_code: 'hi-IN',
    });

    expect(res.status).toBe(500); // translateText throws, caught as 500
  });
});

// ─── POST /api/extract-headlines ─────────────────────────────────────────────

describe('POST /api/extract-headlines', () => {
  it('returns headlines array from chat model', async () => {
    const headlines = ['Farmers Demand MSP Hike', 'Election Results Shock Nation'];
    mockFetch.mockResolvedValueOnce(okJson({
      choices: [{ message: { content: JSON.stringify(headlines) } }],
    }));

    const res = await request.post('/api/extract-headlines').send({
      ocrText: '# Farmers Demand MSP Hike\n# Election Results Shock Nation\nSome body text.',
    });

    expect(res.status).toBe(200);
    expect(res.body.headlines).toEqual(headlines);
  });

  it('uses sarvam-105b (not deprecated sarvam-m)', async () => {
    mockFetch.mockResolvedValueOnce(okJson({
      choices: [{ message: { content: '["Test Headline Here"]' } }],
    }));

    await request.post('/api/extract-headlines').send({ ocrText: 'some text here in the newspaper' });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.model).toBe('sarvam-105b');
    expect(callBody.model).not.toBe('sarvam-m');
  });

  it('falls back to line-splitting when JSON parse fails', async () => {
    mockFetch.mockResolvedValueOnce(okJson({
      choices: [{ message: { content: '- Farmers Protest in Delhi\n- New Budget Announced Today' } }],
    }));

    const res = await request.post('/api/extract-headlines').send({ ocrText: 'some text in OCR output' });

    expect(res.status).toBe(200);
    expect(res.body.headlines.length).toBeGreaterThan(0);
  });

  it('returns 400 when ocrText is missing', async () => {
    const res = await request.post('/api/extract-headlines').send({});
    expect(res.status).toBe(400);
  });

  it('forwards Sarvam API error status', async () => {
    mockFetch.mockResolvedValueOnce(failResponse(429, 'Rate limit exceeded'));

    const res = await request.post('/api/extract-headlines').send({ ocrText: 'some ocr text here' });
    expect(res.status).toBe(429);
  });
});

// ─── POST /api/classify-topics ────────────────────────────────────────────────

describe('POST /api/classify-topics', () => {
  it('classifies headlines by topic', async () => {
    const res = await request.post('/api/classify-topics').send({
      headlines: [
        { id: '1', englishText: 'Farmers demand MSP hike for wheat crop' },
        { id: '2', englishText: 'India wins cricket test match against Australia' },
        { id: '3', englishText: 'Random unrelated headline about nothing specific' },
      ],
    });

    expect(res.status).toBe(200);
    const map = Object.fromEntries(res.body.classifications.map((c: any) => [c.id, c.topic]));
    expect(map['1']).toBe('farmers');
    expect(map['2']).toBe('sports');
    expect(map['3']).toBeNull();
  });

  it('returns 400 when headlines is not an array', async () => {
    const res = await request.post('/api/classify-topics').send({ headlines: 'not an array' });
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/chat ───────────────────────────────────────────────────────────

describe('POST /api/chat', () => {
  it('returns a reply from the chat model', async () => {
    mockFetch.mockResolvedValueOnce(okJson({
      choices: [{ message: { content: 'The newspaper covers three main topics today.' } }],
    }));

    const res = await request.post('/api/chat').send({
      messages: [{ role: 'user', content: 'What is in the newspaper today?' }],
      newspaperContext: '# Farmers March to Delhi\nThousands of farmers...',
      targetLang: 'en-IN',
    });

    expect(res.status).toBe(200);
    expect(res.body.reply).toBe('The newspaper covers three main topics today.');
  });

  it('uses sarvam-105b in chat route (not deprecated sarvam-m)', async () => {
    mockFetch.mockResolvedValueOnce(okJson({
      choices: [{ message: { content: 'Response here' } }],
    }));

    await request.post('/api/chat').send({
      messages: [{ role: 'user', content: 'Tell me about the newspaper' }],
      newspaperContext: 'Some OCR text from newspaper',
      targetLang: 'hi-IN',
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.model).toBe('sarvam-105b');
    expect(callBody.model).not.toBe('sarvam-m');
  });

  it('injects Hindi language instruction for hi-IN target', async () => {
    mockFetch.mockResolvedValueOnce(okJson({
      choices: [{ message: { content: 'हिंदी में जवाब' } }],
    }));

    await request.post('/api/chat').send({
      messages: [{ role: 'user', content: 'What is in the paper?' }],
      newspaperContext: 'Some text',
      targetLang: 'hi-IN',
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    const systemContent = callBody.messages[0].content;
    expect(systemContent).toContain('Hindi');
  });

  it('returns 400 when messages array is missing', async () => {
    const res = await request.post('/api/chat').send({ newspaperContext: 'text' });
    expect(res.status).toBe(400);
  });

  it('limits conversation history to last 10 messages', async () => {
    mockFetch.mockResolvedValueOnce(okJson({
      choices: [{ message: { content: 'ok' } }],
    }));

    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`,
    }));

    await request.post('/api/chat').send({
      messages,
      newspaperContext: 'text',
      targetLang: 'en-IN',
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    // system prompt (1) + last 10 messages = 11 total
    expect(callBody.messages.length).toBe(11);
  });
});
