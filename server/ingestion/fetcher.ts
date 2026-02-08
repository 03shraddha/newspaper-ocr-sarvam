import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { NewspaperSource } from './sources.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOWNLOADS_DIR = path.resolve(__dirname, '../../data/downloads');

// Ensure downloads directory exists
fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

/**
 * Download a PDF from a newspaper source URL.
 * Returns the local file path, or null if download fails.
 */
export async function fetchPdf(source: NewspaperSource): Promise<string | null> {
  if (source.url === 'PLACEHOLDER_URL') {
    console.log(`Skipping "${source.name}" — placeholder URL`);
    return null;
  }

  try {
    const response = await fetch(source.url);
    if (!response.ok) {
      console.error(`Failed to fetch "${source.name}": ${response.status}`);
      return null;
    }

    const buffer = await response.arrayBuffer();
    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `${source.name.replace(/\s+/g, '_')}_${dateStr}.pdf`;
    const filePath = path.join(DOWNLOADS_DIR, fileName);

    fs.writeFileSync(filePath, Buffer.from(buffer));
    console.log(`Downloaded "${source.name}" → ${filePath}`);
    return filePath;
  } catch (err) {
    console.error(`Error fetching "${source.name}":`, (err as Error).message);
    return null;
  }
}

/**
 * Load a local PDF or image file for manual ingestion.
 */
export function loadLocalFile(filePath: string): Buffer | null {
  try {
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}
