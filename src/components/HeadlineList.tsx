import { useState, useMemo } from 'react';
import type { Headline, TopicKey } from '../lib/types';
import { TOPIC_META } from '../lib/topics';
import HeadlineCard from './HeadlineCard';

interface HeadlineListProps {
  headlines: Headline[];
  showOriginals: boolean;
  onToggleOriginals: () => void;
}

export default function HeadlineList({ headlines, showOriginals, onToggleOriginals }: HeadlineListProps) {
  const [copiedAll, setCopiedAll] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);

  const topicCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const h of headlines) {
      if (h.topic) counts.set(h.topic, (counts.get(h.topic) || 0) + 1);
    }
    return counts;
  }, [headlines]);

  const filteredHeadlines = selectedTopic
    ? headlines.filter((h) => h.topic === selectedTopic)
    : headlines;

  if (headlines.length === 0) return null;

  const allDone = headlines.every((h) => !h.isTranslating);

  const copyAll = () => {
    const text = headlines
      .map((h, i) => `${i + 1}. ${h.translated || h.original}`)
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const downloadTxt = () => {
    const lines = headlines.map((h, i) => {
      let line = `${i + 1}. ${h.translated || h.original}`;
      if (h.original && h.translated) line += `\n   Original: ${h.original}`;
      return line;
    });
    const content = `Newspaper Headlines\n${'='.repeat(40)}\n\n${lines.join('\n\n')}`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'headlines.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 animate-fade-in-scale">
      {/* Header with toggle and actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <h2 className="font-heading text-lg sm:text-xl font-semibold text-text-primary">
          Headlines
          <span className="ml-2 text-sm font-normal text-text-muted italic">({headlines.length})</span>
        </h2>

        <div className="flex items-center gap-3">
          {/* Copy all */}
          {allDone && (
            <button
              onClick={copyAll}
              className="flex items-center gap-1 text-xs font-medium text-text-muted hover:text-primary transition-colors"
              title="Copy all headlines"
            >
              {copiedAll ? (
                <>
                  <svg className="w-3.5 h-3.5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy all
                </>
              )}
            </button>
          )}

          {/* Download */}
          {allDone && (
            <button
              onClick={downloadTxt}
              className="flex items-center gap-1 text-xs font-medium text-text-muted hover:text-primary transition-colors"
              title="Download as text file"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download
            </button>
          )}

          {/* Toggle originals */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <span className="text-xs text-text-secondary">Show originals</span>
            <button
              onClick={onToggleOriginals}
              className={`relative w-9 h-5 rounded-full transition-colors duration-200 ${
                showOriginals ? 'bg-primary' : 'bg-border-strong'
              }`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${
                showOriginals ? 'translate-x-4' : 'translate-x-0'
              }`} />
            </button>
          </label>
        </div>
      </div>

      {/* Topic filter chips */}
      {topicCounts.size > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedTopic(null)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
              !selectedTopic
                ? 'bg-primary text-white border-primary'
                : 'bg-surface border-border text-text-secondary hover:border-primary/30'
            }`}
          >
            All ({headlines.length})
          </button>
          {Array.from(topicCounts.entries()).sort((a, b) => b[1] - a[1]).map(([topic, count]) => (
            <button
              key={topic}
              onClick={() => setSelectedTopic(selectedTopic === topic ? null : topic)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                selectedTopic === topic
                  ? 'bg-primary text-white border-primary'
                  : 'bg-surface border-border text-text-secondary hover:border-primary/30'
              }`}
            >
              {TOPIC_META[topic as TopicKey]?.icon} {TOPIC_META[topic as TopicKey]?.label} ({count})
            </button>
          ))}
        </div>
      )}

      {/* Headline cards */}
      <div className="space-y-3">
        {filteredHeadlines.map((h, i) => (
          <HeadlineCard key={h.id} headline={h} index={i} showOriginal={showOriginals} />
        ))}
      </div>
    </div>
  );
}
