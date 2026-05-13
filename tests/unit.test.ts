import { describe, it, expect } from 'vitest';
import { extractHeadlines } from '../src/services/headlineParser.js';
import { classifyTopic, getAllTopics } from '../server/services/topicClassifier.js';

// ─── headlineParser ───────────────────────────────────────────────────────────

describe('extractHeadlines', () => {
  it('extracts h1 headings', () => {
    const md = '# Rain Floods Three Districts in Odisha\nSome body text here.';
    expect(extractHeadlines(md)).toEqual(['Rain Floods Three Districts in Odisha']);
  });

  it('extracts h2 and h3 headings', () => {
    const md = '## Farmers Demand MSP Hike\n### Students Boycott Exams Over Fee Hike';
    const result = extractHeadlines(md);
    expect(result).toContain('Farmers Demand MSP Hike');
    expect(result).toContain('Students Boycott Exams Over Fee Hike');
  });

  it('extracts bold standalone lines', () => {
    const md = '**Government Announces New Power Subsidy Scheme**\nBody text.';
    expect(extractHeadlines(md)).toEqual(['Government Announces New Power Subsidy Scheme']);
  });

  it('ignores bold inline text mixed with other content', () => {
    const md = 'The **minister** said something today.';
    expect(extractHeadlines(md)).toEqual([]);
  });

  it('ignores lines shorter than 10 characters', () => {
    const md = '# Short';
    expect(extractHeadlines(md)).toEqual([]);
  });

  it('deduplicates repeated headlines', () => {
    const md = '# Election Results Shock Nation\n# Election Results Shock Nation';
    expect(extractHeadlines(md)).toHaveLength(1);
  });

  it('strips bold markers from headings like ## **Headline**', () => {
    const md = '## **Monsoon Arrives Early in Kerala**';
    expect(extractHeadlines(md)).toEqual(['Monsoon Arrives Early in Kerala']);
  });

  it('returns empty array for empty input', () => {
    expect(extractHeadlines('')).toEqual([]);
  });

  it('handles real-world OCR noise gracefully', () => {
    const md = `
# State Budget Allocates Rs 500 Crore for Farmers
Some article body text that should be ignored entirely by the parser.

**Opposition Walks Out of Assembly Session**

---

## School Exam Results to Be Announced Tomorrow
`;
    const result = extractHeadlines(md);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe('State Budget Allocates Rs 500 Crore for Farmers');
    expect(result[1]).toBe('Opposition Walks Out of Assembly Session');
    expect(result[2]).toBe('School Exam Results to Be Announced Tomorrow');
  });
});

// ─── topicClassifier ──────────────────────────────────────────────────────────

describe('classifyTopic', () => {
  it('classifies water-related headlines', () => {
    expect(classifyTopic('Heavy rainfall causes flooding in three districts')).toBe('water');
    expect(classifyTopic('Drought hits Vidarbha region hard this year')).toBe('water');
  });

  it('classifies farmers-related headlines', () => {
    expect(classifyTopic('Farmers demand MSP hike for wheat crop')).toBe('farmers');
    expect(classifyTopic('Kisan rally in Delhi demands fertilizer subsidy')).toBe('farmers');
  });

  it('classifies politics-related headlines', () => {
    expect(classifyTopic('Chief minister announces new cabinet reshuffle')).toBe('politics');
    expect(classifyTopic('Election results expected by evening vote count')).toBe('politics');
  });

  it('classifies sports-related headlines', () => {
    expect(classifyTopic('India wins cricket test match against Australia')).toBe('sports');
    expect(classifyTopic('IPL final ticket sales open today at stadium')).toBe('sports');
  });

  it('classifies economy-related headlines', () => {
    expect(classifyTopic('RBI raises repo rate to curb inflation')).toBe('economy');
    expect(classifyTopic('Stock market hits all-time high amid strong GDP growth')).toBe('economy');
  });

  it('classifies health-related headlines', () => {
    expect(classifyTopic('New hospital opens in district with 200 beds')).toBe('health');
    expect(classifyTopic('Vaccine drive begins for children under 12')).toBe('health');
  });

  it('classifies education-related headlines', () => {
    expect(classifyTopic('Board exam results announced, 95% pass rate')).toBe('education');
    expect(classifyTopic('NEET 2026 registration deadline extended by a week')).toBe('education');
  });

  it('classifies power-related headlines', () => {
    expect(classifyTopic('Power cut scheduled for maintenance in city')).toBe('power');
    expect(classifyTopic('Solar energy plant inaugurated by minister')).toBe('power');
  });

  it('returns null for unclassifiable text', () => {
    expect(classifyTopic('Random text without any keywords here')).toBeNull();
    expect(classifyTopic('')).toBeNull();
  });

  it('prefers multi-word keyword matches over single-word matches', () => {
    // "drinking water" should score higher than just "water"
    const result = classifyTopic('Drinking water supply disrupted in colony');
    expect(result).toBe('water');
  });

  it('getAllTopics returns all 8 topics', () => {
    const topics = getAllTopics();
    expect(topics).toHaveLength(8);
    expect(topics).toContain('water');
    expect(topics).toContain('farmers');
    expect(topics).toContain('politics');
    expect(topics).toContain('sports');
    expect(topics).toContain('economy');
    expect(topics).toContain('education');
    expect(topics).toContain('health');
    expect(topics).toContain('power');
  });
});
