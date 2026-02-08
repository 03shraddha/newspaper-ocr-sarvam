export interface Headline {
  id: string;
  original: string;
  translated: string;
  isTranslating: boolean;
  page?: number;
  source?: 'markdown' | 'ai';
  topic?: string | null;
  englishText?: string;
}

export type TopicKey = 'water' | 'power' | 'farmers' | 'politics' | 'sports' | 'economy' | 'education' | 'health';

export interface Language {
  code: string;
  name: string;
  nativeName: string;
  script?: string;
}

export type AppStep = 'upload' | 'processing' | 'results';

export type ProcessingStage = 'idle' | 'converting' | 'ocr' | 'parsing' | 'classifying' | 'translating' | 'done';

// ── Chat types ──

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isLocal?: boolean;
}
