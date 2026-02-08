import { insertPaper, insertPage, insertHeadline } from '../db.js';
import { classifyTopic } from '../services/topicClassifier.js';
import { scoreHeadline } from '../services/ranker.js';
import type { NewspaperSource } from './sources.js';

// Reuse the headline extraction logic from the frontend
function extractHeadlinesFromMarkdown(markdown: string): string[] {
  const lines = markdown.split('\n');
  const headlines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const headingMatch = trimmed.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch) {
      const text = headingMatch[1].replace(/\*{2}/g, '').replace(/_{2}/g, '').trim();
      if (text.length >= 10) headlines.push(text);
      continue;
    }

    const boldMatch = trimmed.match(/^\*\*(.+)\*\*$/) || trimmed.match(/^__(.+)__$/);
    if (boldMatch) {
      const text = boldMatch[1].trim();
      if (text.length >= 10) headlines.push(text);
    }
  }

  return [...new Set(headlines)];
}

/**
 * Process a newspaper: OCR pages, extract headlines, classify topics, store in DB.
 * Called by the ingestion pipeline with pre-fetched page images.
 */
export async function processNewspaper(
  source: NewspaperSource,
  pageTexts: { pageNumber: number; ocrText: string }[],
  translateFn: (text: string, sourceLang: string, targetLang: string) => Promise<string>,
) {
  // Insert paper record
  const paperResult = insertPaper(source.name, source.region, source.language, source.url);
  const paperId = paperResult.lastInsertRowid as number;

  let totalHeadlines = 0;

  for (const page of pageTexts) {
    // Insert page
    const pageResult = insertPage(paperId, page.pageNumber, page.ocrText);
    const pageId = pageResult.lastInsertRowid as number;

    // Extract headlines from this page
    const headlineTexts = extractHeadlinesFromMarkdown(page.ocrText);

    for (const text of headlineTexts) {
      // Translate to English for topic classification
      let englishText: string | null = null;
      let topic: string | null = null;

      try {
        if (source.language !== 'en-IN') {
          englishText = await translateFn(text, source.language, 'en-IN');
          topic = classifyTopic(englishText);
        } else {
          englishText = text;
          topic = classifyTopic(text);
        }
      } catch {
        // If translation fails, still store the headline without English/topic
      }

      const headlineScore = scoreHeadline({
        pageNumber: page.pageNumber,
        createdAt: new Date().toISOString(),
      });

      insertHeadline(
        paperId,
        pageId,
        text,
        englishText,
        'markdown',
        topic,
        page.pageNumber,
        headlineScore,
      );
      totalHeadlines++;
    }
  }

  console.log(`Processed "${source.name}": ${pageTexts.length} pages, ${totalHeadlines} headlines`);
  return { paperId, totalHeadlines };
}
