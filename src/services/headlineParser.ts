/**
 * Extract headlines from markdown OCR output.
 * Headlines appear as # headings or **bold** standalone lines.
 */
export function extractHeadlines(markdown: string): string[] {
  const lines = markdown.split('\n');
  const headlines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Match markdown headings: # Headline, ## Headline, ### Headline
    const headingMatch = trimmed.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch) {
      const text = headingMatch[1].replace(/\*{2}/g, '').replace(/_{2}/g, '').trim();
      if (text.length >= 10) headlines.push(text);
      continue;
    }

    // Match entirely bold lines: **Headline text** or __Headline text__
    const boldMatch = trimmed.match(/^\*\*(.+)\*\*$/) || trimmed.match(/^__(.+)__$/);
    if (boldMatch) {
      const text = boldMatch[1].trim();
      if (text.length >= 10) headlines.push(text);
    }
  }

  // Deduplicate
  return [...new Set(headlines)];
}
