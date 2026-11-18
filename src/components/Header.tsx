import React from 'react';
import { Download } from 'lucide-react';

interface HeaderProps {
  hasResult: boolean;
  onExportJson: () => void;
  onNavigate: (sectionId: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  hasResult,
  onExportJson,
  onNavigate,
}) => {
  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-200">
      <div className="max-w-[1360px] mx-auto px-6 lg:px-10 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single-element Brand Wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            onNavigate('top');
          }}
          className="font-display text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-rose-600"
        >
          PinJSON
        </a>

        {/* Zone 2: Clean single-line text nav links */}
        <nav
          aria-label="Primary"
          className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600"
        >
          <a
            href="#extractor"
            onClick={(e) => {
              e.preventDefault();
              onNavigate('extractor');
            }}
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Extractor
          </a>
          <a
            href="#inspector"
            onClick={(e) => {
              e.preventDefault();
              onNavigate('inspector');
            }}
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            JSON Inspector
          </a>
          <a
            href="#queue"
            onClick={(e) => {
              e.preventDefault();
              onNavigate('queue');
            }}
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Batch Queue
          </a>
          <a
            href="#guide"
            onClick={(e) => {
              e.preventDefault();
              onNavigate('guide');
            }}
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            JSON Schema
          </a>
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onExportJson}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            <span>{hasResult ? 'Export JSON' : 'JSON Mode'}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
