import { useState, useRef, useEffect, useCallback } from 'react';

export function useTTSChat() {
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Clean up audio on component unmount
  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const speakMessage = useCallback(async (text: string, langCode: string, messageId: string) => {
    // Toggle: if already speaking this message, stop
    if (speakingId === messageId) {
      audioRef.current?.pause();
      setSpeakingId(null);
      return;
    }
    // Stop any currently playing audio
    audioRef.current?.pause();
    // Set speaking state immediately (optimistic — shows button feedback right away)
    setSpeakingId(messageId);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, 2500), language_code: langCode }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) { setSpeakingId(null); return; }
      const data = await res.json() as { audio_base64?: string; error?: string };
      if (!data.audio_base64) { setSpeakingId(null); return; }

      // Base64 decode + blob creation is synchronous and fast
      const bytes = Uint8Array.from(atob(data.audio_base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;

      audio.addEventListener('ended', () => { setSpeakingId(null); URL.revokeObjectURL(url); });
      audio.addEventListener('error', () => { setSpeakingId(null); URL.revokeObjectURL(url); });

      // audio.play() returns a Promise — await it but UI is already updated
      await audio.play();
    } catch {
      setSpeakingId(null);
    }
  }, [speakingId]);

  const stopSpeaking = useCallback(() => {
    audioRef.current?.pause();
    setSpeakingId(null);
  }, []);

  return { speakingId, speakMessage, stopSpeaking, autoSpeak, setAutoSpeak };
}
