import type { Headline, ChatMessage } from '../lib/types';

// ─── Vision OCR ───
export async function ocrImage(file: File | Blob, sourceLang?: string): Promise<{ content: string; request_id: string }> {
  const formData = new FormData();
  formData.append('file', file);
  if (sourceLang && sourceLang !== 'auto') {
    formData.append('language', sourceLang);
  }

  const res = await fetch('/api/vision', { method: 'POST', body: formData });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || `OCR failed: ${res.status}`);
  }
  return res.json();
}

// ─── Document Intelligence (PDF OCR) ───
export async function ocrPdf(
  file: File,
  sourceLang?: string,
  onStatus?: (msg: string) => void,
): Promise<{ content: string; request_id: string }> {
  // Step 1: Upload PDF and start processing job
  const formData = new FormData();
  formData.append('file', file);
  if (sourceLang) {
    formData.append('language', sourceLang);
  }

  const startRes = await fetch('/api/doc-intelligence', { method: 'POST', body: formData });
  if (!startRes.ok) {
    const err = await startRes.json().catch(() => ({}));
    throw new Error((err as any).error || `PDF upload failed: ${startRes.status}`);
  }
  const { jobId } = await startRes.json();

  // Step 2: Poll for completion
  const maxWait = 600_000; // 10 minutes client-side — large PDFs can take a while
  const pollInterval = 4_000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    await new Promise((r) => setTimeout(r, pollInterval));

    const pollRes = await fetch('/api/doc-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId }),
    });
    if (!pollRes.ok) continue;

    const data = await pollRes.json();

    if (data.state === 'Failed') {
      throw new Error(data.error || 'Document processing failed');
    }

    if (data.content) {
      return { content: data.content, request_id: data.request_id || jobId };
    }

    // Still processing — update status with elapsed time
    const elapsed = Math.round((Date.now() - start) / 1000);
    onStatus?.(`Processing PDF (${data.state}) — ${elapsed}s elapsed...`);
  }

  throw new Error('Document processing timed out — please try again');
}

// ─── Translation ───
export async function translateText(
  input: string,
  sourceLang: string,
  targetLang: string,
): Promise<{ translated_text: string }> {
  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input,
      source_language_code: sourceLang,
      target_language_code: targetLang,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || `Translation failed: ${res.status}`);
  }
  return res.json();
}

// ─── AI Headline Extraction (fallback) ───
export async function extractHeadlinesViaAI(ocrText: string): Promise<string[]> {
  const res = await fetch('/api/extract-headlines', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ocrText }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || `Headline extraction failed: ${res.status}`);
  }
  const data = await res.json();
  return (data as any).headlines || [];
}

// ─── Progressive headline translation ───
export async function translateHeadlines(
  headlines: Headline[],
  sourceLang: string,
  targetLang: string,
  onProgress: (index: number, translated: string) => void,
): Promise<void> {
  for (let i = 0; i < headlines.length; i++) {
    try {
      const result = await translateText(headlines[i].original, sourceLang, targetLang);
      onProgress(i, result.translated_text);
    } catch (err) {
      onProgress(i, `[Translation failed: ${(err as Error).message}]`);
    }
    // Small delay to avoid rate limiting
    if (i < headlines.length - 1) {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
}

// ─── Topic Classification ───
export async function classifyHeadlineTopics(
  headlines: Array<{ id: string; englishText: string }>,
): Promise<Array<{ id: string; topic: string | null }>> {
  const res = await fetch('/api/classify-topics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ headlines }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || `Classification failed: ${res.status}`);
  }
  const data = await res.json();
  return (data as any).classifications || [];
}

// ─── Chat with newspaper context ───
export async function chatWithNewspaper(
  messages: ChatMessage[],
  newspaperContext: string,
  targetLang?: string,
  topicSummary?: string,
): Promise<string> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      newspaperContext,
      targetLang,
      topicSummary,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || `Chat failed: ${res.status}`);
  }
  const data = await res.json();
  return (data as any).reply || '';
}
