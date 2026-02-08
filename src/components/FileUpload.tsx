import { useCallback, useRef, useState, useEffect } from 'react';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  currentFile: File | null;
  disabled?: boolean;
}

export default function FileUpload({ onFileSelect, currentFile, disabled }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (currentFile && currentFile.type.startsWith('image/')) {
      const url = URL.createObjectURL(currentFile);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setPreviewUrl(null);
    }
  }, [currentFile]);

  const handleFile = useCallback((file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      alert('File must be under 10MB');
      return;
    }
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'application/pdf'];
    if (!validTypes.includes(file.type) && !file.name.toLowerCase().endsWith('.pdf')) {
      alert('Please upload an image (JPG, PNG, WebP, TIFF) or PDF');
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

  return (
    <div
      onDrop={onDrop}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`
        relative border-2 border-dashed rounded-2xl text-center cursor-pointer transition-all duration-200 overflow-hidden
        ${isDragging ? 'border-primary bg-primary-light/40 scale-[1.01]' : 'border-border-strong hover:border-primary/50 hover:bg-surface-muted/50'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        ${currentFile ? 'border-success/50 bg-success/5' : ''}
        ${previewUrl ? 'p-3 sm:p-4' : 'p-6 sm:p-10'}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.pdf"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
        className="hidden"
        disabled={disabled}
      />

      {currentFile ? (
        <div className="flex items-center gap-4">
          {/* Image thumbnail */}
          {previewUrl && (
            <div className="flex-shrink-0 w-20 h-20 rounded-xl overflow-hidden border border-border bg-surface-muted">
              <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
            </div>
          )}
          {!previewUrl && (
            <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center">
              <svg className="w-6 h-6 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
          )}
          <div className="text-left flex-1 min-w-0">
            <p className="text-sm font-semibold text-text-primary truncate">{currentFile.name}</p>
            <p className="text-xs text-text-muted">{(currentFile.size / 1024).toFixed(0)} KB &middot; Click to replace</p>
          </div>
          <div className="flex-shrink-0">
            <svg className="w-5 h-5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Custom newspaper illustration */}
          <div className="w-20 h-20 mx-auto relative">
            <div className="w-20 h-20 rounded-2xl bg-primary-light/60 flex items-center justify-center">
              <svg className="w-10 h-10 text-primary" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="6" y="8" width="36" height="32" rx="3" stroke="currentColor" strokeWidth="2.5" fill="none" />
                <line x1="12" y1="15" x2="36" y2="15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                <line x1="12" y1="21" x2="24" y2="21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
                <line x1="12" y1="26" x2="22" y2="26" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
                <line x1="12" y1="31" x2="26" y2="31" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
                <rect x="28" y="20" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
                <path d="M24 44V36M24 36L20 40M24 36L28 40" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            {/* Decorative dots */}
            <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-accent opacity-50" />
            <div className="absolute -bottom-1 -left-1 w-2 h-2 rounded-full bg-secondary opacity-40" />
          </div>
          <div>
            <p className="font-heading text-lg font-semibold text-text-primary">Drop a newspaper scan here</p>
            <p className="text-sm text-text-muted mt-1 italic">JPG, PNG, or PDF &middot; Max 10MB</p>
          </div>
        </div>
      )}
    </div>
  );
}
