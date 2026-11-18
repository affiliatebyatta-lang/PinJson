import React, { useMemo, useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import type { ExtractedPinData } from '../lib/pinterestJsonParser';

interface JsonViewerProps {
  pin: ExtractedPinData;
  rawJson: unknown;
}

type JsonTab = 'normalized' | 'video_list' | 'source';

function renderColoredJsonLine(line: string): React.ReactNode {
  // Match key-value pattern safely without dangerouslySetInnerHTML
  const keyValueMatch = line.match(/^(\s*)"([^"]+)":\s*(.*)$/);
  if (keyValueMatch) {
    const [, indent, key, rest] = keyValueMatch;
    return (
      <>
        <span>{indent}</span>
        <span className="text-sky-300">&quot;{key}&quot;</span>
        <span className="text-slate-400">: </span>
        {renderJsonValue(rest)}
      </>
    );
  }
  return renderJsonValue(line);
}

function renderJsonValue(val: string): React.ReactNode {
  const trimmed = val.trim();
  if (trimmed.startsWith('"')) {
    return <span className="text-emerald-300">{val}</span>;
  }
  if (/^(true|false|null),?$/.test(trimmed)) {
    return <span className="text-amber-300">{val}</span>;
  }
  if (/^-?\d+(\.\d+)?,?$/.test(trimmed)) {
    return <span className="text-rose-300">{val}</span>;
  }
  return <span className="text-slate-300">{val}</span>;
}

export const JsonViewer: React.FC<JsonViewerProps> = ({ pin, rawJson }) => {
  const [activeTab, setActiveTab] = useState<JsonTab>('normalized');
  const [copied, setCopied] = useState(false);

  const displayedObject = useMemo(() => {
    if (activeTab === 'normalized') {
      return {
        pinId: pin.pinId,
        title: pin.title,
        creator: pin.creator,
        sourceUrl: pin.sourceUrl,
        thumbnailUrl: pin.thumbnailUrl,
        extractionMethod: pin.extractionMethod,
        matchedJsonPaths: pin.matchedJsonPaths,
        primaryDownloadUrl: pin.primaryStream?.url ?? null,
        streams: pin.streams.map((s) => ({
          key: s.key,
          format: s.format,
          quality: s.qualityLabel,
          width: s.width,
          height: s.height,
          durationMs: s.durationMs,
          jsonPath: s.jsonPath,
          url: s.url,
        })),
      };
    }
    if (activeTab === 'video_list') {
      return pin.rawVideoBlock ?? { streams: pin.streams };
    }
    return rawJson ?? pin;
  }, [activeTab, pin, rawJson]);

  const jsonString = useMemo(() => {
    try {
      return JSON.stringify(displayedObject, null, 2);
    } catch {
      return '{}';
    }
  }, [displayedObject]);

  const lines = useMemo(() => jsonString.split('\n'), [jsonString]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonString);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback ignored if clipboard blocked
    }
  };

  const handleDownloadJson = () => {
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pinterest-${pin.pinId || 'video'}-${activeTab}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 rounded-xl border border-slate-800 overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-900 border-b border-slate-800">
        <div
          role="tablist"
          aria-label="JSON payload views"
          className="flex items-center gap-1 p-1 bg-slate-950 rounded-lg border border-slate-800"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'normalized'}
            onClick={() => setActiveTab('normalized')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'normalized'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Normalized Output
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'video_list'}
            onClick={() => setActiveTab('video_list')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'video_list'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            video_list Block
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'source'}
            onClick={() => setActiveTab('source')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'source'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Source JSON
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
            ) : (
              <Copy className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span>{copied ? 'Copied' : 'Copy JSON'}</span>
          </button>
          <button
            type="button"
            onClick={handleDownloadJson}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Save .json</span>
          </button>
        </div>
      </div>

      {/* Code viewport */}
      <div className="flex-1 overflow-auto max-h-[520px] p-4 font-mono text-xs leading-6">
        <table className="w-full border-collapse">
          <tbody>
            {lines.slice(0, 600).map((line, index) => (
              <tr key={index} className="hover:bg-slate-900/60">
                <td className="select-none pr-4 text-right text-slate-600 w-10 align-top tabular-nums">
                  {index + 1}
                </td>
                <td className="whitespace-pre-wrap break-all text-slate-200">
                  {renderColoredJsonLine(line)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {lines.length > 600 && (
          <p className="mt-3 pt-3 border-t border-slate-800 text-xs text-slate-400">
            Showing first 600 of {lines.length} lines. Use Save .json to inspect the complete payload.
          </p>
        )}
      </div>
    </div>
  );
};
