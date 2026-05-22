import { useState, useRef } from 'react';

async function convertToWav(audioBlob: Blob): Promise<Blob> {
  const arrayBuffer = await audioBlob.arrayBuffer();
  const audioContext = new AudioContext();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  await audioContext.close();

  const { length, sampleRate, numberOfChannels } = audioBuffer;

  // Mix down to mono
  const mono = new Float32Array(length);
  for (let c = 0; c < numberOfChannels; c++) {
    const ch = audioBuffer.getChannelData(c);
    for (let i = 0; i < length; i++) mono[i] += ch[i] / numberOfChannels;
  }

  // Float32 → Int16 PCM
  const pcm = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    const s = Math.max(-1, Math.min(1, mono[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  // Build WAV container
  const wav = new ArrayBuffer(44 + pcm.byteLength);
  const v = new DataView(wav);
  const str = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.byteLength, true);
  str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, pcm.byteLength, true);
  new Uint8Array(wav, 44).set(new Uint8Array(pcm.buffer));

  return new Blob([wav], { type: 'audio/wav' });
}

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
    setError(null);
    try {
      // Sarvam STT only accepts mp3/wav/etc — convert webm/opus to WAV
      const wavBlob = await convertToWav(audioBlob);
      const formData = new FormData();
      formData.append('file', wavBlob, 'recording.wav');
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
      if (data.error) setError(data.error);
      return data.transcript || '';
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      setError(isAbort ? 'Transcription timed out – please try a shorter clip' : 'Transcription failed – please try again');
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
