import { useState, useRef, useEffect, useMemo } from 'react';
import type { ChatMessage, TopicKey } from '../lib/types';
import { chatWithNewspaper } from '../services/api';
import { useTTSChat } from '../hooks/useTTSChat';
import { useSTT } from '../hooks/useSTT';
import LiveVoicePanel from './LiveVoicePanel';

interface ChatInterfaceProps {
  newspaperContext: string;
  headlines: string[];
  targetLang: string;
  targetLangName: string;
  topicSummary?: string;
  topicsFound?: TopicKey[];
}

const BASE_QUESTIONS = [
  "What are the most important headlines today?",
  "Summarize the front page for me",
];

const TOPIC_QUESTIONS: Record<TopicKey, string> = {
  water: "What news is there about water or irrigation?",
  power: "Any news about electricity or power supply?",
  farmers: "What news matters for farmers?",
  politics: "What's happening in politics?",
  sports: "Any sports news today?",
  economy: "What's the economic news?",
  education: "Any headlines about education or students?",
  health: "What are the health-related news items?",
};

export default function ChatInterface({ newspaperContext, headlines, targetLang, targetLangName, topicSummary, topicsFound }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [showLiveVoice, setShowLiveVoice] = useState(false);

  const { speakingId, speakMessage, stopSpeaking, autoSpeak, setAutoSpeak } = useTTSChat();
  const { isRecording, isTranscribing, error: micError, startRecording, stopRecording, transcribe, cleanup } = useSTT();

  // Clean up mic on unmount
  useEffect(() => () => cleanup(), []);

  const suggestedQuestions = useMemo(() => {
    const questions = [...BASE_QUESTIONS];
    if (topicsFound && topicsFound.length > 0) {
      for (const topic of topicsFound) {
        if (TOPIC_QUESTIONS[topic]) questions.push(TOPIC_QUESTIONS[topic]);
      }
    } else {
      questions.push("What news matters for farmers?", "Any headlines about education?");
    }
    return questions.slice(0, 6);
  }, [topicsFound]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + 'px';
    }
  }, [input]);

  // Send welcome message on mount
  useEffect(() => {
    const welcome: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: `I've read through your entire newspaper. Ask me anything and I'll respond in **${targetLangName}**!\n\nFor example: *"What news is important for a farmer?"* or *"Summarize the front page"*`,
      timestamp: Date.now(),
      isLocal: true,
    };
    setMessages([welcome]);
  }, [headlines.length]);

  // Auto-speak: read the latest assistant response aloud when autoSpeak is on
  useEffect(() => {
    if (!autoSpeak) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === 'assistant' && !lastMsg.isLocal && !isLoading) {
      speakMessage(lastMsg.content, targetLang, lastMsg.id);
    }
  }, [messages, isLoading, autoSpeak]);

  const handleMicClick = async () => {
    if (isLoading) return;
    if (isRecording) {
      // Stop recording and transcribe
      try {
        const blob = await stopRecording();
        if (blob.size < 1000) return; // too short — ignore noise
        const transcript = await transcribe(blob, targetLang);
        if (transcript) setInput((prev) => prev + (prev ? ' ' : '') + transcript);
      } catch { /* silent fail */ }
    } else {
      await startRecording();
    }
  };

  const sendMessage = async (text?: string) => {
    const messageText = text || input.trim();
    if (!messageText || isLoading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: messageText,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      // Filter out local-only welcome message — API expects user message first
      const apiMessages = [...messages, userMsg].filter((m) => !m.isLocal);
      const reply = await chatWithNewspaper(apiMessages, newspaperContext, targetLang, topicSummary);

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: reply,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Sorry, something went wrong: ${(err as Error).message}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Simple markdown-ish rendering: bold, italic, numbered lists
  const renderContent = (content: string) => {
    const lines = content.split('\n');
    return lines.map((line, i) => {
      // Bold
      let html = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      // Italic
      html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
      // Numbered list
      const listMatch = html.match(/^(\d+)\.\s+(.+)/);
      if (listMatch) {
        return (
          <div key={i} className="flex gap-2 py-0.5">
            <span className="flex-shrink-0 w-5 h-5 rounded bg-primary-light text-primary text-[10px] font-bold flex items-center justify-center mt-0.5">
              {listMatch[1]}
            </span>
            <span dangerouslySetInnerHTML={{ __html: listMatch[2] }} />
          </div>
        );
      }
      if (!html.trim()) return <br key={i} />;
      return <p key={i} dangerouslySetInnerHTML={{ __html: html }} />;
    });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-220px)] sm:h-[500px] min-h-[350px] bg-surface-elevated rounded-xl border border-border overflow-hidden animate-fade-in-scale font-heading">
      {/* Auto-speak toggle */}
      <div className="flex items-center justify-end px-4 py-1.5 border-b border-border/50">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <span className="text-[11px] text-text-muted">Auto-speak</span>
          <button
            onClick={() => { stopSpeaking(); setAutoSpeak(v => !v); }}
            className={`relative w-8 h-4 rounded-full transition-colors ${autoSpeak ? 'bg-primary' : 'bg-border-strong'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${autoSpeak ? 'translate-x-4' : 'translate-x-0'}`} />
          </button>
        </label>
      </div>
      {/* Chat messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-slide-in-up`}
          >
            <div
              className={`max-w-[90%] sm:max-w-[85%] rounded-2xl px-3 sm:px-4 py-2.5 sm:py-3 text-[14px] sm:text-[15px] leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-primary text-white rounded-br-md'
                  : 'bg-surface-muted text-text-primary rounded-bl-md border border-border'
              }`}
            >
              {msg.role === 'assistant' ? (
                <div className="space-y-1">{renderContent(msg.content)}</div>
              ) : (
                <p>{msg.content}</p>
              )}
              {msg.role === 'assistant' && !msg.isLocal && (
                <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-border/50">
                  <button
                    onClick={() => speakMessage(msg.content, targetLang, msg.id)}
                    className={`p-1 rounded-md transition-colors ${speakingId === msg.id ? 'text-primary' : 'text-text-muted hover:text-primary'}`}
                    title={speakingId === msg.id ? 'Stop' : 'Read aloud'}
                  >
                    {speakingId === msg.id ? (
                      <svg className="w-3.5 h-3.5 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M12 6a7 7 0 010 14M9.464 9.536a3 3 0 010 4.928"/>
                      </svg>
                    )}
                  </button>
                  <span className="text-[10px] text-text-muted">
                    {speakingId === msg.id ? 'Speaking...' : ''}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {isLoading && (
          <div className="flex justify-start animate-fade-in">
            <div className="bg-surface-muted rounded-2xl rounded-bl-md px-4 py-3 border border-border">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggestion chips — only show when no user messages yet */}
      {messages.length <= 1 && (
        <div className="px-3 sm:px-4 pb-2 overflow-x-auto">
          <div className="flex sm:flex-wrap gap-2 pb-1">
            {suggestedQuestions.map((q) => (
              <button
                key={q}
                onClick={() => sendMessage(q)}
                disabled={isLoading}
                className="text-xs px-3 py-1.5 rounded-full border border-border bg-surface hover:bg-surface-muted hover:border-primary/30 text-text-secondary transition-all whitespace-nowrap flex-shrink-0"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="relative border-t border-border px-3 sm:px-4 py-2.5 sm:py-3 bg-surface-elevated">
        {/* Live voice panel — floats above the input area */}
        {showLiveVoice && (
          <LiveVoicePanel
            targetLang={targetLang}
            onTranscript={(text) => {
              setInput((prev) => prev ? `${prev} ${text}` : text);
              setShowLiveVoice(false);
            }}
            onClose={() => setShowLiveVoice(false)}
          />
        )}
        {/* Recording status indicator */}
        {isRecording && (
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="w-2 h-2 rounded-full bg-error animate-pulse" />
            <span className="text-[11px] text-error font-medium">Recording... click mic to stop</span>
          </div>
        )}
        {/* Mic error indicator */}
        {micError && !isRecording && (
          <div className="mb-1.5">
            <span className="text-[11px] text-error">{micError}</span>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isTranscribing ? 'Transcribing voice...' : 'Ask about the newspaper...'}
            rows={1}
            disabled={isLoading}
            className="flex-1 resize-none bg-surface border border-border rounded-xl px-3 sm:px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all font-heading"
          />
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || isLoading}
            className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
              !input.trim() || isLoading
                ? 'bg-border text-text-muted cursor-not-allowed'
                : 'bg-primary hover:bg-primary-hover text-white'
            }`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
          {/* Mic button */}
          <button
            onClick={handleMicClick}
            disabled={isLoading}
            className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
              isRecording
                ? 'bg-error text-white animate-pulse'
                : isTranscribing
                ? 'bg-border text-text-muted'
                : 'bg-surface-muted border border-border text-text-muted hover:text-primary hover:border-primary/40'
            }`}
            title={isRecording ? 'Stop recording' : isTranscribing ? 'Transcribing...' : 'Voice input'}
          >
            {isTranscribing ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            ) : isRecording ? (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 016 0v6a3 3 0 01-3 3z"/>
              </svg>
            )}
          </button>
          {/* Live voice button — streaming STT via WebSocket */}
          <button
            onClick={() => setShowLiveVoice((v) => !v)}
            disabled={isLoading || isRecording}
            className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center border transition-all ${
              showLiveVoice
                ? 'border-primary bg-primary-light text-primary'
                : 'border-border bg-surface-muted text-text-muted hover:border-primary/40 hover:text-primary'
            } disabled:opacity-40 disabled:cursor-not-allowed`}
            title="Live streaming voice mode"
          >
            {/* Lightning bolt — live/real-time indicator */}
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
