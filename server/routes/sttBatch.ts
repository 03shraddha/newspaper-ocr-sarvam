// INTEGRATION: import { sttBatchRouter } from './routes/sttBatch.js'; app.use('/api', sttBatchRouter);

/**
 * Batch Speech-to-Text routes using Sarvam's async job-based STT API (Saaras v3).
 *
 * The Sarvam batch STT API follows the same job lifecycle as Doc Intelligence:
 *   POST /speech-to-text/job/v1          — create job
 *   POST /speech-to-text/job/v1/upload-files  — get presigned upload URLs
 *   POST /speech-to-text/job/v1/{jobId}/start — start processing
 *   GET  /speech-to-text/job/v1/{jobId}/status — poll status
 *   POST /speech-to-text/job/v1/{jobId}/download-files — get presigned download URLs
 *
 * Handles audio up to 200 MB / 60 minutes. Supports speaker diarization so
 * radio broadcasts can label "Speaker 1:", "Speaker 2:", etc.
 *
 * Fallback: if the batch API is unavailable, the /api/stt-batch route will
 * return a descriptive error so the client can suggest using a shorter clip
 * with the existing /api/stt REST endpoint.
 */

import multer from 'multer';
import { Router } from 'express';
import type { Request, Response } from 'express';

const router = Router();

const STT_BATCH_BASE = 'https://api.sarvam.ai/speech-to-text/job/v1';
const STT_REST_ENDPOINT = 'https://api.sarvam.ai/speech-to-text';
const API_KEY = process.env.SARVAM_API_KEY || '';

// ── Multer config: accept audio files up to 200 MB ────────────────────────────
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
  fileFilter: (_req, file, cb) => {
    const allowedMime = [
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave',
      'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/flac',
      'audio/webm', 'audio/x-wav', 'audio/x-m4a',
    ];
    const allowedExt = /\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i;
    if (allowedMime.includes(file.mimetype) || file.mimetype.startsWith('audio/') || allowedExt.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error(`Audio file required, got: ${file.mimetype}`));
    }
  },
});

// ── Shared auth header ─────────────────────────────────────────────────────────
function sarvamHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'api-subscription-key': API_KEY, ...extra };
}

// ── Attempt REST STT fallback (for short clips when batch unavailable) ─────────
async function tryRestSttFallback(
  fileBuffer: Buffer,
  mimeType: string,
  languageCode: string,
  originalName: string,
): Promise<string> {
  const formData = new FormData();
  const baseType = mimeType.split(';')[0];
  const blob = new Blob([new Uint8Array(fileBuffer)], { type: baseType });
  formData.append('file', blob, originalName);
  formData.append('model', 'saaras:v3');
  formData.append('mode', 'transcribe');
  if (languageCode) formData.append('language_code', languageCode);

  const res = await fetch(STT_REST_ENDPOINT, {
    method: 'POST',
    headers: { 'api-subscription-key': API_KEY },
    body: formData,
  });
  if (!res.ok) throw new Error(`REST STT fallback failed: ${res.status}`);
  const data = await res.json() as { transcript?: string };
  return data.transcript || '';
}

// ── Format diarized transcript segments into labelled lines ────────────────────
function formatDiarizedTranscript(entries: Array<{ transcript: string; speaker_id: string }>): string {
  return entries
    .map((e) => `Speaker ${parseInt(e.speaker_id, 10) + 1}: ${e.transcript}`)
    .join('\n');
}

// ════════════════════════════════════════════════════════════════════════════════
// POST /api/stt-batch
//   Accepts: multipart/form-data { file: <audio>, language: <lang-code> }
//   Returns: { jobId: string }
//
//   Flow: create job → get upload URL → PUT audio → start job → return jobId
//   Timeout: 300s (large file upload may take a while)
// ════════════════════════════════════════════════════════════════════════════════

