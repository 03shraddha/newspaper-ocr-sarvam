import { useState, useRef } from 'react';

export function useSTT() {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const startRecording = async (): Promise<void> => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Prefer webm for broad browser support; fall back to browser default
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const mediaRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.addEventListener('dataavailable', (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      });

      mediaRecorder.start(100); // collect chunks every 100ms for responsive stop
      setIsRecording(true);
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Microphone access denied'
          : 'Could not access microphone';
      setError(msg);
    }
  };

  const stopRecording = (): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder) {
        reject(new Error('No active recorder'));
        return;
      }

      recorder.addEventListener('stop', () => {
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mimeType });
        // Stop all microphone tracks to release the device
        streamRef.current?.getTracks().forEach((t) => t.stop());
        resolve(blob);
      });

      recorder.stop();
      setIsRecording(false);
    });
  };

  const transcribe = async (audioBlob: Blob, langCode: string): Promise<string> => {
    setIsTranscribing(true);
    try {
      const formData = new FormData();
      formData.append('file', audioBlob, 'recording.webm');
      formData.append('language_code', langCode);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25_000);

      const res = await fetch('/api/stt', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await res.json() as { transcript?: string; error?: string };
      return data.transcript || '';
    } catch {
      return '';
    } finally {
      setIsTranscribing(false);
    }
  };

  const cleanup = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setIsTranscribing(false);
  };

  return { isRecording, isTranscribing, error, startRecording, stopRecording, transcribe, cleanup };
}
