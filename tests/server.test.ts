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

  it('uses sarvam-30b for efficient headline extraction', async () => {
    mockFetch.mockResolvedValueOnce(okJson({
      choices: [{ message: { content: '["Test Headline Here"]' } }],
    }));

    await request.post('/api/extract-headlines').send({ ocrText: 'some text here in the newspaper' });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.model).toBe('sarvam-30b');
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

// ─── POST /api/transliterate-text ────────────────────────────────────────────

describe('POST /api/transliterate-text', () => {
  it('returns transliterated_text from Sarvam API for supported languages', async () => {
    mockFetch.mockResolvedValueOnce(okJson({
      transliterated_text: 'Namaste Duniya',
      source_language_code: 'hi-IN',
      request_id: 'test-req-id',
    }));

    const res = await request.post('/api/transliterate-text').send({
      text: 'नमस्ते दुनिया',
      source_language_code: 'hi-IN',
    });

    expect(res.status).toBe(200);
    expect(res.body.transliterated_text).toBe('Namaste Duniya');
  });

  it('passes through original text for unsupported language codes (no API call)', async () => {
    const res = await request.post('/api/transliterate-text').send({
      text: 'Some text in unsupported language',
      source_language_code: 'as-IN', // Assamese — not in transliterate supported set
    });

    expect(res.status).toBe(200);
    expect(res.body.transliterated_text).toBe('Some text in unsupported language');
    // Sarvam API should NOT have been called
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 400 when text field is missing', async () => {
    const res = await request.post('/api/transliterate-text').send({
      source_language_code: 'hi-IN',
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 when source_language_code is missing', async () => {
    const res = await request.post('/api/transliterate-text').send({
      text: 'नमस्ते',
    });

    expect(res.status).toBe(400);
  });

  it('uses en-IN as default target_language_code', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ transliterated_text: 'Namaste' }));

    await request.post('/api/transliterate-text').send({
      text: 'नमस्ते',
      source_language_code: 'hi-IN',
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.target_language_code).toBe('en-IN');
  });

  it('falls back to original text when Sarvam API returns an error — never 500', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 }),
    );

    const res = await request.post('/api/transliterate-text').send({
      text: 'नमस्ते',
      source_language_code: 'hi-IN',
    });

    // Route must always return 200 with original text on API failure
    expect(res.status).toBe(200);
    expect(res.body.transliterated_text).toBe('नमस्ते');
  });
});

// ─── POST /api/stt ────────────────────────────────────────────────────────────

