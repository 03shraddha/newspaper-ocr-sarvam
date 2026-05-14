import { useState } from 'react';
import type { Headline, TopicKey } from '../lib/types';
import { TOPIC_META } from '../lib/topics';
import { useTransliterate } from '../hooks/useTransliterate';
import { useTTS } from '../hooks/useTTS';

interface HeadlineCardProps {
  headline: Headline;
  index: number;
  showOriginal: boolean;
  sourceLang?: string;
  targetLang?: string;
}

export default function HeadlineCard({ headline, index, showOriginal, sourceLang, targetLang }: HeadlineCardProps) {
  const [copied, setCopied] = useState(false);
  const { transliterateText } = useTransliterate();
  const { speakText, speakingId, stopSpeaking } = useTTS();
  const isThisSpeaking = speakingId === headline.id;
  const [showRoman, setShowRoman] = useState(false);
  const [romanized, setRomanized] = useState<string | null>(null);
  const [isTransliterating, setIsTransliterating] = useState(false);

  const handleRomanToggle = async () => {
    if (showRoman) { setShowRoman(false); return; }
    if (romanized) { setShowRoman(true); return; } // cached
    setIsTransliterating(true);
    const textToTransliterate = headline.translated || headline.original;
    const result = await transliterateText(textToTransliterate, sourceLang || 'hi-IN');
    setRomanized(result);
    setIsTransliterating(false);
    setShowRoman(true);
  };

  const copyText = () => {
    const text = headline.translated || headline.original;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const staggerClass = `stagger-${Math.min(index + 1, 10)}`;

  return (
    <div className={`bg-surface-elevated rounded-xl border border-border p-4 card-accent transition-all hover:shadow-sm group animate-slide-in-up ${staggerClass}`}>
      <div className="flex items-start gap-3">
        {/* Number badge */}
        <span className="flex-shrink-0 w-7 h-7 rounded-lg bg-primary-light text-primary text-xs font-bold flex items-center justify-center mt-0.5">
          {index + 1}
        </span>

        <div className="flex-1 min-w-0">
          {/* Source badge + page badge */}
          <div className="flex items-center gap-2 mb-1.5">
            {headline.page !== undefined && (
              <span className="text-[10px] font-medium text-text-muted bg-surface-muted px-1.5 py-0.5 rounded">
                Page {headline.page}
              </span>
            )}
            {headline.source && (
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                headline.source === 'ai'
                  ? 'text-accent bg-accent-light'
                  : 'text-secondary bg-secondary-light'
              }`}>
                {headline.source === 'ai' ? 'AI extracted' : 'Direct'}
              </span>
            )}
            {headline.topic && TOPIC_META[headline.topic as TopicKey] && (
              <span className="text-[10px] font-medium text-primary bg-primary-light px-1.5 py-0.5 rounded">
                {TOPIC_META[headline.topic as TopicKey].icon} {TOPIC_META[headline.topic as TopicKey].label}
              </span>
            )}
          </div>

          {/* Original text */}
          {showOriginal && (
            <p className="font-sans text-sm text-text-muted mb-2 leading-relaxed">
              {headline.original}
            </p>
          )}

          {/* Translated text or skeleton */}
          {headline.isTranslating ? (
            <div className="space-y-2">
              <div className="h-4 rounded w-full animate-shimmer" />
              <div className="h-4 rounded w-3/4 animate-shimmer" />
            </div>
          ) : headline.translated ? (
            <p className="font-sans text-[17px] font-medium text-text-primary leading-relaxed">
              {headline.translated}
            </p>
          ) : (
            <p className="font-sans text-[17px] font-medium text-text-primary leading-relaxed">
              {headline.original}
            </p>
          )}

          {/* Transliteration toggle — only show when not translating */}
          {!headline.isTranslating && (
            <div className="mt-1.5 flex items-center gap-2">
              <button
                onClick={handleRomanToggle}
                disabled={isTransliterating}
                className="text-[11px] font-medium text-text-muted hover:text-primary transition-colors flex items-center gap-1 disabled:opacity-50"
                title={showRoman ? "Show original script" : "Show in Roman script"}
              >
                {isTransliterating ? (
                  <span className="animate-pulse">Converting...</span>
                ) : (
                  <>
                    <span className={showRoman ? 'text-primary' : ''}>{showRoman ? 'अ' : 'Aa'}</span>
                    <span>{showRoman ? 'Native' : 'Roman'}</span>
                  </>
                )}
              </button>
              {showRoman && romanized && (
                <p className="text-sm text-text-secondary italic font-sans">{romanized}</p>
              )}
            </div>
          )}
        </div>

        {/* TTS speaker button + Copy button */}
        {!headline.isTranslating && (
          <>
            {/* Speaker button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (isThisSpeaking) { stopSpeaking(); return; }
                const textToSpeak = headline.translated || headline.original;
                speakText(textToSpeak, targetLang || 'en-IN', headline.id);
              }}
              className={`flex-shrink-0 p-1.5 rounded-lg transition-all opacity-0 group-hover:opacity-100 ${
                isThisSpeaking
                  ? 'text-primary bg-primary-light opacity-100'
                  : 'text-text-muted hover:text-primary hover:bg-primary-light'
              }`}
              title={isThisSpeaking ? 'Stop speaking' : 'Read aloud'}
            >
              {isThisSpeaking ? (
                <svg className="w-4 h-4 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M12 6a7 7 0 010 14M9.464 9.536a3 3 0 010 4.928" />
                </svg>
              )}
            </button>

            {/* Copy button */}
            <button
              onClick={(e) => { e.stopPropagation(); copyText(); }}
              className="flex-shrink-0 p-1.5 rounded-lg text-text-muted hover:text-primary hover:bg-primary-light transition-all opacity-0 group-hover:opacity-100"
              title="Copy headline"
            >
              {copied ? (
                <svg className="w-4 h-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
