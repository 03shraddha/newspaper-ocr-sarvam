import type { VercelRequest, VercelResponse } from '@vercel/node';
import formidable from 'formidable';
import fs from 'fs';
import AdmZip from 'adm-zip';
import { API_KEY } from './_utils.js';

export const config = {
  api: { bodyParser: false },
  maxDuration: 60,
};

const DOC_INTEL_BASE = 'https://api.sarvam.ai/doc-digitization/job/v1';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let tempFilePath = '';

  try {
    const form = formidable({ maxFileSize: 200 * 1024 * 1024 });
    const [fields, files] = await form.parse(req);

    const file = files.file?.[0];
    if (!file) return res.status(400).json({ error: 'No PDF uploaded' });
    tempFilePath = file.filepath;

    const sourceLang = fields.language?.[0] || 'hi-IN';
    const lang = sourceLang === 'auto' ? 'hi-IN' : sourceLang;
    const buffer = fs.readFileSync(file.filepath);

    // Step 1: Create job
    const createRes = await fetch(DOC_INTEL_BASE, {
      method: 'POST',
      headers: { 'api-subscription-key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_parameters: { language: lang, output_format: 'md' } }),
    });
    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error('Doc Intel create error:', createRes.status, errText);
      return res.status(createRes.status).json({ error: `Failed to create job: ${createRes.status}` });
    }
    const jobData = await createRes.json() as any;
    const jobId = jobData.job_id;
    console.log(`Doc Intel job created: ${jobId}`);

    // Step 2: Get upload URL
    const uploadUrlRes = await fetch(`${DOC_INTEL_BASE}/upload-files`, {
      method: 'POST',
      headers: { 'api-subscription-key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId, files: [file.originalFilename || 'document.pdf'] }),
    });
    if (!uploadUrlRes.ok) {
      return res.status(500).json({ error: 'Failed to get upload URL' });
    }
    const uploadUrlData = await uploadUrlRes.json() as any;
    const fileName = Object.keys(uploadUrlData.upload_urls || {})[0];
    const presignedUrl = uploadUrlData.upload_urls?.[fileName]?.file_url;
    if (!presignedUrl) {
      return res.status(500).json({ error: 'No presigned URL returned' });
    }

    // Step 3: Upload PDF to presigned URL
    const uploadRes = await fetch(presignedUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/pdf',
        'x-ms-blob-type': 'BlockBlob',
      },
      body: buffer,
    });
    if (!uploadRes.ok) {
      const errText = await uploadRes.text().catch(() => '');
      console.error('Doc Intel file upload error:', uploadRes.status, errText);
      return res.status(500).json({ error: 'Failed to upload PDF' });
    }
    console.log('Doc Intel file uploaded');

    // Step 4: Start job
    const startRes = await fetch(`${DOC_INTEL_BASE}/${jobId}/start`, {
      method: 'POST',
      headers: { 'api-subscription-key': API_KEY },
    });
    if (!startRes.ok) {
      return res.status(500).json({ error: 'Failed to start processing' });
    }
    console.log('Doc Intel job started');

    // Step 5: Poll for completion (max ~50s to stay within 60s function limit)
    const maxWait = 50_000;
    const pollInterval = 3_000;
    const start = Date.now();
    let jobState = 'Running';

    while (Date.now() - start < maxWait) {
      await new Promise((r) => setTimeout(r, pollInterval));

      const statusRes = await fetch(`${DOC_INTEL_BASE}/${jobId}/status`, {
        method: 'GET',
        headers: { 'api-subscription-key': API_KEY },
      });
      if (!statusRes.ok) continue;

      const statusData = await statusRes.json() as any;
      jobState = statusData.job_state;
      console.log(`Doc Intel status: ${jobState}`);

      if (['Completed', 'PartiallyCompleted', 'Failed'].includes(jobState)) break;
    }

    if (jobState === 'Failed') {
      return res.status(500).json({ error: 'Document processing failed' });
    }
    if (!['Completed', 'PartiallyCompleted'].includes(jobState)) {
      return res.status(504).json({ error: 'Document processing timed out' });
    }

    // Step 6: Get download URLs
    const dlRes = await fetch(`${DOC_INTEL_BASE}/${jobId}/download-files`, {
      method: 'POST',
      headers: { 'api-subscription-key': API_KEY },
    });
    if (!dlRes.ok) {
      return res.status(500).json({ error: 'Failed to get download URL' });
    }
    const dlData = await dlRes.json() as any;
    const dlFileName = Object.keys(dlData.download_urls || {})[0];
    const downloadUrl = dlData.download_urls?.[dlFileName]?.file_url;
    if (!downloadUrl) {
      return res.status(500).json({ error: 'No download URL returned' });
    }

    // Step 7: Download ZIP and extract markdown
    const zipRes = await fetch(downloadUrl);
    if (!zipRes.ok) {
      return res.status(500).json({ error: 'Failed to download output' });
    }
    const zipBuffer = Buffer.from(await zipRes.arrayBuffer());
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();

    let markdown = '';
    for (const entry of entries) {
      if (entry.entryName.endsWith('.md')) {
        markdown += entry.getData().toString('utf-8') + '\n\n';
      }
    }

    if (!markdown.trim()) {
      return res.status(500).json({ error: 'No content extracted from PDF' });
    }

    console.log(`Doc Intel done — extracted ${markdown.length} chars`);
    res.json({ content: markdown.trim(), request_id: jobId });
  } catch (err) {
    console.error('Doc Intelligence error:', err);
    res.status(500).json({ error: (err as Error).message });
  } finally {
    // Clean up temp file
    if (tempFilePath) {
      try { fs.unlinkSync(tempFilePath); } catch {}
    }
  }
}
