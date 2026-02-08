import type { VercelRequest, VercelResponse } from '@vercel/node';
import formidable from 'formidable';
import fs from 'fs';
import { API_KEY } from './_utils.js';

export const config = {
  api: { bodyParser: false },
};

const DOC_INTEL_BASE = 'https://api.sarvam.ai/doc-digitization/job/v1';

// POST /api/doc-intelligence — Upload PDF, create job, start processing, return jobId
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

    // Step 4: Start job
    const startRes = await fetch(`${DOC_INTEL_BASE}/${jobId}/start`, {
      method: 'POST',
      headers: { 'api-subscription-key': API_KEY },
    });
    if (!startRes.ok) {
      return res.status(500).json({ error: 'Failed to start processing' });
    }

    console.log(`Doc Intel job ${jobId} uploaded and started`);
    res.json({ jobId });
  } catch (err) {
    console.error('Doc Intelligence error:', err);
    res.status(500).json({ error: (err as Error).message });
  } finally {
    if (tempFilePath) {
      try { fs.unlinkSync(tempFilePath); } catch {}
    }
  }
}
