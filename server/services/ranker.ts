interface HeadlineRow {
  id: number;
  text: string;
  english_text: string | null;
  page_number: number;
  paper_name: string;
  region: string;
  created_at: string;
  score: number;
  [key: string]: any;
}

/**
 * Score a headline based on position, recency, and importance signals.
 */
export function scoreHeadline(headline: {
  pageNumber: number;
  createdAt: string;
}): number {
  let score = 0;

  // Front page weight
  if (headline.pageNumber === 1) score += 10;
  else if (headline.pageNumber === 2) score += 5;
  else score += 1;

  // Recency
  const now = new Date();
  const created = new Date(headline.createdAt);
  const hoursAgo = (now.getTime() - created.getTime()) / (1000 * 60 * 60);

  if (hoursAgo < 24) score += 10;
  else if (hoursAgo < 48) score += 5;
  else score += 1;

  return score;
}

/**
 * Rank an array of headlines, accounting for cross-paper repetition.
 * Headlines appearing in multiple papers get a boost.
 */
export function rankHeadlines(headlines: HeadlineRow[], limit = 10): HeadlineRow[] {
  // Group similar headlines (simple: check if english_text overlaps significantly)
  const textGroups = new Map<string, HeadlineRow[]>();

  for (const h of headlines) {
    const key = (h.english_text || h.text).toLowerCase().trim().slice(0, 50);
    const group = textGroups.get(key) || [];
    group.push(h);
    textGroups.set(key, group);
  }

  // Score each headline, adding cross-paper bonus
  const scored = headlines.map((h) => {
    const key = (h.english_text || h.text).toLowerCase().trim().slice(0, 50);
    const group = textGroups.get(key) || [h];
    const crossPaperBonus = (group.length - 1) * 5; // +5 per additional paper

    return {
      ...h,
      score: h.score + crossPaperBonus,
    };
  });

  // Deduplicate: keep highest-scored version of each similar headline
  const seen = new Set<string>();
  const deduped = scored.filter((h) => {
    const key = (h.english_text || h.text).toLowerCase().trim().slice(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by score descending
  deduped.sort((a, b) => b.score - a.score);

  return deduped.slice(0, limit);
}
