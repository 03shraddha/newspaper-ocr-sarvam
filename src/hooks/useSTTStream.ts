/**
 * useSTTStream — Real-time streaming STT via Sarvam WebSocket proxy
 *
 * Flow:
 *   1. Connect WebSocket to /ws/stt?lang=<langCode> (proxied to Sarvam via backend)
 *   2. Wait for { type: "connected" } from the backend proxy
 *   3. Capture mic via AudioContext at 16 kHz, convert Float32 → Int16 PCM
 *   4. Send raw PCM binary frames to the WebSocket
 *   5. Backend proxy base64-encodes and forwards to Sarvam; relays transcripts back
 *   6. Each { type: "transcript", transcript, is_final: true } appends to finalTranscript
 *   7. VAD { type: "vad", signal: "START_SPEECH"|"END_SPEECH" } updates listening indicator
 *
 * Audio pipeline:
 *   MediaStream (16 kHz mono) → MediaStreamAudioSourceNode
 *     → ScriptProcessorNode (4096 samples = 256 ms chunks)
 *     → Float32 → Int16Array → WebSocket.send(ArrayBuffer)
 *
 * NOTE: ScriptProcessorNode is deprecated in favour of AudioWorklet but remains
 * universally supported and requires no additional setup/worker files. This is
 * intentional for simplicity. Migrate to AudioWorklet if latency becomes an issue.
 */

import { useState, useRef, useEffect, useCallback } from 'react';

export interface STTStreamState {
  isConnected: boolean;
  isStreaming: boolean;
  isSpeechDetected: boolean;
  liveTranscript: string;   // interim display text (resets after each segment)
  finalTranscript: string;  // accumulates final segments while streaming
  error: string | null;
}

export interface STTStreamControls {
  start: (langCode: string) => Promise<void>;
  stop: () => string;        // returns the accumulated finalTranscript then resets
  clearError: () => void;
}

export function useSTTStream(): STTStreamState & STTStreamControls {
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isSpeechDetected, setIsSpeechDetected] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Refs for resources that must survive re-renders and be cleaned up on stop
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  // Keep a sync copy of finalTranscript so stop() can return it without stale closure
  const finalTranscriptRef = useRef('');

  // Keep finalTranscriptRef in sync with state
  useEffect(() => {
    finalTranscriptRef.current = finalTranscript;
  }, [finalTranscript]);

  const cleanupAudio = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => { /* ignore */ });
    }
    audioContextRef.current = null;
  }, []);

  const cleanupWS = useCallback(() => {
    if (wsRef.current) {
      // Remove handlers before closing to avoid triggering state updates
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.onclose = null;
      if (wsRef.current.readyState === WebSocket.OPEN ||
          wsRef.current.readyState === WebSocket.CONNECTING) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }
  }, []);

  const start = useCallback(async (langCode: string): Promise<void> => {
    // Reset state
    setError(null);
    setLiveTranscript('');
    setFinalTranscript('');
    finalTranscriptRef.current = '';
    setIsSpeechDetected(false);

    // Build WebSocket URL — proxied through Vite dev server (and Express in prod)
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws/stt?lang=${encodeURIComponent(langCode)}`;

    return new Promise<void>((resolve, reject) => {
      let micStarted = false;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type: string;
            transcript?: string;
            is_final?: boolean;
            language_code?: string;
            signal?: string;
            message?: string;
          };

          switch (msg.type) {
            case 'connected':
              setIsConnected(true);
              // Now safe to start the mic
              if (!micStarted) {
                micStarted = true;
                startMic(ws).then(resolve).catch((err: unknown) => {
                  setError(err instanceof Error ? err.message : 'Microphone access denied');
                  cleanupWS();
                  reject(err);
                });
              }
              break;

            case 'transcript':
              if (msg.transcript) {
                // Sarvam's VAD decides segment boundaries; each message is final
                setFinalTranscript((prev) => {
                  const updated = prev ? `${prev} ${msg.transcript}` : (msg.transcript ?? '');
                  finalTranscriptRef.current = updated;
                  return updated;
                });
                // Clear the interim display after segment finishes
                setLiveTranscript('');
              }
              break;

            case 'vad':
              if (msg.signal === 'START_SPEECH') {
                setIsSpeechDetected(true);
                setLiveTranscript('…');  // show that speech is being captured
              } else if (msg.signal === 'END_SPEECH') {
                setIsSpeechDetected(false);
                setLiveTranscript('');
              }
              break;

            case 'error':
              setError(msg.message || 'STT error');
              break;
          }
        } catch {
          // Ignore non-JSON messages
        }
      };

      ws.onerror = () => {
        setError('WebSocket connection error');
        setIsStreaming(false);
        setIsConnected(false);
        cleanupAudio();
        reject(new Error('WebSocket connection error'));
      };

      ws.onclose = () => {
        setIsStreaming(false);
        setIsConnected(false);
        setIsSpeechDetected(false);
        cleanupAudio();
      };
    });
  }, [cleanupAudio, cleanupWS]);

  /** startMic — called only after WebSocket is confirmed connected */
  const startMic = async (ws: WebSocket): Promise<void> => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    streamRef.current = stream;

    // AudioContext at 16 kHz matches Sarvam's required sample_rate
    const audioContext = new AudioContext({ sampleRate: 16000 });
    audioContextRef.current = audioContext;

    const source = audioContext.createMediaStreamSource(stream);

    // 4096 samples at 16 kHz = 256 ms per chunk — good balance of latency vs overhead
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const processor = audioContext.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e: AudioProcessingEvent) => {
      if (ws.readyState !== WebSocket.OPEN) return;

      const float32 = e.inputBuffer.getChannelData(0);
      // Convert Float32 (-1..1) → Int16 (-32768..32767) for pcm_s16le format
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32767));
      }
      ws.send(int16.buffer);
    };

    source.connect(processor);
    // Must connect to destination for onaudioprocess to fire (browser quirk)
    processor.connect(audioContext.destination);

    setIsStreaming(true);
  };

  const stop = useCallback((): string => {
    const result = finalTranscriptRef.current;

    cleanupAudio();
    cleanupWS();

    setIsStreaming(false);
    setIsConnected(false);
    setIsSpeechDetected(false);
    setLiveTranscript('');
    setFinalTranscript('');
    finalTranscriptRef.current = '';

    return result;
  }, [cleanupAudio, cleanupWS]);

  const clearError = useCallback(() => setError(null), []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupAudio();
      cleanupWS();
    };
  }, [cleanupAudio, cleanupWS]);

  return {
    isConnected,
    isStreaming,
    isSpeechDetected,
    liveTranscript,
    finalTranscript,
    error,
    start,
    stop,
    clearError,
  };
}
