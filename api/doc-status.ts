import type { VercelRequest, VercelResponse } from '@vercel/node';
import AdmZip from 'adm-zip';
import { API_KEY } from './_utils.js';

const DOC_INTEL_BASE = 'https://api.sarvam.ai/doc-digitization/job/v1';

// POST /api/doc-status — Check job status; if done, download and return markdown
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { jobId } = req.body;
    if (!jobId) return res.status(400).json({ error: 'Missing jobId' });

    // Check status
    const statusRes = await fetch(`${DOC_INTEL_BASE}/${jobId}/status`, {
      method: 'GET',
      headers: { 'api-subscription-key': API_KEY },
    });
    if (!statusRes.ok) {
      return res.status(500).json({ error: 'Failed to check job status' });
    }

    const statusData = await statusRes.json() as any;
    const jobState = statusData.job_state;

    // Still processing
    if (['Accepted', 'Pending', 'Running'].includes(jobState)) {
      return res.json({ state: jobState });
    }

    // Failed
    if (jobState === 'Failed') {
      return res.json({ state: 'Failed', error: 'Document processing failed' });
    }

    // Completed — download and extract markdown
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

    console.log(`Doc Intel ${jobId} done — extracted ${markdown.length} chars`);
    res.json({ state: jobState, content: markdown.trim(), request_id: jobId });
  } catch (err) {
    console.error('Doc status error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
}
