import { useState, useCallback, useEffect, useMemo } from 'react';
import { useLanguageDetect } from './hooks/useLanguageDetect';
import type { Headline, AppStep, ProcessingStage } from './lib/types';
import { LANGUAGES } from './lib/languages';
import { ocrImage, ocrPdf, extractHeadlinesViaAI, translateHeadlines, translateText, classifyHeadlineTopics } from './services/api';
import { uploadAudio } from './services/audioApi';
import { extractHeadlines } from './services/headlineParser';
import { pdfToImages, isPdf } from './services/pdfToImages';
import { buildTopicSummaries, getTopicsFound } from './lib/topics';
import FileUpload from './components/FileUpload';
import LanguageSelector from './components/LanguageSelector';
import HeadlineList from './components/HeadlineList';
import ProgressSteps from './components/ProgressSteps';
import DarkModeToggle from './components/DarkModeToggle';
import SuccessAnimation from './components/SuccessAnimation';
import ImagePreview from './components/ImagePreview';
import ChatInterface from './components/ChatInterface';
import TopicCards from './components/TopicCards';

function App() {
  const { detectLanguage } = useLanguageDetect();

  const [step, setStep] = useState<AppStep>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [headlines, setHeadlines] = useState<Headline[]>([]);
  const [sourceLang, setSourceLang] = useState('auto');
  const [targetLang, setTargetLang] = useState('en-IN');
  const [showOriginals, setShowOriginals] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [processingStage, setProcessingStage] = useState<ProcessingStage>('idle');
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [showSuccess, setShowSuccess] = useState(false);
  const [detectedLang, setDetectedLang] = useState<string | null>(null);

  // Chat state — stores the full OCR text for the AI to reason over
  const [ocrFullText, setOcrFullText] = useState('');

  // Results tab: 'chat', 'headlines', or 'topics'
  const [resultsTab, setResultsTab] = useState<'chat' | 'headlines' | 'topics'>('chat');

  const isProcessing = step === 'processing';

  useEffect(() => {
    return () => {
      imageUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [imageUrls]);

  const processFile = useCallback(async () => {
    if (!file) return;

    setStep('processing');
    setError(null);
    setHeadlines([]);
    setOcrFullText('');
    setProcessingStage('converting');
    setShowSuccess(false);

    try {
      let allMarkdown: string;

      if (file.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name)) {
        // ── Audio: Use STT Batch API for radio/podcast transcription ──
        setProcessingStage('ocr');
        setStatus('Transcribing audio via saaras:v3...');
        const result = await uploadAudio(file, sourceLang, setStatus);
        allMarkdown = result.content;
      } else if (isPdf(file)) {
        // ── PDF: Use Document Intelligence API for full-document OCR ──
        setProcessingStage('ocr');
        setStatus('Reading document via Doc Intelligence (sarvam-vision 3B)...');
        const result = await ocrPdf(file, sourceLang, setStatus);
        allMarkdown = result.content;

        // Also generate preview images from PDF
        try {
          const blobs = await pdfToImages(file, 5);
          const urls = blobs.map((b) => URL.createObjectURL(b));
          setImageUrls(urls);
        } catch {
          // Preview is optional — don't fail the whole flow
        }
      } else {
        // ── Image: Use Vision API for single-image OCR ──
        const url = URL.createObjectURL(file);
        setImageUrls([url]);

        setProcessingStage('ocr');
        setStatus('Running OCR via sarvam-vision 3B...');
        const result = await ocrImage(file, sourceLang);
        allMarkdown = result.content;
      }

      if (!allMarkdown.trim()) throw new Error('No text extracted. Try a clearer image.');

      // Auto-detect language in parallel with processing (non-blocking)
      if (sourceLang === 'auto') {
        detectLanguage(allMarkdown.slice(0, 600)).then((code) => {
          if (code) { setDetectedLang(code); setSourceLang(code); }
        });
      }

      // Store full OCR text for chat context
      setOcrFullText(allMarkdown);

      setProcessingStage('parsing');
      setStatus('Extracting headlines from OCR text...');

      let headlineTexts: string[] = [];
      let headlineSource: 'markdown' | 'ai' = 'markdown';
      const headlinePageMap: Map<string, number> = new Map();

      // Split markdown by page markers or treat as single page
      const pageTexts = allMarkdown.split(/\n---\n/).filter((t) => t.trim());
      for (let i = 0; i < pageTexts.length; i++) {
        const pageHeadlines = extractHeadlines(pageTexts[i]);
        for (const h of pageHeadlines) {
          if (!headlinePageMap.has(h)) {
            headlinePageMap.set(h, i + 1);
            headlineTexts.push(h);
          }
        }
      }

      if (headlineTexts.length < 2) {
        setStatus('Extracting headlines via sarvam-30b...');
        headlineTexts = await extractHeadlinesViaAI(allMarkdown);
        headlineSource = 'ai';
      }

      if (headlineTexts.length === 0) throw new Error('No content found in the image. Try a clearer newspaper scan.');

      const headlineObjects: Headline[] = headlineTexts.map((text) => ({
        id: crypto.randomUUID(),
        original: text,
        translated: '',
        isTranslating: true,
        page: headlinePageMap.get(text),
        source: headlineSource,
      }));

      // ── Classify topics (needs English text) ──
      setProcessingStage('classifying');
      setStatus('Classifying topics by keyword...');

      if (sourceLang === 'en-IN') {
        // Source is English — classify directly
        headlineObjects.forEach((h) => { h.englishText = h.original; });
      } else if (targetLang !== 'en-IN') {
        // Need a separate English translation pass for classification
        for (let i = 0; i < headlineObjects.length; i++) {
          setStatus(`Translating for classification (${i + 1}/${headlineObjects.length})...`);
          try {
            const result = await translateText(headlineObjects[i].original, sourceLang, 'en-IN');
            headlineObjects[i].englishText = result.translated_text;
          } catch {
            headlineObjects[i].englishText = '';
          }
          if (i < headlineObjects.length - 1) {
            await new Promise((r) => setTimeout(r, 100));
          }
        }
      }
      // If targetLang === 'en-IN', we classify after translation (reuse translated text)

      // Run keyword classification on English text (if available)
      if (sourceLang === 'en-IN' || targetLang !== 'en-IN') {
        try {
          const classInput = headlineObjects.map((h) => ({ id: h.id, englishText: h.englishText || '' }));
          const classifications = await classifyHeadlineTopics(classInput);
          const topicMap = new Map(classifications.map((c) => [c.id, c.topic]));
          headlineObjects.forEach((h) => { h.topic = topicMap.get(h.id) || null; });
        } catch {
          console.warn('Topic classification failed, continuing without topics');
        }
      }

      setHeadlines(headlineObjects);
      setStep('results');
      setResultsTab('chat');

      setProcessingStage('translating');
      setStatus('Translating via mayura:v1...');
      await translateHeadlines(headlineObjects, sourceLang, targetLang, (index, translated) => {
        headlineObjects[index].translated = translated;
        setHeadlines((prev) =>
          prev.map((h, i) => (i === index ? { ...h, translated, isTranslating: false } : h))
        );
        setStatus(`Translating headline ${index + 1} of ${headlineTexts.length} via mayura:v1...`);
      });

      // If target was English, classify now using the translated text
      if (targetLang === 'en-IN' && sourceLang !== 'en-IN') {
        setStatus('Classifying topics by keyword...');
        try {
          const classInput = headlineObjects.map((h) => ({
            id: h.id,
            englishText: h.translated || h.original,
          }));
          const classifications = await classifyHeadlineTopics(classInput);
          const topicMap = new Map(classifications.map((c) => [c.id, c.topic]));
          setHeadlines((prev) =>
            prev.map((h) => ({
              ...h,
              topic: topicMap.get(h.id) || null,
              englishText: h.translated || h.original,
            }))
          );
        } catch {
          console.warn('Topic classification failed');
        }
      }

      setProcessingStage('done');
      setStatus('Done');
      setShowSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setStep('upload');
      setStatus('');
      setProcessingStage('idle');
    }
  }, [file, sourceLang, targetLang]);

  const reset = () => {
    setStep('upload');
    setFile(null);
    setHeadlines([]);
    setStatus('');
    setError(null);
    setProcessingStage('idle');
    imageUrls.forEach((url) => URL.revokeObjectURL(url));
    setImageUrls([]);
    setShowSuccess(false);
    setOcrFullText('');
    setResultsTab('chat');
    setDetectedLang(null);
    setSourceLang('auto');
  };

  const targetLangName = LANGUAGES.find((l) => l.code === targetLang)?.name || targetLang;

  const topicSummaryText = useMemo(() => {
    const summaries = buildTopicSummaries(headlines);
    if (summaries.length === 0) return '';
    return summaries.map((s) =>
      `${s.label} (${s.count} headlines): ${s.headlines.map((h) => h.translated || h.original).join('; ')}`
    ).join('\n');
  }, [headlines]);

  const topicsFound = useMemo(() => getTopicsFound(headlines), [headlines]);

  return (
    <div className="min-h-screen bg-surface bg-paisley">
      <SuccessAnimation show={showSuccess} />

      {/* Header */}
      <header className="bg-surface-elevated border-b border-border indian-border-top">
        <div className="max-w-4xl mx-auto px-4 py-3 sm:py-5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-display text-xl sm:text-2xl text-text-primary tracking-wide">
                Chat with a Regional Newspaper
              </h1>
              <p className="font-heading text-xs sm:text-sm text-text-secondary mt-0.5 italic hidden sm:block">
                Upload a regional newspaper. Ask questions. Get answers in any language.
              </p>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <DarkModeToggle />
              <span className="hidden sm:inline text-[10px] text-text-muted font-medium px-2.5 py-1 rounded-md bg-surface-muted border border-border tracking-wide uppercase">
                Sarvam AI
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-3 sm:px-4 py-4 sm:py-8 space-y-4 sm:space-y-6">
        {/* ── Upload + Language Selection ── */}
        {step !== 'results' && (
          <div className="space-y-6 animate-fade-in">
            <FileUpload
              onFileSelect={setFile}
              currentFile={file}
              disabled={isProcessing}
            />

            <LanguageSelector
              sourceLang={sourceLang}
              targetLang={targetLang}
              onSourceChange={setSourceLang}
              onTargetChange={setTargetLang}
              disabled={isProcessing}
              detectedLang={detectedLang}
            />

            <button
              onClick={processFile}
              disabled={!file || isProcessing}
              className={`w-full py-3.5 px-6 rounded-xl font-heading font-semibold text-[15px] tracking-wide transition-all duration-200 flex items-center justify-center gap-2
                ${!file || isProcessing
                  ? 'bg-primary/30 text-white/60 cursor-not-allowed'
                  : 'bg-primary hover:bg-primary-hover text-white shadow-sm hover:shadow-md active:scale-[0.98]'}
              `}
            >
              {isProcessing ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Processing...
                </>
              ) : (
                `Scan & Translate to ${targetLangName}`
              )}
            </button>
          </div>
        )}

        {/* ── Progress Steps ── */}
        <ProgressSteps stage={processingStage} statusText={status} />

        {/* ── Error ── */}
        {error && (
          <div className="bg-error/10 border border-error/20 rounded-xl p-4 flex items-start gap-3 animate-fade-in-scale">
            <svg className="w-5 h-5 text-error flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <p className="text-sm font-medium text-error">{error}</p>
          </div>
        )}

        {/* ── Results ── */}
        {step === 'results' && (
          <div className="space-y-5 animate-fade-in">
            {/* Top bar: scan info + new scan */}
            <div className="flex items-center justify-between gap-3">
              <p className="font-heading text-sm text-text-secondary italic">
                Full content extracted — chat in{' '}
                <span className="font-semibold text-primary not-italic">{targetLangName}</span>
              </p>
              <button
                onClick={reset}
                className="font-heading text-sm font-medium text-primary hover:text-primary-hover transition-colors flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                New scan
              </button>
            </div>

            {/* Tab switcher: Chat / Topics / Headlines */}
            <div className="flex bg-surface-muted rounded-lg border border-border p-0.5">
              <button
                onClick={() => setResultsTab('chat')}
                className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center justify-center gap-2 ${
                  resultsTab === 'chat'
                    ? 'bg-surface-elevated text-primary shadow-sm'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                Chat
              </button>
              <button
                onClick={() => setResultsTab('topics')}
                className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center justify-center gap-2 ${
                  resultsTab === 'topics'
                    ? 'bg-surface-elevated text-primary shadow-sm'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
                Topics
              </button>
              <button
                onClick={() => setResultsTab('headlines')}
                className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center justify-center gap-2 ${
                  resultsTab === 'headlines'
                    ? 'bg-surface-elevated text-primary shadow-sm'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
                Headlines ({headlines.length})
              </button>
            </div>

            {/* Chat tab */}
            {resultsTab === 'chat' && (
              <ChatInterface
                newspaperContext={ocrFullText}
                headlines={headlines.map((h) => h.translated || h.original)}
                targetLang={targetLang}
                targetLangName={targetLangName}
                topicSummary={topicSummaryText}
                topicsFound={topicsFound}
              />
            )}

            {/* Topics tab */}
            {resultsTab === 'topics' && (
              <TopicCards
                headlines={headlines}
                onSelectTopic={() => setResultsTab('headlines')}
              />
            )}

            {/* Headlines tab */}
            {resultsTab === 'headlines' && (
              <div className="space-y-5">
                <ImagePreview imageUrls={imageUrls} />

                <div className="ornament-divider">
                  <span className="text-accent text-xs">&#x2766;</span>
                </div>

                <HeadlineList
                  headlines={headlines}
                  showOriginals={showOriginals}
                  onToggleOriginals={() => setShowOriginals((v) => !v)}
                  sourceLang={sourceLang}
                  targetLang={targetLang}
                  file={file}
                />
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <footer className="pt-4 pb-6">
          <div className="ornament-divider mb-4">
            <span className="text-border-strong text-[10px]">&#x2022; &#x2022; &#x2022;</span>
          </div>
          <p className="text-center text-xs text-text-muted font-heading italic">
            {LANGUAGES.length} languages &middot; powered by Sarvam AI
          </p>
        </footer>
      </main>
    </div>
  );
}

export default App;
