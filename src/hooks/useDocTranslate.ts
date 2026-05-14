import { useState } from 'react';

export function useDocTranslate() {
  const [isTranslating, setIsTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>('');

  const translateAndDownload = async (
    file: File,
    sourceLang: string,
    targetLang: string,
  ): Promise<void> => {
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Only PDF files can be translated. Upload a PDF first.');
      return;
    }

    setIsTranslating(true);
    setError(null);
    setProgress('Sending PDF to translation service...');

    // Progress ticker — updates message every ~10s so users know it's still working
    let progressStep = 0;
    const progressMessages = [
      'Sending PDF to translation service...',
      'Translating document... (this may take 30-60 seconds)',
      'Still translating — large documents take a moment...',
      'Almost there — finalising translation...',
      'Wrapping up... nearly done...',
    ];
    const progressTimer = setInterval(() => {
      progressStep = Math.min(progressStep + 1, progressMessages.length - 1);
      setProgress(progressMessages[progressStep]);
    }, 10_000);

    try {
      const formData = new FormData();
      formData.append('file', file);
      // Normalise 'auto' → 'hi-IN' (most common Indian newspaper language)
      formData.append(
        'source_language_code',
        sourceLang === 'auto' ? 'hi-IN' : sourceLang,
      );
      formData.append('target_language_code', targetLang);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120_000); // 2-min client-side timeout

      setProgress('Translating document... (this may take 30-60 seconds)');

      const res = await fetch('/api/doc-translate', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeout);
      clearInterval(progressTimer);

      const contentType = res.headers.get('content-type') || '';

      if (contentType.includes('application/pdf')) {
        // Success — buffer then trigger download immediately
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const targetLangName = targetLang.split('-')[0].toUpperCase();
        a.download = `newspaper_translated_${targetLangName}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
        setProgress('');
      } else {
        // Error response (JSON)
        const data = (await res.json()) as { error?: string };
        setError(data.error || 'Translation failed. Please try again.');
        setProgress('');
      }
    } catch (err) {
      clearInterval(progressTimer);
      if ((err as Error).name === 'AbortError') {
        setError('Translation timed out. Try with a shorter document.');
      } else {
        setError('Translation failed. Please try again.');
      }
      setProgress('');
    } finally {
      clearInterval(progressTimer);
      setIsTranslating(false);
    }
  };

  return { isTranslating, error, progress, translateAndDownload };
}
