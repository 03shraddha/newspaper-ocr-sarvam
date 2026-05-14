/**
 * Audio upload + transcription via Sarvam Batch STT API (Saaras v3).
 *
 * Flow:
 *   1. POST /api/stt-batch  — upload audio, create & start batch job → jobId
 *   2. Poll POST /api/stt-batch-status every 5 s until transcript is ready
 *
 * The resulting transcript feeds into the SAME pipeline as PDF/image OCR:
 *   headline extraction → topic classification → translation → Q&A
 *
 * Diarized radio broadcasts come back formatted as:
 *   "Speaker 1: Farmers demand MSP hike\nSpeaker 2: Government responds..."
 */
export async function uploadAudio(
  file: File,
  sourceLang: string,
  onStatus: (msg: string) => void,
): Promise<{ content: string; request_id: string }> {
  // ── Step 1: Upload audio and start batch transcription job ──────────────────
  const formData = new FormData();
  formData.append('file', file);
  formData.append('language', sourceLang === 'auto' ? 'hi-IN' : sourceLang);

  onStatus('Uploading audio file...');

  const startRes = await fetch('/api/stt-batch', { method: 'POST', body: formData });
  if (!startRes.ok) {
    const err = await startRes.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error || `Audio upload failed: ${startRes.status}`);
  }

  const startData = await startRes.json() as { jobId: string; transcript?: string };

  // REST fallback: transcript returned immediately (file was small enough)
  if (startData.transcript) {
    return { content: startData.transcript, request_id: startData.jobId };
  }

  const { jobId } = startData;
  onStatus('Audio uploaded — waiting for transcription...');

  // ── Step 2: Poll for completion (up to 30 minutes for long broadcasts) ──────
  const maxWait = 30 * 60 * 1000;   // 30 minutes
  const pollInterval = 5_000;        // 5 seconds — STT is fast (10–30 s for 30-min audio)
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    await new Promise<void>((r) => setTimeout(r, pollInterval));

    const pollRes = await fetch('/api/stt-batch-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId }),
    });

    if (!pollRes.ok) {
      // Transient poll error — keep retrying
      console.warn('STT status poll failed, retrying...');
      continue;
    }

    const data = await pollRes.json() as {
      state: string;
      transcript?: string;
      request_id?: string;
      error?: string;
    };

    if (data.state === 'Failed') {
      throw new Error(data.error || 'Audio transcription failed on server');
    }

    if (data.transcript) {
      return { content: data.transcript, request_id: data.request_id || jobId };
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    onStatus(`Transcribing audio (${data.state}) — ${elapsed}s elapsed...`);
  }

  throw new Error('Audio transcription timed out after 30 minutes — try a shorter clip');
}
