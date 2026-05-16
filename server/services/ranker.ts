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