describe('POST /api/stt', () => {
  it('returns transcript when Sarvam STT API succeeds', async () => {
    mockFetch.mockResolvedValueOnce(
      okJson({ transcript: 'किसानों की समस्या', language_code: 'hi-IN', language_probability: 0.97 })
    );

    const res = await request
      .post('/api/stt')
      .attach('file', Buffer.from('fake-audio-data'), { filename: 'recording.webm', contentType: 'audio/webm' })
      .field('language_code', 'hi-IN');

    expect(res.status).toBe(200);
    expect(res.body.transcript).toBe('किसानों की समस्या');
    expect(res.body.language_code).toBe('hi-IN');
  });

  it('returns empty transcript (not 500) when Sarvam STT API fails', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('Service Unavailable', { status: 503 })
    );

    const res = await request
      .post('/api/stt')
      .attach('file', Buffer.from('fake-audio-data'), { filename: 'recording.webm', contentType: 'audio/webm' })
      .field('language_code', 'hi-IN');

    // Must return 200 with empty transcript, never 500
    expect(res.status).toBe(200);
    expect(res.body.transcript).toBe('');
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when no file is uploaded', async () => {
    const res = await request
      .post('/api/stt')
      .send({ language_code: 'hi-IN' });

    expect(res.status).toBe(400);
    expect(res.body.transcript).toBe('');
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

// ─── POST /api/detect-language ────────────────────────────────────────────────

describe('POST /api/detect-language', () => {
  it('returns language_code and script_code on successful detection', async () => {
    mockFetch.mockResolvedValueOnce(okJson({
      language_code: 'hi-IN',
      script_code: 'Deva',
      request_id: 'req-123',
    }));

    const res = await request.post('/api/detect-language').send({
      text: 'यह एक हिंदी समाचार पत्र है। आज की मुख्य खबरें यहाँ हैं।',
    });

    expect(res.status).toBe(200);
    expect(res.body.language_code).toBe('hi-IN');
    expect(res.body.script_code).toBe('Deva');
  });

  it('returns { language_code: null } for a language not in the supported set', async () => {
    // Sarvam returns a code that is NOT in the 11-language supported list
    mockFetch.mockResolvedValueOnce(okJson({
      language_code: 'fr-FR',
      script_code: 'Latn',
      request_id: 'req-456',
    }));

    const res = await request.post('/api/detect-language').send({
      text: 'Bonjour le monde, ceci est un journal francais.',
    });

    expect(res.status).toBe(200);
    expect(res.body.language_code).toBeNull();
  });

  it('returns 200 with { language_code: null } when Sarvam LID API returns an error (never 500)', async () => {
    mockFetch.mockResolvedValueOnce(failResponse(500, 'Internal Server Error'));

    const res = await request.post('/api/detect-language').send({
      text: 'Some newspaper text that would trigger an API error.',
    });

    // Must be 200 — LID is best-effort and must never break the client
    expect(res.status).toBe(200);
    expect(res.body.language_code).toBeNull();
  });

  it('returns 200 with { language_code: null } when the LID API call throws (network failure)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const res = await request.post('/api/detect-language').send({
      text: 'Some newspaper text for testing network failure.',
    });

    expect(res.status).toBe(200);
    expect(res.body.language_code).toBeNull();
  });

  it('returns 400 when text field is missing', async () => {
    const res = await request.post('/api/detect-language').send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 when text is an empty string', async () => {
    const res = await request.post('/api/detect-language').send({ text: '   ' });
    expect(res.status).toBe(400);
  });

  it('sends only the first 1000 chars of text to Sarvam', async () => {
    mockFetch.mockResolvedValueOnce(okJson({
      language_code: 'ta-IN',
      script_code: 'Taml',
      request_id: 'req-789',
    }));

    const longText = 'த'.repeat(2000); // 2000 Tamil chars
    await request.post('/api/detect-language').send({ text: longText });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body) as { input: string };
    expect(callBody.input.length).toBeLessThanOrEqual(1000);
  });

  it('returns 200 with null when Sarvam returns 502 on all retry attempts', async () => {
    // Three attempts: initial + 2 retries — all 502
    mockFetch
      .mockResolvedValueOnce(failResponse(502, 'Bad Gateway'))
      .mockResolvedValueOnce(failResponse(502, 'Bad Gateway'))
      .mockResolvedValueOnce(failResponse(502, 'Bad Gateway'));

    const res = await request.post('/api/detect-language').send({
      text: 'अखबार की खबरें',
    });

    expect(res.status).toBe(200);
    expect(res.body.language_code).toBeNull();
  });
});

// ─── POST /api/tts ────────────────────────────────────────────────────────────

