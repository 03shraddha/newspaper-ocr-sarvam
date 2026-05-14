import type { ProcessingStage } from '../lib/types';

interface ProgressStepsProps {
  stage: ProcessingStage;
  statusText: string;
}

const STEPS = [
  { key: 'converting', label: 'Upload', model: null },
  { key: 'ocr', label: 'OCR', model: 'sarvam-vision 3B' },
  { key: 'parsing', label: 'Headlines', model: 'sarvam-30b' },
  { key: 'classifying', label: 'Topics', model: 'keyword match' },
  { key: 'translating', label: 'Translate', model: 'mayura:v1' },
] as const;

const stageOrder: Record<string, number> = {
  idle: -1,
  converting: 0,
  ocr: 1,
  parsing: 2,
  classifying: 3,
  translating: 4,
  done: 5,
};

export default function ProgressSteps({ stage, statusText }: ProgressStepsProps) {
  if (stage === 'idle') return null;

  const currentIndex = stageOrder[stage] ?? -1;

  return (
    <div className="animate-fade-in-scale">
      <div className="flex items-center justify-between mb-4">
        {STEPS.map((step, i) => {
          const isComplete = currentIndex > i;
          const isCurrent = currentIndex === i;
          const isPending = currentIndex < i;

          return (
            <div key={step.key} className="flex items-center flex-1 last:flex-initial">
              <div className="flex flex-col items-center">
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-500 ${
                    isComplete
                      ? 'bg-secondary text-white'
                      : isCurrent
                        ? 'bg-primary text-white animate-pulse-glow'
                        : 'bg-surface-muted text-text-muted border border-border'
                  }`}
                >
                  {isComplete ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    String(i + 1)
                  )}
                </div>
                <span className={`text-[10px] font-medium mt-1 ${
                  isCurrent ? 'text-primary' : isComplete ? 'text-secondary' : 'text-text-muted'
                }`}>
                  {step.label}
                </span>
                {step.model && (isCurrent || isComplete) && (
                  <span className={`text-[8px] font-mono px-1 rounded mt-0.5 leading-tight ${
                    isCurrent
                      ? 'bg-primary-light/70 text-primary'
                      : 'bg-secondary/10 text-secondary'
                  }`}>
                    {step.model}
                  </span>
                )}
              </div>
              {i < STEPS.length - 1 && (
                <div className="flex-1 h-0.5 mx-2 mb-4 rounded-full overflow-hidden bg-border">
                  <div
                    className="h-full bg-secondary transition-all duration-700 ease-out rounded-full"
                    style={{ width: isPending ? '0%' : isComplete ? '100%' : '50%' }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-all duration-300 ${
        stage === 'done'
          ? 'bg-secondary-light text-secondary'
          : 'bg-primary-light text-primary'
      }`}>
        {stage !== 'done' ? (
          <svg className="w-4 h-4 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
        <span className="font-medium">{statusText}</span>
      </div>
    </div>
  );
}
