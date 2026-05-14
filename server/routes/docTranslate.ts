// INTEGRATION: import { docTranslateRouter } from './routes/docTranslate.js'; app.use('/api', docTranslateRouter);

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';

const router = Router();

const API_KEY = process.env.SARVAM_API_KEY || '';
const DOC_TRANSLATE_ENDPOINT = 'https://api.sarvam.ai/parse/translatepdf';
const TIMEOUT_MS = 120_000; // 2 minutes — doc translate can be slow

// Valid Sarvam language codes for doc translate
const VALID_LANG_CODES = new Set([
  'hi-IN', 'bn-IN', 'gu-IN', 'kn-IN', 'ml-IN',
  'mr-IN', 'od-IN', 'pa-IN', 'ta-IN', 'te-IN', 'en-IN',
]);

// Multer: accept PDF only, up to 100MB
const pdfUpload = multer({
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error(`Expected PDF, got: ${file.mimetype}`));
    }
  },
});

/**
 * Call Sarvam Doc Translate API with retry on 502/503/504.
 * Returns the raw Response so the caller can inspect Content-Type.
 */
async function callSarvamDocTranslate(
  fileBuffer: Buffer,
  originalName: string,
  sourceLang: string,
  targetLang: string,
  maxRetries = 2,
): Promise<Response> {
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const formData = new FormData();
      const blob = new Blob([new Uint8Array(fileBuffer)], { type: 'application/pdf' });
      formData.append('file', blob, originalName || 'document.pdf');
      formData.append('source_language_code', sourceLang);
      formData.append('target_language_code', targetLang);

      const response = await fetch(DOC_TRANSLATE_ENDPOINT, {
        method: 'POST',
        headers: { 'api-subscription-key': API_KEY },
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timer);

      // Retry on transient server errors
      if ([502, 503, 504].includes(response.status) && attempt <= maxRetries) {
        console.warn(
          `DocTranslate: transient ${response.status} on attempt ${attempt}/${maxRetries}, retrying in ${5 * attempt}s…`,
        );
        await new Promise((r) => setTimeout(r, 5000 * attempt));
        continue;
      }

      return response;
    } catch (err) {
      clearTimeout(timer);
      const isAbort = err instanceof Error && err.name === 'AbortError';
      if (isAbort) {
        if (attempt <= maxRetries) {
          console.warn(`DocTranslate: timeout on attempt ${attempt}/${maxRetries}, retrying…`);
          await new Promise((r) => setTimeout(r, 5000 * attempt));
          continue;
        }
        throw new Error('DocTranslate request timed out after 2 minutes');
      }
      if (attempt > maxRetries) throw err;
      console.warn(`DocTranslate: network error on attempt ${attempt}/${maxRetries}:`, (err as Error).message);
      await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }

  throw new Error('DocTranslate: all retry attempts exhausted');
}

/**
 * POST /api/doc-translate
 *
 * Accepts: multipart/form-data with:
 *   - file: PDF file (required)
 *   - source_language_code: e.g. "hi-IN" (required)
 *   - target_language_code: e.g. "en-IN" (required)
 *
 * Returns:
 *   - PDF binary as application/pdf with Content-Disposition: attachment
 *   - OR { error: string } with status 200 for user-facing errors (never 500)
 */
/**
 * Multer error interceptor — converts file-type/size multer errors to 400
 * instead of letting them propagate to the global 500 error handler.
 */
function handleMulterError(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: 'File too large. Maximum PDF size is 100MB.' });
      return;
    }
    res.status(400).json({ error: `Upload error: ${err.message}` });
    return;
  }
  if (err instanceof Error && err.message.startsWith('Expected PDF')) {
    res.status(400).json({ error: 'Only PDF files can be translated. Please upload a PDF.' });
    return;
  }
  next(err);
}

