import { useCallback, useRef, useState, useEffect } from 'react';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  currentFile: File | null;
  disabled?: boolean;
}

export default function FileUpload({ onFileSelect, currentFile, disabled }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (currentFile && currentFile.type.startsWith('image/')) {
      const url = URL.createObjectURL(currentFile);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setPreviewUrl(null);
    }
  }, [currentFile]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const isAudioFile = (f: File) =>
    f.type.startsWith('audio/') ||
    /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(f.name);

  const handleFile = useCallback((file: File) => {
    const audio = isAudioFile(file);
    const maxSize = audio ? 200 * 1024 * 1024 : 10 * 1024 * 1024;
    const maxLabel = audio ? '200MB' : '10MB';

    if (file.size > maxSize) {
      alert(`File must be under ${maxLabel}`);
      return;
    }

    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'application/pdf'];
    const audioTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/flac'];
    const allValid = [...validTypes, ...audioTypes];

    if (
      !allValid.includes(file.type) &&
      !file.name.toLowerCase().endsWith('.pdf') &&
      !isAudioFile(file)
    ) {
      alert('Please upload an image (JPG, PNG, WebP, TIFF), PDF, or audio file (MP3, WAV, OGG, M4A, AAC, FLAC)');
      return;
    }
    onFileSelect(file);
  }, [onFileSelect]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile, disabled]);

  const startRecording = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        const ext = recorder.mimeType.includes('webm') ? 'webm' : 'ogg';
        onFileSelect(new File([blob], `recording.${ext}`, { type: recorder.mimeType }));
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start(100);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingSeconds(0);
      timerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    } catch {
      alert('Microphone access denied. Please allow microphone permissions and try again.');
    }
  };

  const stopRecording = (e: React.MouseEvent) => {
    e.stopPropagation();
    mediaRecorderRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    setIsRecording(false);
  };

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div
      onDrop={onDrop}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      className={`
        relative border-2 border-dashed rounded-2xl transition-all duration-200 overflow-hidden
        ${isDragging ? 'border-primary bg-primary-light/40 scale-[1.01]' : 'border-border-strong'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        ${currentFile ? 'border-success/50 bg-success/5' : ''}
        ${previewUrl ? 'p-3 sm:p-4' : 'p-4 sm:p-6'}
      `}
    >
      {/* Hidden file inputs */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.pdf"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
        className="hidden"
        disabled={disabled}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/aac,audio/flac,.mp3,.wav,.ogg,.m4a,.aac,.flac"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
        className="hidden"
        disabled={disabled}
      />

      {currentFile ? (
        <div className="flex items-center gap-4">
          {previewUrl && (
            <div className="flex-shrink-0 w-20 h-20 rounded-xl overflow-hidden border border-border bg-surface-muted">
              <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
            </div>
          )}
          {!previewUrl && currentFile && isAudioFile(currentFile) && (
            <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center">
              <svg className="w-6 h-6 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
            </div>
          )}
          {!previewUrl && (!currentFile || !isAudioFile(currentFile)) && (
            <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center">
              <svg className="w-6 h-6 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
          )}
          <div className="text-left flex-1 min-w-0">
            <p className="text-sm font-semibold text-text-primary truncate">{currentFile.name}</p>
            <p className="text-xs text-text-muted">{(currentFile.size / 1024).toFixed(0)} KB &middot; Click any option to replace</p>
          </div>
          <div className="flex-shrink-0">
            <svg className="w-5 h-5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Header hint */}
          <p className="text-center text-xs text-text-muted italic">
            Choose how you want to bring your news in
          </p>

          {/* Three option cards */}
          <div className="grid grid-cols-3 gap-3">

            {/* Option 1: Scan / PDF */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); if (!disabled) inputRef.current?.click(); }}
              className="rounded-xl border border-border p-4 flex flex-col items-center gap-2 text-center hover:border-primary/50 hover:bg-primary-light/20 transition-all duration-200 cursor-pointer"
            >
              <div className="w-10 h-10 rounded-xl bg-primary-light/60 flex items-center justify-center">
                <svg className="w-5 h-5 text-primary" viewBox="0 0 48 48" fill="none">
                  <rect x="6" y="8" width="36" height="32" rx="3" stroke="currentColor" strokeWidth="2.5" fill="none" />
                  <line x1="12" y1="15" x2="36" y2="15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                  <line x1="12" y1="21" x2="24" y2="21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
                  <line x1="12" y1="26" x2="22" y2="26" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
                  <line x1="12" y1="31" x2="26" y2="31" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
                  <rect x="28" y="20" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
                </svg>
              </div>
              <p className="font-heading text-sm font-semibold text-text-primary">News Scan</p>
              <p className="text-xs text-text-muted italic leading-tight">Upload a JPG, PNG or PDF scan of any page</p>
              <p className="text-[10px] text-text-muted/60 leading-tight">Try Dainik Bhaskar, Mathrubhumi, or Dinamalar</p>
            </button>

            {/* Option 2: Audio File */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); if (!disabled) audioInputRef.current?.click(); }}
              className="rounded-xl border border-border p-4 flex flex-col items-center gap-2 text-center hover:border-primary/50 hover:bg-primary-light/20 transition-all duration-200 cursor-pointer"
            >
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
              </div>
              <p className="font-heading text-sm font-semibold text-text-primary">Radio or Podcast</p>
              <p className="text-xs text-text-muted italic leading-tight">Upload an MP3 or WAV recording up to 200MB</p>
              <p className="text-[10px] text-text-muted/60 leading-tight">Works great with All India Radio news clips</p>
            </button>

            {/* Option 3: Record Live */}
            <button
              type="button"
              onClick={isRecording ? stopRecording : startRecording}
              disabled={disabled}
              className={`rounded-xl border p-4 flex flex-col items-center gap-2 text-center transition-all duration-200 cursor-pointer
                ${isRecording
                  ? 'border-red-400 bg-red-50 dark:bg-red-950/20'
                  : 'border-border hover:border-primary/50 hover:bg-primary-light/20'
                }`}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center relative
                ${isRecording ? 'bg-red-100 dark:bg-red-900/30' : 'bg-secondary/10'}`}
              >
                {isRecording && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                )}
                <svg className={`w-5 h-5 ${isRecording ? 'text-red-500' : 'text-secondary'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
                </svg>
              </div>
              <p className={`font-heading text-sm font-semibold ${isRecording ? 'text-red-600 dark:text-red-400' : 'text-text-primary'}`}>
                {isRecording ? `Recording ${formatTime(recordingSeconds)}` : 'Record Right Now'}
              </p>
              <p className="text-xs text-text-muted italic leading-tight">
                {isRecording ? 'Click to stop and process' : 'Click to start recording from your mic'}
              </p>
              <p className="text-[10px] text-text-muted/60 leading-tight">
                {isRecording ? 'Speak clearly into your microphone' : 'Read a headline, ask a question, or play a clip'}
              </p>
            </button>
          </div>

          {/* Drop hint at bottom */}
          <p className="text-center text-[11px] text-text-muted/50 italic">
            or drag and drop any file here
          </p>
        </div>
      )}
    </div>
  );
}
