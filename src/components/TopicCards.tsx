import { useMemo } from 'react';
import type { Headline } from '../lib/types';
import { buildTopicSummaries, type TopicSummary } from '../lib/topics';

interface TopicCardsProps {
  headlines: Headline[];
  onSelectTopic?: () => void;
}

export default function TopicCards({ headlines, onSelectTopic }: TopicCardsProps) {
  const summaries = useMemo(() => buildTopicSummaries(headlines), [headlines]);
  const uncategorized = headlines.filter((h) => !h.topic);

  if (summaries.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted font-heading animate-fade-in">
        <p className="text-lg">No topics identified</p>
        <p className="text-sm mt-1">Try the Chat tab to ask questions about the newspaper content</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in-scale">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {summaries.map((summary: TopicSummary) => (
          <div
            key={summary.topic}
            className="bg-surface-elevated rounded-xl border border-border p-4 card-accent hover:shadow-sm transition-all cursor-pointer"
            onClick={onSelectTopic}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">{summary.icon}</span>
              <h3 className="font-heading font-semibold text-text-primary">{summary.label}</h3>
              <span className="ml-auto text-xs font-medium text-text-muted bg-surface-muted px-2 py-0.5 rounded-full">
                {summary.count}
              </span>
            </div>
            <ul className="space-y-1">
              {summary.headlines.slice(0, 3).map((h) => (
                <li key={h.id} className="text-sm text-text-secondary truncate">
                  {h.translated || h.original}
                </li>
              ))}
              {summary.count > 3 && (
                <li className="text-xs text-text-muted italic">
                  +{summary.count - 3} more
                </li>
              )}
            </ul>
          </div>
        ))}
      </div>

      {uncategorized.length > 0 && (
        <p className="text-xs text-text-muted text-center font-heading">
          {uncategorized.length} headline{uncategorized.length !== 1 ? 's' : ''} not categorized
        </p>
      )}
    </div>
  );
}
