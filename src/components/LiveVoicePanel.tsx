import { useState } from 'react';
import { useSTT } from '../hooks/useSTT';

interface LiveVoicePanelProps {
  targetLang: string;
  onTranscript: (text: string) => void;
  onClose: () => void;
}

export default function LiveVoicePanel({ targetLang, onTranscript, onClose }: LiveVoicePanelProps) {
  const { isRecording, isTranscribing, error, startRecording, stopRecording, transcribe, cleanup } = useSTT();
  const [transcript, setTranscript] = useState<string | null>(null);

  const handleStart = async () => {
    setTranscript(null);
    await startRecording();
  };

  const handleStop = async () => {
    try {
      const blob = await stopRecording();
      if (blob.size < 1000) return;
      const result = await transcribe(blob, targetLang);
      if (result) setTranscript(result);
    } catch { /* error state handled in hook */ }
  };

  const handleUse = () => {
    if (transcript?.trim()) onTranscript(transcript.trim());
    cleanup();
    onClose();
  };

  const handleClose = () => {
    cleanup();
    onClose();
  };

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 bg-surface-elevated border border-border rounded-xl p-4 shadow-lg animate-fade-in-scale z-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              isRecording ? 'bg-error animate-pulse' : isTranscribing ? 'bg-primary animate-pulse' : 'bg-border'
            }`}
          />
          <span className="text-sm font-medium text-text-primary">Voice Input</span>
          {isRecording && (
            <span className="text-[10px] text-error font-medium px-1.5 py-0.5 bg-error/10 rounded-full">REC</span>
          )}
          {isTranscribing && (
            <span className="text-[10px] text-primary font-medium px-1.5 py-0.5 bg-primary/10 rounded-full">Transcribing…</span>
          )}
        </div>
        <button onClick={handleClose} className="text-text-muted hover:text-text-primary transition-colors" title="Close">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Transcript display */}
      <div className="min-h-[64px] max-h-[120px] overflow-y-auto bg-surface rounded-lg p-3 mb-3 text-sm leading-relaxed font-heading">
        {error ? (
          <span className="text-error text-xs">{error}</span>
        ) : transcript ? (
          <span className="text-text-primary">{transcript}</span>
        ) : (
          <span className="text-text-muted italic text-xs">
            {isRecording
              ? 'Recording — click Stop when done'
              : isTranscribing
              ? 'Transcribing…'
              : 'Press Start to speak'}
          </span>
        )}
      </div>

      {/* Buttons */}
      <div className="flex gap-2">
        {!isRecording && !isTranscribing && !transcript && (
          <button
            onClick={handleStart}
            className="flex-1 py-2 rounded-lg text-sm font-medium bg-primary text-white hover:bg-primary-hover transition-all flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
            Start Listening
          </button>
        )}
        {isRecording && (
          <button
            onClick={handleStop}
            className="flex-1 py-2 rounded-lg text-sm font-medium bg-error text-white hover:bg-error/80 transition-all flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
            Stop Recording
          </button>
        )}
        {transcript && !isRecording && (
          <>
            <button
              onClick={handleUse}
              className="flex-1 py-2 rounded-lg text-sm font-medium bg-primary text-white hover:bg-primary-hover transition-all flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Use Transcript
            </button>
            <button
              onClick={() => setTranscript(null)}
              className="px-3 py-2 rounded-lg text-sm font-medium bg-surface-muted border border-border text-text-secondary hover:bg-surface transition-all"
            >
              Retry
            </button>
          </>
        )}
        {isTranscribing && (
          <div className="flex-1 py-2 rounded-lg text-sm text-text-muted text-center">Processing…</div>
        )}
      </div>
    </div>
  );
}
