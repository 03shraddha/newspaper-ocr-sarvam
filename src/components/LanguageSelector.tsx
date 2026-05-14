import { SOURCE_LANGUAGES, LANGUAGES } from '../lib/languages';

interface LanguageSelectorProps {
  sourceLang: string;
  targetLang: string;
  onSourceChange: (code: string) => void;
  onTargetChange: (code: string) => void;
  disabled?: boolean;
  detectedLang?: string | null;
}

export default function LanguageSelector({
  sourceLang, targetLang, onSourceChange, onTargetChange, disabled, detectedLang,
}: LanguageSelectorProps) {
  const sourceScript = SOURCE_LANGUAGES.find((l) => l.code === sourceLang)?.script || '?';
  const targetScript = LANGUAGES.find((l) => l.code === targetLang)?.script || 'A';

  return (
    <div className="flex flex-col sm:flex-row sm:items-end gap-3">
      <div className="flex-1">
        <label className="block text-xs font-heading font-medium text-text-muted uppercase tracking-wider mb-1.5">Source</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-sans text-primary opacity-70 pointer-events-none">
            {sourceScript}
          </span>
          <select
            value={sourceLang}
            onChange={(e) => onSourceChange(e.target.value)}
            disabled={disabled}
            className="w-full pl-10 pr-3 py-2.5 text-sm bg-surface-elevated border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50 transition-all"
          >
            {SOURCE_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.code === 'auto' ? 'Auto-detect' : `${l.name} (${l.nativeName})`}
              </option>
            ))}
          </select>
          {detectedLang && sourceLang === detectedLang && (
            <p className="text-[11px] text-success font-medium mt-1 flex items-center gap-1">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              Auto-detected
            </p>
          )}
        </div>
      </div>

      <div className="hidden sm:block pb-2.5">
        <div className="w-8 h-8 rounded-full bg-primary-light flex items-center justify-center">
          <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </div>
      </div>

      <div className="flex-1">
        <label className="block text-xs font-heading font-medium text-text-muted uppercase tracking-wider mb-1.5">Target</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-sans text-secondary opacity-70 pointer-events-none">
            {targetScript}
          </span>
          <select
            value={targetLang}
            onChange={(e) => onTargetChange(e.target.value)}
            disabled={disabled}
            className="w-full pl-10 pr-3 py-2.5 text-sm bg-surface-elevated border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50 transition-all"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name} ({l.nativeName})
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