router.post(
  '/doc-translate',
  (req, _res, next) => {
    // Extend timeouts for large PDF translation
    req.setTimeout(150_000);
    next();
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (req: Request, res: Response, next: NextFunction) => pdfUpload.single('file')(req, res, (err: any) => {
    if (err) { handleMulterError(err, req, res, next); return; }
    next();
  }),
  async (req: Request, res: Response) => {
    try {
      const file = req.file;

      // Validate file presence
      if (!file) {
        res.status(400).json({ error: 'No file uploaded. Please provide a PDF file.' });
        return;
      }

      // Validate it's actually a PDF (double-check beyond mimetype)
      if (file.mimetype !== 'application/pdf') {
        res.status(400).json({ error: 'Only PDF files can be translated. Please upload a PDF.' });
        return;
      }

      const { source_language_code, target_language_code } = req.body as {
        source_language_code?: string;
        target_language_code?: string;
      };

      // Validate language codes
      if (!source_language_code || !VALID_LANG_CODES.has(source_language_code)) {
        res.status(400).json({
          error: `Invalid source_language_code: "${source_language_code}". Must be one of: ${[...VALID_LANG_CODES].join(', ')}`,
        });
        return;
      }

      if (!target_language_code || !VALID_LANG_CODES.has(target_language_code)) {
        res.status(400).json({
          error: `Invalid target_language_code: "${target_language_code}". Must be one of: ${[...VALID_LANG_CODES].join(', ')}`,
        });
        return;
      }

      console.log(
        `DocTranslate: ${file.originalname} (${(file.size / 1024).toFixed(1)} KB) ` +
        `${source_language_code} → ${target_language_code}`,
      );

      let sarvamResponse: Response;
      try {
        sarvamResponse = await callSarvamDocTranslate(
          file.buffer,
          file.originalname,
          source_language_code,
          target_language_code,
        );
      } catch (err) {
        const msg = (err as Error).message || 'Translation failed';
        console.error('DocTranslate API call failed:', msg);
        // Always return 200 with error object — never crash the client
        res.json({ error: msg.includes('timed out') ? 'Translation timed out. Try with a shorter document.' : 'Translation service unavailable. Please try again later.' });
        return;
      }

      const contentType = sarvamResponse.headers.get('content-type') || '';

      // ── Happy path: Sarvam returned a PDF binary ──
      if (contentType.includes('application/pdf')) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="translated_newspaper.pdf"');
        // Stream the PDF body directly to client without buffering the entire file
        const reader = sarvamResponse.body?.getReader();
        if (!reader) {
          res.json({ error: 'Translation service returned an empty response.' });
          return;
        }
        const pump = async (): Promise<void> => {
          const { done, value } = await reader.read();
          if (done) { res.end(); return; }
          res.write(Buffer.from(value));
          return pump();
        };
        await pump();
        return;
      }

      // ── Check if response is JSON (base64-encoded PDF or error) ──
      if (contentType.includes('application/json') || contentType.includes('text/')) {
        let data: unknown;
        try {
          data = await sarvamResponse.json();
        } catch {
          const raw = await sarvamResponse.text().catch(() => '');
          console.error('DocTranslate non-JSON error response:', sarvamResponse.status, raw.slice(0, 300));
          res.json({ error: 'This PDF appears to be a scanned image. Doc Translate only works with text-selectable PDFs.' });
          return;
        }

        const obj = data as Record<string, unknown>;

        // Some API versions return base64-encoded PDF in JSON
        if (typeof obj['translated_pdf'] === 'string' && obj['translated_pdf']) {
          const pdfBuffer = Buffer.from(obj['translated_pdf'] as string, 'base64');
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', 'attachment; filename="translated_newspaper.pdf"');
          res.send(pdfBuffer);
          return;
        }

        // API returned a JSON error
        if (!sarvamResponse.ok) {
          const errMsg = (typeof obj['error'] === 'string' ? obj['error'] : null) ||
                         (typeof obj['message'] === 'string' ? obj['message'] : null) ||
                         (typeof obj['detail'] === 'string' ? obj['detail'] : null) ||
                         `Translation failed (HTTP ${sarvamResponse.status})`;

          console.error('DocTranslate Sarvam error:', sarvamResponse.status, errMsg);

          // Provide specific user-friendly messages for known errors
          const isScannedPdfError =
            errMsg.toLowerCase().includes('scanned') ||
            errMsg.toLowerCase().includes('selectable') ||
            errMsg.toLowerCase().includes('digital') ||
            errMsg.toLowerCase().includes('text layer') ||
            sarvamResponse.status === 422;

          const userMessage = isScannedPdfError
            ? 'This PDF appears to be a scanned image. Doc Translate only works with text-selectable PDFs.'
            : errMsg;

          res.json({ error: userMessage });
          return;
        }
      }

      // ── Fallback: unrecognised response ──
      console.error(`DocTranslate: unexpected content-type "${contentType}", status ${sarvamResponse.status}`);
      res.json({
        error: 'This PDF appears to be a scanned image. Doc Translate only works with text-selectable PDFs.',
      });
    } catch (err) {
      // Catch-all — never return 500 to the client
      console.error('DocTranslate route unexpected error:', (err as Error).message);
      res.json({ error: 'Translation failed. Please try again.' });
    }
  },
);

export { router as docTranslateRouter };
