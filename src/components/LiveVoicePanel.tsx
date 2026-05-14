/**
 * LiveVoicePanel — Floating panel for real-time streaming speech-to-text input.
 *
 * Connects to the backend WebSocket proxy (/ws/stt) which forwards audio to
 * Sarvam's streaming STT API (wss://api.sarvam.ai/speech-to-text/ws).
 *
 * Usage: Place inside a `relative`-positioned container. The panel appears
 * above the input area. When the user clicks "Stop & Use", the accumulated
 * transcript is passed to onTranscript() and the panel closes.
 */

import { useSTTStream } from '../hooks/useSTTStream';

interface LiveVoicePanelProps {
  targetLang: string;
  onTranscript: (text: string) => void;
  onClose: () => void;
}

export default function LiveVoicePanel({ targetLang, onTranscript, onClose }: LiveVoicePanelProps) {
  const {
    isConnected,
    isStreaming,
    isSpeechDetected,
    liveTranscript,
    finalTranscript,
    error,
    start,
    stop,
    clearError,
  } = useSTTStream();

  const handleStart = async () => {
    clearError();
    try {
      await start(targetLang);
    } catch {
      // error state is set inside the hook
    }
  };

  const handleStop = () => {
    const result = stop();
    if (result.trim()) {
      onTranscript(result.trim());
    }
    onClose();
  };

  const handleClose = () => {
    if (isStreaming) stop();
    onClose();
  };

  const hasContent = !!(finalTranscript || liveTranscript);

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 bg-surface-elevated border border-border rounded-xl p-4 shadow-lg animate-fade-in-scale z-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {/* Animated mic dot */}
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              isSpeechDetected
                ? 'bg-error animate-pulse'
                : isStreaming
                ? 'bg-primary animate-pulse'
                : 'bg-border'
            }`}
          />
          <span className="text-sm font-medium text-text-primary">Live Voice Input</span>
          {isConnected && isStreaming && (
            <span className="text-[10px] text-success font-medium px-1.5 py-0.5 bg-success/10 rounded-full">
              LIVE
            </span>
          )}
        </div>
        <button
          onClick={handleClose}
          className="text-text-muted hover:text-text-primary transition-colors"
          title="Close"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Transcript display */}
      <div className="min-h-[64px] max-h-[120px] overflow-y-auto bg-surface rounded-lg p-3 mb-3 text-sm leading-relaxed font-heading">
        {error ? (
          <span className="text-error text-xs">{error}</span>
        ) : hasContent ? (
          <>
            {finalTranscript && (
              <span className="text-text-primary">{finalTranscript}</span>
            )}
            {liveTranscript && (
              <span className="text-text-secondary italic ml-1">{liveTranscript}</span>
            )}
          </>
        ) : (
          <span className="text-text-muted italic text-xs">
            {isStreaming
              ? isSpeechDetected
                ? 'Capturing speech…'
                : 'Listening — speak now'
              : 'Press Start to speak'}
          </span>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        {!isStreaming ? (
          <button
            onClick={handleStart}
            className="flex-1 py-2 rounded-lg text-sm font-medium bg-primary text-white hover:bg-primary-hover transition-all flex items-center justify-center gap-2"
          >
            {/* Mic icon */}
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
            Start Listening
          </button>
        ) : (
          <>
            <button
              onClick={handleStop}
              disabled={!finalTranscript.trim() && !liveTranscript}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                finalTranscript.trim()
                  ? 'bg-primary text-white hover:bg-primary-hover'
                  : 'bg-border text-text-muted cursor-not-allowed'
              }`}
            >
              {/* Check icon */}
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Use Transcript
            </button>
            <button
              onClick={() => { stop(); }}
              className="px-3 py-2 rounded-lg text-sm font-medium bg-error/10 text-error hover:bg-error/20 transition-all flex items-center justify-center gap-1.5"
              title="Stop recording"
            >
              {/* Stop icon */}
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
              Stop
            </button>
          </>
        )}
      </div>
    </div>
  );
}
