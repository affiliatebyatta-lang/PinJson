import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Film,
  Play,
} from 'lucide-react';
import type { ExtractedPinData, VideoStream } from '../lib/pinterestJsonParser';
import { formatDurationMs, formatResolution } from '../lib/pinterestJsonParser';

interface VideoPreviewPanelProps {
  pin: ExtractedPinData;
  selectedStream: VideoStream;
  onSelectStream: (stream: VideoStream) => void;
}

function isPinimgHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === 'pinimg.com' ||
      parsed.hostname.endsWith('.pinimg.com')
    );
  } catch {
    return false;
  }
}

export const VideoPreviewPanel: React.FC<VideoPreviewPanelProps> = ({
  pin,
  selectedStream,
  onSelectStream,
}) => {
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [posterError, setPosterError] = useState(false);

  useEffect(() => {
    setVideoError(false);
  }, [selectedStream.url]);

  useEffect(() => {
    setPosterError(false);
  }, [pin.thumbnailUrl]);

  const canProxy = isPinimgHost(selectedStream.url);
  const playbackUrl = canProxy
    ? `/api/proxy-media?url=${encodeURIComponent(selectedStream.url)}`
    : selectedStream.url;

  const downloadFilename = `pinterest-${pin.pinId || 'video'}-${selectedStream.key.toLowerCase()}.${
    selectedStream.format === 'HLS'
      ? 'm3u8'
      : selectedStream.format === 'WEBM'
      ? 'webm'
      : 'mp4'
  }`;

  const downloadHref = canProxy
    ? `/api/download?url=${encodeURIComponent(selectedStream.url)}&filename=${encodeURIComponent(
        downloadFilename
      )}`
    : selectedStream.url;

  const handleCopyStreamUrl = async () => {
    try {
      await navigator.clipboard.writeText(selectedStream.url);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 1800);
    } catch {
      // Clipboard blocked
    }
  };

  return (
    <div className="space-y-6">
      {/* Header metadata & primary download bar */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b border-slate-200">
        <div className="min-w-0 space-y-1.5">
          <h3 className="font-display text-lg font-semibold text-slate-900 leading-snug break-words">
            {pin.title}
          </h3>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 tabular-nums">
            {pin.pinId && <span>Pin {pin.pinId}</span>}
            {pin.pinId && <span aria-hidden="true">·</span>}
            <span>{selectedStream.format}</span>
            <span aria-hidden="true">·</span>
            <span>
              {formatResolution(selectedStream.width, selectedStream.height)}
            </span>
            <span aria-hidden="true">·</span>
            <span>{formatDurationMs(selectedStream.durationMs)}</span>
            <span aria-hidden="true">·</span>
            <span>{pin.extractionMethod}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <a
            href={downloadHref}
            download={downloadFilename}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            <span>
              Download {selectedStream.format === 'HLS' ? 'HLS' : 'MP4'}
            </span>
          </a>
        </div>
      </div>

      {/* Video Player Theater */}
      <div className="bg-slate-950 rounded-xl border border-slate-200 overflow-hidden">
        {selectedStream.format === 'HLS' ? (
          <div className="aspect-video w-full flex flex-col items-center justify-center p-8 text-center text-slate-300 bg-slate-950">
            <Film className="w-9 h-9 text-slate-500 mb-3" aria-hidden="true" />
            <p className="text-sm font-medium text-white">
              HLS Playlist Stream Selected ({selectedStream.key})
            </p>
            <p className="text-xs text-slate-400 mt-1 max-w-md">
              Select an MP4 variant below for direct browser playback and single-file download, or copy the .m3u8 manifest URL.
            </p>
          </div>
        ) : videoError ? (
          <div className="aspect-video w-full flex flex-col items-center justify-center p-8 text-center bg-slate-950 text-slate-300">
            {pin.thumbnailUrl && !posterError ? (
              <img
                src={pin.thumbnailUrl}
                alt={pin.title}
                referrerPolicy="no-referrer"
                onError={() => setPosterError(true)}
                className="max-h-60 rounded-lg object-contain mb-4 border border-slate-800"
              />
            ) : (
              <Film className="w-9 h-9 text-slate-500 mb-3" aria-hidden="true" />
            )}
            <p className="text-sm font-medium text-white">
              Stream preview could not load inline
            </p>
            <p className="text-xs text-slate-400 mt-1 max-w-md">
              You can still download the extracted MP4 directly or open the CDN stream URL in a new tab.
            </p>
          </div>
        ) : (
          <div className="relative flex items-center justify-center bg-slate-950 min-h-[280px] max-h-[420px]">
            <video
              key={playbackUrl}
              src={playbackUrl}
              poster={
                pin.thumbnailUrl && !posterError ? pin.thumbnailUrl : undefined
              }
              controls
              playsInline
              preload="metadata"
              onError={() => setVideoError(true)}
              className="w-full max-h-[420px] object-contain bg-black"
            />
          </div>
        )}

        {/* Stream URL Quick Bar */}
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-slate-900 border-t border-slate-800 text-xs">
          <span className="font-mono text-slate-300 truncate">
            {selectedStream.url}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCopyStreamUrl}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copiedUrl ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
              ) : (
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>{copiedUrl ? 'Copied' : 'Copy URL'}</span>
            </button>
            <a
              href={selectedStream.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded transition-colors whitespace-nowrap shrink-0"
            >
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Direct</span>
            </a>
          </div>
        </div>
      </div>

      {/* Extracted Video Variants Table */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-display text-sm font-semibold text-slate-900">
            Extracted JSON Video Streams ({pin.streams.length})
          </h4>
          <span className="text-xs text-slate-500 font-mono">
            {selectedStream.jsonPath}
          </span>
        </div>

        <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                  <th className="py-2.5 px-3">Variant Key</th>
                  <th className="py-2.5 px-3">Format</th>
                  <th className="py-2.5 px-3">Resolution</th>
                  <th className="py-2.5 px-3">Duration</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {pin.streams.map((stream) => {
                  const isActive = stream.id === selectedStream.id;
                  const streamCanProxy = isPinimgHost(stream.url);
                  const rowFilename = `pinterest-${pin.pinId || 'video'}-${stream.key.toLowerCase()}.${
                    stream.format === 'HLS' ? 'm3u8' : 'mp4'
                  }`;
                  const rowDownloadHref = streamCanProxy
                    ? `/api/download?url=${encodeURIComponent(
                        stream.url
                      )}&filename=${encodeURIComponent(rowFilename)}`
                    : stream.url;

                  return (
                    <tr
                      key={stream.id}
                      className={`h-10 transition-colors ${
                        isActive ? 'bg-rose-50/70' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-2 px-3 font-mono font-medium text-slate-900 whitespace-nowrap">
                        {stream.key}
                      </td>
                      <td className="py-2 px-3 text-slate-700 whitespace-nowrap">
                        {stream.format}
                      </td>
                      <td className="py-2 px-3 text-slate-700 tabular-nums whitespace-nowrap">
                        {formatResolution(stream.width, stream.height)}
                      </td>
                      <td className="py-2 px-3 text-slate-700 tabular-nums whitespace-nowrap">
                        {formatDurationMs(stream.durationMs)}
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onSelectStream(stream)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                              isActive
                                ? 'bg-slate-900 text-white'
                                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            }`}
                          >
                            <Play className="w-3 h-3" aria-hidden="true" />
                            <span>{isActive ? 'Selected' : 'Preview'}</span>
                          </button>
                          <a
                            href={rowDownloadHref}
                            download={rowFilename}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 transition-colors whitespace-nowrap"
                          >
                            <Download className="w-3 h-3" aria-hidden="true" />
                            <span>Save</span>
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