router.post(
  '/stt-batch',
  (req, res, next) => { req.setTimeout(300_000); (res as Response).setTimeout(300_000); next(); },
  audioUpload.single('file'),
  async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'No audio file uploaded' });
        return;
      }

      const rawLang = (req.body?.language as string | undefined) || 'hi-IN';
      const languageCode = rawLang === 'auto' ? 'hi-IN' : rawLang;

      console.log(`STT Batch: starting job for "${file.originalname}" (${(file.size / 1024 / 1024).toFixed(1)} MB, lang=${languageCode})`);

      // ── Step 1: Create batch STT job ─────────────────────────────────────────
      const createRes = await fetch(STT_BATCH_BASE, {
        method: 'POST',
        headers: sarvamHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          model: 'saaras:v3',
          mode: 'transcribe',
          language_code: languageCode,
          with_diarization: true,
          num_speakers: 2,
        }),
      });

      if (!createRes.ok) {
        const errText = await createRes.text().catch(() => '');
        console.error('STT Batch create error:', createRes.status, errText);

        // Batch API unavailable — attempt REST STT fallback for small files
        if (file.size <= 10 * 1024 * 1024) {
          try {
            console.log('STT Batch: falling back to REST STT');
            const transcript = await tryRestSttFallback(file.buffer, file.mimetype, languageCode, file.originalname || 'audio.webm');
            res.json({ jobId: `rest-fallback:${Date.now()}`, transcript });
            return;
          } catch (fallbackErr) {
            console.error('STT Batch REST fallback also failed:', fallbackErr);
          }
        }

        res.status(createRes.status).json({
          error: `Batch STT API unavailable (${createRes.status}). For files under 30 seconds, use a shorter clip.`,
        });
        return;
      }

      const jobData = await createRes.json() as { job_id?: string; id?: string };
      const jobId = jobData.job_id || jobData.id;
      if (!jobId) {
        res.status(500).json({ error: 'No job_id returned from batch STT API' });
        return;
      }
      console.log(`STT Batch job created: ${jobId}`);

      // ── Step 2: Get presigned upload URL ──────────────────────────────────────
      const uploadUrlRes = await fetch(`${STT_BATCH_BASE}/upload-files`, {
        method: 'POST',
        headers: sarvamHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ job_id: jobId, files: [file.originalname || 'audio.mp3'] }),
      });

      if (!uploadUrlRes.ok) {
        const errText = await uploadUrlRes.text().catch(() => '');
        console.error('STT Batch upload-url error:', uploadUrlRes.status, errText);
        res.status(500).json({ error: 'Failed to get upload URL for audio file' });
        return;
      }

      const uploadUrlData = await uploadUrlRes.json() as { upload_urls?: Record<string, { file_url?: string }> };
      const fileName = Object.keys(uploadUrlData.upload_urls || {})[0];
      const presignedUrl = uploadUrlData.upload_urls?.[fileName]?.file_url;

      if (!presignedUrl) {
        res.status(500).json({ error: 'No presigned upload URL returned' });
        return;
      }

      // ── Step 3: Upload audio to presigned URL ─────────────────────────────────
      const uploadRes = await fetch(presignedUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': (file.mimetype || 'audio/mpeg').split(';')[0],
          'x-ms-blob-type': 'BlockBlob',
        },
        body: new Uint8Array(file.buffer),
      });

      if (!uploadRes.ok) {
        const errText = await uploadRes.text().catch(() => '');
        console.error('STT Batch file upload error:', uploadRes.status, errText);
        res.status(500).json({ error: 'Failed to upload audio file to storage' });
        return;
      }

      // ── Step 4: Start the job ─────────────────────────────────────────────────
      const startRes = await fetch(`${STT_BATCH_BASE}/${jobId}/start`, {
        method: 'POST',
        headers: sarvamHeaders(),
      });

      if (!startRes.ok) {
        const errText = await startRes.text().catch(() => '');
        console.error('STT Batch start error:', startRes.status, errText);
        res.status(500).json({ error: 'Failed to start audio transcription job' });
        return;
      }

      console.log(`STT Batch job ${jobId} uploaded and started`);
      res.json({ jobId });
    } catch (err) {
      console.error('STT Batch route error:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

// ════════════════════════════════════════════════════════════════════════════════
// POST /api/stt-batch-status
//   Body: { jobId: string }
//   Returns (running):   { state: string }
//   Returns (completed): { state: string, transcript: string, request_id: string,
//                          segments?: Array<{speaker: string, text: string}> }
//   Returns (failed):    { state: 'Failed', error: string }
// ════════════════════════════════════════════════════════════════════════════════

router.post('/stt-batch-status', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.body as { jobId?: string };
    if (!jobId) {
      res.status(400).json({ error: 'Missing jobId' });
      return;
    }

    // ── REST fallback job (already has transcript inline) ─────────────────────
    if (jobId.startsWith('rest-fallback:')) {
      // The transcript was embedded in the /stt-batch response; client shouldn't
      // be polling a rest-fallback jobId — return done immediately.
      res.json({ state: 'Completed', transcript: '', request_id: jobId });
      return;
    }

    // ── Poll actual batch job status ──────────────────────────────────────────
    const statusRes = await fetch(`${STT_BATCH_BASE}/${jobId}/status`, {
      method: 'GET',
      headers: sarvamHeaders(),
    });

    if (!statusRes.ok) {
      const errText = await statusRes.text().catch(() => '');
      console.error('STT Batch status error:', statusRes.status, errText);
      res.status(500).json({ error: 'Failed to check transcription job status' });
      return;
    }

    const statusData = await statusRes.json() as {
      job_state?: string;
      status?: string;
      state?: string;
    };

    // Normalise state across possible field names
    const rawState: string = statusData.job_state || statusData.status || statusData.state || 'Unknown';

    // Still running
    if (['Accepted', 'Pending', 'Running', 'PENDING', 'RUNNING', 'IN_PROGRESS'].includes(rawState)) {
      res.json({ state: rawState });
      return;
    }

    // Failed
    if (['Failed', 'FAILED', 'ERROR'].includes(rawState)) {
      res.json({ state: 'Failed', error: 'Audio transcription failed on Sarvam servers' });
      return;
    }

    // ── Completed — download results ──────────────────────────────────────────
    const dlRes = await fetch(`${STT_BATCH_BASE}/${jobId}/download-files`, {
      method: 'POST',
      headers: sarvamHeaders(),
    });

    if (!dlRes.ok) {
      const errText = await dlRes.text().catch(() => '');
      console.error('STT Batch download-url error:', dlRes.status, errText);
      res.status(500).json({ error: 'Failed to get download URL for transcription results' });
      return;
    }

    const dlData = await dlRes.json() as { download_urls?: Record<string, { file_url?: string }> };
    const dlFileName = Object.keys(dlData.download_urls || {})[0];
    const downloadUrl = dlData.download_urls?.[dlFileName]?.file_url;

    if (!downloadUrl) {
      res.status(500).json({ error: 'No download URL returned for transcription results' });
      return;
    }

    const resultRes = await fetch(downloadUrl);
    if (!resultRes.ok) {
      res.status(500).json({ error: 'Failed to download transcription results' });
      return;
    }

    const resultData = await resultRes.json() as {
      transcript?: string;
      request_id?: string;
      diarized_transcript?: {
        entries?: Array<{ transcript: string; speaker_id: string; start_time_seconds?: number; end_time_seconds?: number }>;
      };
    };

    // ── Build transcript string ───────────────────────────────────────────────
    let transcript = '';
    const segments: Array<{ speaker: string; text: string }> = [];

    const diarizedEntries = resultData.diarized_transcript?.entries;
    if (diarizedEntries && diarizedEntries.length > 0) {
      // Format diarized output: "Speaker 1: text\nSpeaker 2: text"
      transcript = formatDiarizedTranscript(diarizedEntries);
      for (const entry of diarizedEntries) {
        segments.push({
          speaker: `Speaker ${parseInt(entry.speaker_id, 10) + 1}`,
          text: entry.transcript,
        });
      }
    } else {
      transcript = resultData.transcript || '';
    }

    if (!transcript.trim()) {
      res.status(500).json({ error: 'No transcript content in results' });
      return;
    }

    console.log(`STT Batch ${jobId} done — ${transcript.length} chars, ${segments.length} diarized segments`);
    res.json({
      state: rawState,
      transcript,
      request_id: resultData.request_id || jobId,
      ...(segments.length > 0 ? { segments } : {}),
    });
  } catch (err) {
    console.error('STT Batch status route error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

export { router as sttBatchRouter };
