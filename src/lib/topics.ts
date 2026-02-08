import type { Headline, TopicKey } from './types';

export const TOPIC_META: Record<TopicKey, { label: string; icon: string; color: string }> = {
  water:     { label: 'Water',     icon: '\u{1F4A7}', color: 'blue' },
  power:     { label: 'Power',     icon: '\u{26A1}',  color: 'yellow' },
  farmers:   { label: 'Farmers',   icon: '\u{1F33E}', color: 'green' },
  politics:  { label: 'Politics',  icon: '\u{1F3DB}', color: 'purple' },
  sports:    { label: 'Sports',    icon: '\u{1F3CF}', color: 'orange' },
  economy:   { label: 'Economy',   icon: '\u{1F4C8}', color: 'teal' },
  education: { label: 'Education', icon: '\u{1F393}', color: 'indigo' },
  health:    { label: 'Health',    icon: '\u{1FA7A}', color: 'red' },
};

export interface TopicSummary {
  topic: TopicKey;
  label: string;
  icon: string;
  count: number;
  headlines: Headline[];
}

export function buildTopicSummaries(headlines: Headline[]): TopicSummary[] {
  const grouped = new Map<TopicKey, Headline[]>();

  for (const h of headlines) {
    if (h.topic && h.topic in TOPIC_META) {
      const key = h.topic as TopicKey;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(h);
    }
  }

  return Array.from(grouped.entries())
    .map(([topic, topicHeadlines]) => ({
      topic,
      label: TOPIC_META[topic].label,
      icon: TOPIC_META[topic].icon,
      count: topicHeadlines.length,
      headlines: topicHeadlines,
    }))
    .sort((a, b) => b.count - a.count);
}

export function getTopicsFound(headlines: Headline[]): TopicKey[] {
  const topics = new Set<TopicKey>();
  for (const h of headlines) {
    if (h.topic && h.topic in TOPIC_META) topics.add(h.topic as TopicKey);
  }
  return Array.from(topics);
}
