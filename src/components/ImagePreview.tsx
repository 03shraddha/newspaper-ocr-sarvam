import { useState } from 'react';

interface ImagePreviewProps {
  imageUrls: string[];
}

export default function ImagePreview({ imageUrls }: ImagePreviewProps) {
  const [selectedPage, setSelectedPage] = useState(0);
  const [expanded, setExpanded] = useState(false);

  if (imageUrls.length === 0) return null;

  return (
    <div className="animate-fade-in-scale">
      <div className="bg-surface-elevated rounded-xl border border-border overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface-muted/50">
          <span className="text-xs font-medium text-text-secondary">
            Uploaded Scan {imageUrls.length > 1 ? `(${imageUrls.length} pages)` : ''}
          </span>
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-xs text-primary hover:text-primary-hover font-medium transition-colors"
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>

        {/* Image */}
        <div className={`relative transition-all duration-300 overflow-hidden ${expanded ? 'max-h-[600px]' : 'max-h-48'}`}>
          <img
            src={imageUrls[selectedPage]}
            alt={`Newspaper scan page ${selectedPage + 1}`}
            className="w-full object-contain"
          />
          {!expanded && (
            <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-surface-elevated to-transparent" />
          )}
        </div>

        {/* Page selector for multi-page */}
        {imageUrls.length > 1 && (
          <div className="flex items-center gap-1 px-4 py-2 border-t border-border">
            {imageUrls.map((_, i) => (
              <button
                key={i}
                onClick={() => setSelectedPage(i)}
                className={`w-7 h-7 rounded-lg text-xs font-medium transition-all ${
                  i === selectedPage
                    ? 'bg-primary text-white'
                    : 'bg-surface-muted text-text-muted hover:text-text-secondary'
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
