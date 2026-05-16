import { useState } from 'react';
import { useTTS } from './useTTS';

export function useTTSChat() {
  const { speakText: speakMessage, speakingId, stopSpeaking } = useTTS();
  const [autoSpeak, setAutoSpeak] = useState(false);
  return { speakingId, speakMessage, stopSpeaking, autoSpeak, setAutoSpeak };
}
