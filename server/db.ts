import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../data/samachar.db');

// Ensure data directory exists
import fs from 'fs';
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS papers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    region TEXT NOT NULL,
    language TEXT NOT NULL,
    source_url TEXT,
    fetched_at TEXT DEFAULT (datetime('now')),
    page_count INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id INTEGER NOT NULL,
    page_number INTEGER NOT NULL,
    ocr_text TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS headlines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id INTEGER,
    paper_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    english_text TEXT,
    source TEXT DEFAULT 'markdown',
    topic TEXT,
    page_number INTEGER DEFAULT 1,
    score REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE,
    FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS translations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    headline_id INTEGER NOT NULL,
    target_lang TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (headline_id) REFERENCES headlines(id) ON DELETE CASCADE,
    UNIQUE(headline_id, target_lang)
  );

  CREATE INDEX IF NOT EXISTS idx_headlines_paper ON headlines(paper_id);
  CREATE INDEX IF NOT EXISTS idx_headlines_topic ON headlines(topic);
  CREATE INDEX IF NOT EXISTS idx_translations_headline ON translations(headline_id);
`);

// ── Paper queries ──

export function insertPaper(name: string, region: string, language: string, sourceUrl?: string) {
  const stmt = db.prepare(
    'INSERT INTO papers (name, region, language, source_url) VALUES (?, ?, ?, ?)'
  );
  return stmt.run(name, region, language, sourceUrl || null);
}

export function getAllPapers() {
  return db.prepare('SELECT * FROM papers ORDER BY fetched_at DESC').all();
}

export function getPapersByRegion(region: string) {
  return db.prepare('SELECT * FROM papers WHERE region = ? ORDER BY fetched_at DESC').all(region);
}

// ── Page queries ──

export function insertPage(paperId: number, pageNumber: number, ocrText: string) {
  const stmt = db.prepare(
    'INSERT INTO pages (paper_id, page_number, ocr_text) VALUES (?, ?, ?)'
  );
  return stmt.run(paperId, pageNumber, ocrText);
}

// ── Headline queries ──

export function insertHeadline(
  paperId: number,
  pageId: number | null,
  text: string,
  englishText: string | null,
  source: string,
  topic: string | null,
  pageNumber: number,
  score: number
) {
  const stmt = db.prepare(
    `INSERT INTO headlines (paper_id, page_id, text, english_text, source, topic, page_number, score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  return stmt.run(paperId, pageId, text, englishText, source, topic, pageNumber, score);
}

export function getHeadlines(filters: {
  region?: string;
  topic?: string;
  paperId?: number;
  limit?: number;
}) {
  let query = `
    SELECT h.*, p.name as paper_name, p.region, p.language as paper_language
    FROM headlines h
    JOIN papers p ON h.paper_id = p.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (filters.region) {
    query += ' AND p.region = ?';
    params.push(filters.region);
  }
  if (filters.topic) {
    query += ' AND h.topic = ?';
    params.push(filters.topic);
  }
  if (filters.paperId) {
    query += ' AND h.paper_id = ?';
    params.push(filters.paperId);
  }

  query += ' ORDER BY h.score DESC, h.created_at DESC';

  if (filters.limit) {
    query += ' LIMIT ?';
    params.push(filters.limit);
  }

  return db.prepare(query).all(...params);
}

// ── Translation queries ──

export function insertTranslation(headlineId: number, targetLang: string, translatedText: string) {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO translations (headline_id, target_lang, translated_text)
     VALUES (?, ?, ?)`
  );
  return stmt.run(headlineId, targetLang, translatedText);
}

export function getTranslation(headlineId: number, targetLang: string) {
  return db.prepare(
    'SELECT * FROM translations WHERE headline_id = ? AND target_lang = ?'
  ).get(headlineId, targetLang);
}

// ── Utility queries ──

export function getDistinctRegions(): string[] {
  const rows = db.prepare('SELECT DISTINCT region FROM papers ORDER BY region').all() as { region: string }[];
  return rows.map((r) => r.region);
}

export function getDistinctTopics(): string[] {
  const rows = db.prepare('SELECT DISTINCT topic FROM headlines WHERE topic IS NOT NULL ORDER BY topic').all() as { topic: string }[];
  return rows.map((r) => r.topic);
}

export function clearAllData() {
  db.exec('DELETE FROM translations; DELETE FROM headlines; DELETE FROM pages; DELETE FROM papers;');
}

export default db;
