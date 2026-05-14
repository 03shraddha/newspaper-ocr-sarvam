import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * useTTS — Text-to-Speech hook for HeadlineCards.
 *
 * Uses Sarvam bulbul:v3 TTS via the /api/tts backend route.
 * Audio plays immediately from a Blob URL; the URL is revoked after playback
 * for memory efficiency. Fetch has a 12s AbortController timeout.
 */
export function useTTS() {
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Clean up audio on unmount
  useEffect(() => () => { audioRef.current?.pause(); }, []);

  /**
   * speakText — fetch + play audio for the given text.
   * If `id` is already speaking, stop (toggle behaviour).
   */
  const speakText = useCallback(async (
    text: string,
    langCode: string,
    id: string,
  ): Promise<void> => {
    // Toggle: clicking the same headline again stops it
    if (speakingId === id) {
      audioRef.current?.pause();
      setSpeakingId(null);
      return;
    }

    // Stop any currently playing audio
    audioRef.current?.pause();

    // Optimistic state update — button shows "speaking" immediately
    setSpeakingId(id);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);

      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text.slice(0, 2500),
          language_code: langCode,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        setSpeakingId(null);
        return;
      }

      const data = await res.json() as { audio_base64?: string; error?: string };

      if (!data.audio_base64) {
        setSpeakingId(null);
        return;
      }

      // Decode base64 → Blob URL (synchronous, fast)
      const bytes = Uint8Array.from(atob(data.audio_base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);

      const audio = new Audio(url);
      audioRef.current = audio;

      // Clean up Blob URL and state after playback
      audio.addEventListener('ended', () => {
        setSpeakingId(null);
        URL.revokeObjectURL(url);
      });
      audio.addEventListener('error', () => {
        setSpeakingId(null);
        URL.revokeObjectURL(url);
      });

      // Play — UI is already updated so there's no perceived latency
      await audio.play();
    } catch {
      // Silent failure — text is still readable on screen
      setSpeakingId(null);
    }
  }, [speakingId]);

  const stopSpeaking = useCallback(() => {
    audioRef.current?.pause();
    setSpeakingId(null);
  }, []);

  return {
    speakText,
    stopSpeaking,
    isSpeaking: speakingId !== null,
    speakingId,
  };
}