describe('POST /api/tts', () => {
  it('returns audio_base64 when Sarvam TTS API succeeds', async () => {
    const fakeAudio = Buffer.from('fake-wav-data').toString('base64');
    mockFetch.mockResolvedValueOnce(okJson({ audios: [fakeAudio], request_id: 'req-tts-001' }));

    const res = await request.post('/api/tts').send({
      text: 'नमस्ते दुनिया',
      language_code: 'hi-IN',
    });

    expect(res.status).toBe(200);
    expect(res.body.audio_base64).toBe(fakeAudio);
    expect(res.body.content_type).toBe('audio/wav');
    expect(res.body.error).toBeUndefined();
  });

  it('falls back to en-IN for unsupported language codes', async () => {
    const fakeAudio = Buffer.from('fake-wav-data').toString('base64');
    mockFetch.mockResolvedValueOnce(okJson({ audios: [fakeAudio] }));

    await request.post('/api/tts').send({
      text: 'Hello from an unsupported language',
      language_code: 'as-IN', // Assamese — not in TTS supported list
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body) as { target_language_code: string };
    expect(callBody.target_language_code).toBe('en-IN');
  });

  it('truncates text over 2500 characters before sending to Sarvam', async () => {
    const fakeAudio = Buffer.from('wav').toString('base64');
    mockFetch.mockResolvedValueOnce(okJson({ audios: [fakeAudio] }));

    const longText = 'क'.repeat(3000); // 3000 chars — exceeds 2500 limit
    await request.post('/api/tts').send({
      text: longText,
      language_code: 'hi-IN',
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body) as { inputs: string[] };
    expect(callBody.inputs[0].length).toBe(2500);
  });

  it('returns 200 with error field when Sarvam API returns an error (not 500)', async () => {
    mockFetch.mockResolvedValueOnce(failResponse(500, 'Internal Server Error'));

    const res = await request.post('/api/tts').send({
      text: 'Test headline text',
      language_code: 'hi-IN',
    });

    // Must NEVER be a 500 from our server — always 200 with error field
    expect(res.status).toBe(200);
    expect(res.body.error).toBeDefined();
    expect(typeof res.body.error).toBe('string');
    expect(res.body.audio_base64).toBeUndefined();
  });
});

// ─── POST /api/doc-translate ──────────────────────────────────────────────────

describe('POST /api/doc-translate', () => {
  it('returns a PDF response when Sarvam doc-translate API succeeds', async () => {
    const fakePdf = Buffer.from('%PDF-1.4 translated content');
    mockFetch.mockResolvedValueOnce(
      new Response(fakePdf, {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      }),
    );

    const res = await request
      .post('/api/doc-translate')
      .attach('file', Buffer.from('%PDF-1.4 original content'), {
        filename: 'newspaper.pdf',
        contentType: 'application/pdf',
      })
      .field('source_language_code', 'hi-IN')
      .field('target_language_code', 'en-IN');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
  });

  it('returns 400 when a non-PDF file is uploaded', async () => {
    const res = await request
      .post('/api/doc-translate')
      .attach('file', Buffer.from('plain text content'), {
        filename: 'article.txt',
        contentType: 'text/plain',
      })
      .field('source_language_code', 'hi-IN')
      .field('target_language_code', 'en-IN');

    expect(res.status).toBe(400);
  });

  it('returns 400 when no file is uploaded', async () => {
    const res = await request
      .post('/api/doc-translate')
      .send({ source_language_code: 'hi-IN', target_language_code: 'en-IN' });

    expect(res.status).toBe(400);
  });

  it('returns graceful error object on Sarvam API failure — never 500 from our server', async () => {
    // Sarvam returns 422 for scanned PDFs (no selectable text)
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Scanned PDF not supported for translation' }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await request
      .post('/api/doc-translate')
      .attach('file', Buffer.from('%PDF-1.4 scanned'), {
        filename: 'scanned.pdf',
        contentType: 'application/pdf',
      })
      .field('source_language_code', 'hi-IN')
      .field('target_language_code', 'en-IN');

    // Route must not crash — return a JSON error body (always 200 for user-facing errors)
    expect(res.status).toBe(200);
    expect(res.body.error).toBeDefined();
    expect(typeof res.body.error).toBe('string');
    // Should explain the scanned-PDF issue specifically
    expect(res.body.error.toLowerCase()).toContain('scanned');
  });

  it('sends correct source and target language codes to Sarvam', async () => {
    const fakePdf = Buffer.from('%PDF-1.4 translated');
    mockFetch.mockResolvedValueOnce(
      new Response(fakePdf, {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      }),
    );

    await request
      .post('/api/doc-translate')
      .attach('file', Buffer.from('%PDF-1.4 content'), {
        filename: 'test.pdf',
        contentType: 'application/pdf',
      })
      .field('source_language_code', 'ta-IN')
      .field('target_language_code', 'en-IN');

    // Verify the Sarvam API was called exactly once
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [callUrl] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(callUrl).toContain('translatepdf');
  });

  it('handles large PDF files within the file size limit', async () => {
    // Create a ~1MB fake PDF buffer to test size handling
    const largeFakePdf = Buffer.concat([
      Buffer.from('%PDF-1.4 '),
      Buffer.alloc(1 * 1024 * 1024, 'x'), // 1MB padding
    ]);
    mockFetch.mockResolvedValueOnce(
      new Response(Buffer.from('%PDF-1.4 translated'), {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      }),
    );

    const res = await request
      .post('/api/doc-translate')
      .attach('file', largeFakePdf, {
        filename: 'large-newspaper.pdf',
        contentType: 'application/pdf',
      })
      .field('source_language_code', 'mr-IN')
      .field('target_language_code', 'en-IN');

    // Should accept and process without 413 payload-too-large
    expect(res.status).not.toBe(413);
  });

  it('returns 400 when source_language_code is missing', async () => {
    const res = await request
      .post('/api/doc-translate')
      .attach('file', Buffer.from('%PDF-1.4 content'), {
        filename: 'newspaper.pdf',
        contentType: 'application/pdf',
      })
      .field('target_language_code', 'en-IN');

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 when target_language_code is missing', async () => {
    const res = await request
      .post('/api/doc-translate')
      .attach('file', Buffer.from('%PDF-1.4 content'), {
        filename: 'newspaper.pdf',
        contentType: 'application/pdf',
      })
      .field('source_language_code', 'hi-IN');

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 200 with error object when Sarvam returns a generic API error', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Internal processing error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await request
      .post('/api/doc-translate')
      .attach('file', Buffer.from('%PDF-1.4 content'), {
        filename: 'newspaper.pdf',
        contentType: 'application/pdf',
      })
      .field('source_language_code', 'hi-IN')
      .field('target_language_code', 'en-IN');

    // Our server must shield the client — always 200 with error field
    expect(res.status).toBe(200);
    expect(res.body.error).toBeDefined();
    expect(typeof res.body.error).toBe('string');
  });
});

// ─── POST /api/stt-batch ──────────────────────────────────────────────────────

describe('POST /api/stt-batch', () => {
  it('returns jobId when Sarvam batch STT API succeeds', async () => {
    // create job → upload-files → PUT upload → start job
    mockFetch
      .mockResolvedValueOnce(okJson({ job_id: 'stt-job-abc123' }))            // create
      .mockResolvedValueOnce(okJson({                                          // upload-files
        upload_urls: { 'audio.mp3': { file_url: 'https://storage.example.com/presigned-put' } },
      }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))               // PUT audio
      .mockResolvedValueOnce(new Response('', { status: 200 }));              // start

    const audioBuffer = Buffer.from('fake-mp3-bytes');
    const res = await request
      .post('/api/stt-batch')
      .attach('file', audioBuffer, { filename: 'broadcast.mp3', contentType: 'audio/mpeg' })
      .field('language', 'hi-IN');

    expect(res.status).toBe(200);
    expect(res.body.jobId).toBe('stt-job-abc123');
  });

  it('returns 400 when no file is uploaded', async () => {
    const res = await request.post('/api/stt-batch').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No audio file/i);
  });

  it('uses saaras:v3 model and transcribe mode in job creation', async () => {
    mockFetch
      .mockResolvedValueOnce(okJson({ job_id: 'stt-model-test' }))
      .mockResolvedValueOnce(okJson({
        upload_urls: { 'audio.mp3': { file_url: 'https://storage.example.com/put' } },
      }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));

    const audioBuffer = Buffer.from('fake-wav-bytes');
    await request
      .post('/api/stt-batch')
      .attach('file', audioBuffer, { filename: 'news.wav', contentType: 'audio/wav' })
      .field('language', 'hi-IN');

    const createCall = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(createCall.model).toBe('saaras:v3');
    expect(createCall.mode).toBe('transcribe');
  });

  it('enables diarization so radio speakers are labelled', async () => {
    mockFetch
      .mockResolvedValueOnce(okJson({ job_id: 'stt-diarize-test' }))
      .mockResolvedValueOnce(okJson({
        upload_urls: { 'audio.mp3': { file_url: 'https://storage.example.com/put' } },
      }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));

    await request
      .post('/api/stt-batch')
      .attach('file', Buffer.from('audio'), { filename: 'radio.mp3', contentType: 'audio/mpeg' })
      .field('language', 'hi-IN');

    const createCall = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(createCall.with_diarization).toBe(true);
  });

  it('returns error when batch API create call fails and file is too large for fallback', async () => {
    mockFetch.mockResolvedValueOnce(failResponse(503, 'Service Unavailable'));

    // Simulate a 15 MB file (too large for REST fallback which requires <= 10 MB)
    const largeBuffer = Buffer.alloc(15 * 1024 * 1024, 0);
    const res = await request
      .post('/api/stt-batch')
      .attach('file', largeBuffer, { filename: 'long-broadcast.mp3', contentType: 'audio/mpeg' })
      .field('language', 'hi-IN');

    expect(res.status).toBe(503);
    expect(res.body.error).toBeDefined();
  });
});

// ─── POST /api/stt-batch-status ───────────────────────────────────────────────

describe('POST /api/stt-batch-status', () => {
  it('returns running state while job is in progress', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ job_state: 'Running' }));

    const res = await request.post('/api/stt-batch-status').send({ jobId: 'stt-job-abc123' });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('Running');
    expect(res.body.transcript).toBeUndefined();
  });

  it('returns transcript when job completes (plain transcript)', async () => {
    const transcript = 'किसानों ने दिल्ली में आंदोलन शुरू किया। सरकार ने वार्ता का प्रस्ताव दिया।';

    mockFetch
      .mockResolvedValueOnce(okJson({ job_state: 'Completed' }))             // status
      .mockResolvedValueOnce(okJson({                                          // download-files
        download_urls: { 'result.json': { file_url: 'https://storage.example.com/result' } },
      }))
      .mockResolvedValueOnce(okJson({ transcript, request_id: 'req-xyz' })); // result download

    const res = await request.post('/api/stt-batch-status').send({ jobId: 'stt-job-abc123' });

    expect(res.status).toBe(200);
    expect(res.body.transcript).toBe(transcript);
    expect(res.body.request_id).toBe('req-xyz');
    expect(res.body.state).toBe('Completed');
  });

  it('returns diarized transcript formatted with speaker labels', async () => {
    mockFetch
      .mockResolvedValueOnce(okJson({ job_state: 'Completed' }))
      .mockResolvedValueOnce(okJson({
        download_urls: { 'result.json': { file_url: 'https://storage.example.com/result' } },
      }))
      .mockResolvedValueOnce(okJson({
        diarized_transcript: {
          entries: [
            { transcript: 'Farmers demand MSP hike', speaker_id: '0' },
            { transcript: 'Government responds with new scheme', speaker_id: '1' },
          ],
        },
        request_id: 'req-diarized',
      }));

    const res = await request.post('/api/stt-batch-status').send({ jobId: 'stt-diarized-job' });

    expect(res.status).toBe(200);
    expect(res.body.transcript).toContain('Speaker 1: Farmers demand MSP hike');
    expect(res.body.transcript).toContain('Speaker 2: Government responds with new scheme');
    expect(res.body.segments).toHaveLength(2);
    expect(res.body.segments[0].speaker).toBe('Speaker 1');
  });

  it('returns Failed state when transcription job fails', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ job_state: 'Failed' }));

    const res = await request.post('/api/stt-batch-status').send({ jobId: 'stt-failed-job' });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('Failed');
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 when jobId is missing', async () => {
    const res = await request.post('/api/stt-batch-status').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/jobId/i);
  });

  it('resolves rest-fallback jobId immediately without hitting Sarvam API', async () => {
    const res = await request
      .post('/api/stt-batch-status')
      .send({ jobId: 'rest-fallback:1716200000000' });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('Completed');
    // No Sarvam API calls should be made for fallback jobs
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
