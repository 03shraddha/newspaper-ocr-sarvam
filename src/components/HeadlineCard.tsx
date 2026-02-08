import { useState } from 'react';
import type { Headline, TopicKey } from '../lib/types';
import { TOPIC_META } from '../lib/topics';

interface HeadlineCardProps {
  headline: Headline;
  index: number;
  showOriginal: boolean;
}

export default function HeadlineCard({ headline, index, showOriginal }: HeadlineCardProps) {
  const [copied, setCopied] = useState(false);

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
        </div>

        {/* Copy button */}
        {!headline.isTranslating && (
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
        )}
      </div>
    </div>
  );
}
