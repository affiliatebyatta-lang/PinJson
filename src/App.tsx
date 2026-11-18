import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Code2,
  Copy,
  Download,
  FileJson,
  Film,
  Link2,
  Loader2,
  Play,
  Trash2,
  Upload,
} from 'lucide-react';
import { Header } from './components/Header';
import { JsonViewer } from './components/JsonViewer';
import { VideoPreviewPanel } from './components/VideoPreviewPanel';
import {
  DEVTOOLS_SNIPPET,
  extractPinFromJsonPayload,
  formatResolution,
  isValidPinterestUrl,
} from './lib/pinterestJsonParser';
import type {
  ExtractedPinData,
  ExtractionResponse,
  VideoStream,
} from './lib/pinterestJsonParser';

type InputMode = 'url' | 'json' | 'batch';
type InspectorTab = 'preview' | 'json';

interface QueueItem {
  id: string;
  pin: ExtractedPinData;
  rawJson: unknown;
}

const JSON_STRUCTURE_GUIDE = [
  {
    source: '__PWS_DATA__ Script',
    path: '$.props.initialReduxState.pins[id].videos.video_list',
    detail: 'Embedded SSR state inside every Pinterest pin HTML document.',
  },
  {
    source: 'PinResource API',
    path: '$.resource_response.data.videos.video_list',
    detail: 'Direct JSON response returned by Pinterest internal pin endpoints.',
  },
  {
    source: 'Idea / Story Pins',
    path: '$.story_pin_data.pages[].blocks[].video.video_list',
    detail: 'Multi-page story pins store video stream variants per block.',
  },
  {
    source: 'Schema.org JSON-LD',
    path: '$["@type"="VideoObject"].contentUrl',
    detail: 'Structured metadata block present on public pin pages.',
  },
];

export default function App() {
  const [inputMode, setInputMode] = useState<InputMode>('url');
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('preview');

  const [pinUrlInput, setPinUrlInput] = useState('');
  const [rawJsonInput, setRawJsonInput] = useState('');
  const [batchJsonInput, setBatchJsonInput] = useState(
    '[\n  "https://www.pinterest.com/pin/..."\n]'
  );

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorHint, setErrorHint] = useState<string | null>(null);

  const [activeItem, setActiveItem] = useState<QueueItem | null>(null);
  const [selectedStream, setSelectedStream] = useState<VideoStream | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const rawJsonTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const navigateTo = (sectionId: string) => {
    if (sectionId === 'top') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const commitExtractedPins = (pins: ExtractedPinData[], rawJson: unknown) => {
    const newItems: QueueItem[] = pins.map((pin, idx) => ({
      id: `${pin.pinId || 'pin'}-${Date.now()}-${idx}`,
      pin,
      rawJson: Array.isArray(rawJson) ? rawJson[idx] ?? rawJson : rawJson,
    }));

    setQueue((prev) => [...newItems, ...prev]);
    const first = newItems[0];
    setActiveItem(first);
    setSelectedStream(first.pin.primaryStream || first.pin.streams[0] || null);
    setInspectorTab('preview');
  };

  const handleExtractUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = pinUrlInput.trim();
    if (!trimmed) {
      setErrorMsg('Enter a Pinterest pin URL to extract its video JSON.');
      setErrorHint(null);
      return;
    }

    if (!isValidPinterestUrl(trimmed)) {
      setErrorMsg(
        'Enter a valid Pinterest link (e.g., https://www.pinterest.com/pin/123456789/ or https://pin.it/...).'
      );
      setErrorHint(null);
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    setErrorHint(null);

    try {
      const resp = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });

      const data = (await resp.json()) as ExtractionResponse;

      if (!resp.ok || !data.ok || data.pins.length === 0) {
        setErrorMsg(data.error || 'Could not extract video from this Pinterest URL.');
        setErrorHint(
          data.hint ||
            'If Pinterest limits automated fetching for this pin, copy the __PWS_DATA__ JSON from DevTools and paste it in the Raw JSON tab.'
        );
        return;
      }

      commitExtractedPins(data.pins, data.rawJson);
    } catch {
      setErrorMsg('Network error while contacting the extraction server.');
      setErrorHint('Verify the server is running and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExtractRawJson = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = rawJsonInput.trim();
    if (!trimmed) {
      setErrorMsg('Paste a Pinterest JSON payload or upload a .json file.');
      setErrorHint(null);
      return;
    }

    setErrorMsg(null);
    setErrorHint(null);

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      setErrorMsg('Invalid JSON syntax. Verify brackets, quotes, and trailing commas.');
      setErrorHint(null);
      return;
    }

    // If user pasted `{ "url": "https://pinterest.com/pin/..." }`, route through backend
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      'url' in parsed &&
      typeof (parsed as Record<string, unknown>).url === 'string' &&
      isValidPinterestUrl((parsed as Record<string, unknown>).url as string) &&
      extractPinFromJsonPayload(parsed).streams.length === 0
    ) {
      setIsLoading(true);
      try {
        const resp = await fetch('/api/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ json: parsed }),
        });
        const data = (await resp.json()) as ExtractionResponse;
        if (!resp.ok || !data.ok || data.pins.length === 0) {
          setErrorMsg(data.error || 'Could not extract video from the URL inside your JSON.');
          setErrorHint(data.hint || null);
          return;
        }
        commitExtractedPins(data.pins, data.rawJson);
      } catch {
        setErrorMsg('Failed to process JSON URL request.');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Parse Pin JSON directly
    if (Array.isArray(parsed)) {
      const pins = parsed
        .map((item) =>
          extractPinFromJsonPayload(item, {
            extractionMethod: 'Client JSON Array Parser',
          })
        )
        .filter((p) => p.streams.length > 0);

      if (pins.length === 0) {
        setErrorMsg(
          'JSON array parsed, but no video_list or MP4/HLS video URLs were found.'
        );
        return;
      }
      commitExtractedPins(pins, parsed);
      return;
    }

    const pin = extractPinFromJsonPayload(parsed, {
      extractionMethod: 'Direct JSON AST Extraction',
    });

    if (pin.streams.length === 0) {
      setErrorMsg(
        'Valid JSON parsed, but no video_list or MP4/HLS stream URLs were found inside.'
      );
      setErrorHint(
        'Ensure the JSON contains a Pinterest videos.video_list block or direct .mp4 / .m3u8 URLs.'
      );
      return;
    }

    commitExtractedPins([pin], parsed);
  };

  const handleExtractBatchJson = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = batchJsonInput.trim();
    if (!trimmed) {
      setErrorMsg('Enter a JSON array of Pinterest URLs or pin JSON objects.');
      setErrorHint(null);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      setErrorMsg('Invalid JSON array syntax.');
      setErrorHint(null);
      return;
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      setErrorMsg('Batch input must be a non-empty JSON array.');
      setErrorHint(null);
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    setErrorHint(null);

    try {
      const resp = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: parsed }),
      });
      const data = (await resp.json()) as ExtractionResponse;

      if (!resp.ok || !data.ok || data.pins.length === 0) {
        setErrorMsg(data.error || 'Batch extraction returned no video streams.');
        setErrorHint(data.hint || null);
        return;
      }

      commitExtractedPins(data.pins, data.rawJson);
    } catch {
      setErrorMsg('Network error during batch JSON extraction.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFormatRawJson = () => {
    try {
      const parsed = JSON.parse(rawJsonInput);
      setRawJsonInput(JSON.stringify(parsed, null, 2));
      setErrorMsg(null);
    } catch {
      setErrorMsg('Cannot format: JSON syntax is invalid.');
    }
  };

  const handleUploadJsonFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      setRawJsonInput(text);
      setInputMode('json');
      setErrorMsg(null);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleHeaderAction = () => {
    if (activeItem) {
      const manifest = {
        pinId: activeItem.pin.pinId,
        title: activeItem.pin.title,
        sourceUrl: activeItem.pin.sourceUrl,
        thumbnailUrl: activeItem.pin.thumbnailUrl,
        primaryStream: activeItem.pin.primaryStream,
        streams: activeItem.pin.streams,
      };
      const blob = new Blob([JSON.stringify(manifest, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pinterest-${activeItem.pin.pinId || 'video'}-manifest.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return;
    }

    setInputMode('json');
    navigateTo('extractor');
    setTimeout(() => rawJsonTextareaRef.current?.focus(), 200);
  };

  const handleCopyDevToolsSnippet = async () => {
    try {
      await navigator.clipboard.writeText(DEVTOOLS_SNIPPET);
      setCopiedSnippet(true);
      setTimeout(() => setCopiedSnippet(false), 1800);
    } catch {
      // Clipboard blocked
    }
  };

  const handleSelectQueueItem = (item: QueueItem) => {
    setActiveItem(item);
    setSelectedStream(item.pin.primaryStream || item.pin.streams[0] || null);
    navigateTo('inspector');
  };

  const handleRemoveQueueItem = (id: string) => {
    setQueue((prev) => prev.filter((q) => q.id !== id));
    if (activeItem?.id === id) {
      setActiveItem(null);
      setSelectedStream(null);
    }
  };

  return (
    <div id="top" className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <Header
        hasResult={Boolean(activeItem)}
        onExportJson={handleHeaderAction}
        onNavigate={navigateTo}
      />

      <main className="flex-1 max-w-[1360px] w-full mx-auto px-6 lg:px-10 py-10 space-y-12">
        {/* Hero Intro */}
        <section className="max-w-3xl space-y-3">
          <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 [text-wrap:balance]">
            Extract Pinterest videos directly from links and JSON payloads
          </h1>
          <p className="text-base text-slate-600 leading-relaxed">
            Paste any Pinterest pin URL to resolve its embedded{' '}
            <code className="font-mono text-sm text-slate-800 bg-slate-200/70 px-1.5 py-0.5 rounded">
              __PWS_DATA__
            </code>{' '}
            and{' '}
            <code className="font-mono text-sm text-slate-800 bg-slate-200/70 px-1.5 py-0.5 rounded">
              video_list
            </code>{' '}
            JSON, inspect every video variant, and download clean MP4 files.
          </p>
        </section>

        {/* Primary Two-Column Workbench */}
        <section
          id="extractor"
          className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch"
        >
          {/* Left Column: Input Workbench */}
          <div className="lg:col-span-5 flex flex-col bg-white border border-slate-200 rounded-xl p-6 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-base font-semibold text-slate-900">
                Extraction Input
              </h2>

              {/* Segmented Mode Control */}
              <div
                role="tablist"
                aria-label="Extraction input mode"
                className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={inputMode === 'url'}
                  onClick={() => {
                    setInputMode('url');
                    setErrorMsg(null);
                    setErrorHint(null);
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    inputMode === 'url'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Pin Link
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={inputMode === 'json'}
                  onClick={() => {
                    setInputMode('json');
                    setErrorMsg(null);
                    setErrorHint(null);
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    inputMode === 'json'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Raw JSON
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={inputMode === 'batch'}
                  onClick={() => {
                    setInputMode('batch');
                    setErrorMsg(null);
                    setErrorHint(null);
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    inputMode === 'batch'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Batch JSON
                </button>
              </div>
            </div>

            {/* Mode 1: Pin Link */}
            {inputMode === 'url' && (
              <form onSubmit={handleExtractUrl} className="space-y-5 flex-1 flex flex-col">
                <div className="space-y-2">
                  <label
                    htmlFor="pin-url-input"
                    className="block text-sm font-medium text-slate-700"
                  >
                    Pinterest Pin URL
                  </label>
                  <div className="relative">
                    <Link2
                      className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      id="pin-url-input"
                      type="url"
                      value={pinUrlInput}
                      onChange={(e) => setPinUrlInput(e.target.value)}
                      placeholder="https://www.pinterest.com/pin/1234567890/"
                      className="w-full pl-10 pr-4 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
                    />
                  </div>
                  <p className="text-xs text-slate-500">
                    Supports standard pin URLs, Idea pins, and shortened{' '}
                    <span className="font-mono">pin.it</span> links.
                  </p>
                </div>

                <div className="pt-1 flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:bg-rose-400 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        <span>Extracting JSON...</span>
                      </>
                    ) : (
                      <>
                        <Film className="w-4 h-4" aria-hidden="true" />
                        <span>Extract Video</span>
                      </>
                    )}
                  </button>
                  {pinUrlInput && (
                    <button
                      type="button"
                      onClick={() => {
                        setPinUrlInput('');
                        setErrorMsg(null);
                        setErrorHint(null);
                      }}
                      className="px-3.5 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Pipeline Breakdown */}
                <div className="mt-auto pt-6 border-t border-slate-200 space-y-3">
                  <h3 className="text-xs font-semibold text-slate-900">
                    How link extraction works
                  </h3>
                  <ol className="space-y-2 text-xs text-slate-600 leading-relaxed">
                    <li>
                      01. Resolves <span className="font-mono text-slate-800">pin.it</span>{' '}
                      redirects and fetches the Pin document.
                    </li>
                    <li>
                      02. Parses{' '}
                      <span className="font-mono text-slate-800">__PWS_DATA__</span>,{' '}
                      <span className="font-mono text-slate-800">PinResource</span>, or{' '}
                      <span className="font-mono text-slate-800">VideoObject</span> JSON.
                    </li>
                    <li>
                      03. Ranks MP4 and HLS streams by pixel resolution and proxies clean downloads.
                    </li>
                  </ol>
                </div>
              </form>
            )}

            {/* Mode 2: Raw JSON */}
            {inputMode === 'json' && (
              <form onSubmit={handleExtractRawJson} className="space-y-4 flex-1 flex flex-col">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="raw-json-input"
                    className="block text-sm font-medium text-slate-700"
                  >
                    Pinterest Pin JSON Payload
                  </label>

                  <div className="flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json,application/json,text/plain"
                      onChange={handleUploadJsonFile}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Upload .json</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleFormatRawJson}
                      className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Format
                    </button>
                  </div>
                </div>

                <textarea
                  ref={rawJsonTextareaRef}
                  id="raw-json-input"
                  value={rawJsonInput}
                  onChange={(e) => setRawJsonInput(e.target.value)}
                  rows={12}
                  spellCheck={false}
                  placeholder={`Paste Pinterest __PWS_DATA__, PinResource JSON, video_list object, or {"url": "https://www.pinterest.com/pin/..."}`}
                  className="w-full flex-1 min-h-[240px] p-3.5 font-mono text-xs leading-relaxed bg-slate-950 text-slate-100 placeholder:text-slate-500 border border-slate-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-600"
                />

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:bg-rose-400 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        <span>Parsing JSON...</span>
                      </>
                    ) : (
                      <>
                        <FileJson className="w-4 h-4" aria-hidden="true" />
                        <span>Extract Video from JSON</span>
                      </>
                    )}
                  </button>
                  {rawJsonInput && (
                    <button
                      type="button"
                      onClick={() => {
                        setRawJsonInput('');
                        setErrorMsg(null);
                        setErrorHint(null);
                      }}
                      className="px-3.5 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </form>
            )}

            {/* Mode 3: Batch JSON */}
            {inputMode === 'batch' && (
              <form onSubmit={handleExtractBatchJson} className="space-y-4 flex-1 flex flex-col">
                <div className="space-y-1">
                  <label
                    htmlFor="batch-json-input"
                    className="block text-sm font-medium text-slate-700"
                  >
                    JSON Array of Pin Links or Pin Objects
                  </label>
                  <p className="text-xs text-slate-500">
                    Provide up to 10 Pinterest links or an array of pin JSON objects.
                  </p>
                </div>

                <textarea
                  id="batch-json-input"
                  value={batchJsonInput}
                  onChange={(e) => setBatchJsonInput(e.target.value)}
                  rows={11}
                  spellCheck={false}
                  className="w-full flex-1 min-h-[240px] p-3.5 font-mono text-xs leading-relaxed bg-slate-950 text-slate-100 border border-slate-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-600"
                />

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:bg-rose-400 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                      <span>Processing Batch...</span>
                    </>
                  ) : (
                    <>
                      <Code2 className="w-4 h-4" aria-hidden="true" />
                      <span>Run Batch Extraction</span>
                    </>
                  )}
                </button>
              </form>
            )}

            {/* Error Feedback */}
            {errorMsg && (
              <div
                role="alert"
                className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 space-y-2"
              >
                <div className="flex items-start gap-2.5">
                  <AlertCircle
                    className="w-4 h-4 text-rose-600 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <div className="text-xs space-y-1.5">
                    <p className="font-semibold text-rose-900">{errorMsg}</p>
                    {errorHint && <p className="text-rose-800 leading-relaxed">{errorHint}</p>}
                  </div>
                </div>
                {inputMode === 'url' && (
                  <div className="pl-6">
                    <button
                      type="button"
                      onClick={() => {
                        setInputMode('json');
                        setErrorMsg(null);
                      }}
                      className="text-xs font-semibold text-rose-700 underline underline-offset-2 hover:text-rose-900 cursor-pointer"
                    >
                      Switch to Raw JSON input
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Column: Dual Inspector (Video & Streams | JSON Inspector) */}
          <div
            id="inspector"
            className="lg:col-span-7 flex flex-col bg-white border border-slate-200 rounded-xl p-6 space-y-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-base font-semibold text-slate-900">
                Extraction Output
              </h2>

              <div
                role="tablist"
                aria-label="Output inspector view"
                className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={inspectorTab === 'preview'}
                  onClick={() => setInspectorTab('preview')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    inspectorTab === 'preview'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Video & Streams
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={inspectorTab === 'json'}
                  onClick={() => setInspectorTab('json')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    inspectorTab === 'json'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  JSON Inspector
                </button>
              </div>
            </div>

            {isLoading ? (
              <div className="space-y-5 animate-pulse">
                <div className="h-10 bg-slate-100 rounded-lg w-2/3" />
                <div className="aspect-video bg-slate-200 rounded-xl w-full" />
                <div className="h-36 bg-slate-100 rounded-lg w-full" />
              </div>
            ) : activeItem && selectedStream ? (
              inspectorTab === 'preview' ? (
                <VideoPreviewPanel
                  pin={activeItem.pin}
                  selectedStream={selectedStream}
                  onSelectStream={setSelectedStream}
                />
              ) : (
                <JsonViewer pin={activeItem.pin} rawJson={activeItem.rawJson} />
              )
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-16 px-6 border border-dashed border-slate-200 rounded-xl bg-slate-50/60">
                <FileJson className="w-10 h-10 text-slate-400 mb-4" aria-hidden="true" />
                <h3 className="font-display text-base font-semibold text-slate-900">
                  No video extracted yet
                </h3>
                <p className="text-sm text-slate-600 max-w-md mt-1.5 leading-relaxed">
                  Submit a Pinterest pin URL on the left or paste raw Pinterest JSON to inspect every discovered video stream and download the MP4 file.
                </p>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setInputMode('json');
                      setTimeout(() => rawJsonTextareaRef.current?.focus(), 100);
                    }}
                    className="px-4 py-2 text-xs font-semibold text-slate-900 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Paste Raw JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateTo('guide')}
                    className="px-4 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    View JSON Schema
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Session Queue & History Table */}
        <section id="queue" className="space-y-4 pt-4 border-t border-slate-200">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-semibold text-slate-900">
                Extraction Queue ({queue.length})
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Extracted pins from your current session remain available for quick preview or download.
              </p>
            </div>
            {queue.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setQueue([]);
                  setActiveItem(null);
                  setSelectedStream(null);
                }}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Clear Queue
              </button>
            )}
          </div>

          {queue.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl px-6 py-8 text-center">
              <p className="text-sm text-slate-600">
                Extracted video pins and batch JSON items will appear in this queue.
              </p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                      <th className="py-3 px-4">Pin & Title</th>
                      <th className="py-3 px-4">JSON Source</th>
                      <th className="py-3 px-4">Primary Stream</th>
                      <th className="py-3 px-4 text-right">Variants</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {queue.map((item) => {
                      const primary = item.pin.primaryStream;
                      const isCurrent = activeItem?.id === item.id;
                      const dlFilename = `pinterest-${item.pin.pinId || 'video'}.mp4`;
                      const dlHref = primary
                        ? `/api/download?url=${encodeURIComponent(
                            primary.url
                          )}&filename=${encodeURIComponent(dlFilename)}`
                        : '#';

                      return (
                        <tr
                          key={item.id}
                          className={`h-11 transition-colors ${
                            isCurrent ? 'bg-rose-50/50' : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="py-2.5 px-4 max-w-xs">
                            <div className="font-medium text-slate-900 truncate">
                              {item.pin.title}
                            </div>
                            {item.pin.pinId && (
                              <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                                ID {item.pin.pinId}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-slate-600 whitespace-nowrap">
                            {item.pin.extractionMethod}
                          </td>
                          <td className="py-2.5 px-4 text-slate-700 font-mono tabular-nums whitespace-nowrap">
                            {primary
                              ? `${primary.format} · ${formatResolution(
                                  primary.width,
                                  primary.height
                                )}`
                              : '—'}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700">
                            {item.pin.streams.length}
                          </td>
                          <td className="py-2.5 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleSelectQueueItem(item)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors cursor-pointer"
                              >
                                <Play className="w-3 h-3" aria-hidden="true" />
                                <span>Inspect</span>
                              </button>
                              {primary && (
                                <a
                                  href={dlHref}
                                  download={dlFilename}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-rose-600 hover:bg-rose-700 rounded transition-colors"
                                >
                                  <Download className="w-3 h-3" aria-hidden="true" />
                                  <span>MP4</span>
                                </a>
                              )}
                              <button
                                type="button"
                                aria-label="Remove item from queue"
                                onClick={() => handleRemoveQueueItem(item.id)}
                                className="p-1.5 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        {/* JSON Schema & DevTools Console Extractor Guide */}
        <section id="guide" className="pt-8 border-t border-slate-200 grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-6 space-y-4">
            <h2 className="font-display text-lg font-semibold text-slate-900">
              Supported Pinterest JSON Paths
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Pinterest stores video variants across several nested JSON schemas depending on whether the pin is a standard video pin, Idea pin, or API response. PinJSON traverses all four automatically.
            </p>
            <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
              {JSON_STRUCTURE_GUIDE.map((row) => (
                <div key={row.source} className="p-4 space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900">
                      {row.source}
                    </span>
                    <code className="font-mono text-[11px] text-rose-700 bg-rose-50 px-2 py-0.5 rounded">
                      {row.path}
                    </code>
                  </div>
                  <p className="text-xs text-slate-600">{row.detail}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-lg font-semibold text-slate-900">
                Browser Console JSON Grabber
              </h2>
              <button
                type="button"
                onClick={handleCopyDevToolsSnippet}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-900 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {copiedSnippet ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                ) : (
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{copiedSnippet ? 'Copied Snippet' : 'Copy Console Snippet'}</span>
              </button>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              For private boards or pins behind a login prompt, open DevTools Console on the Pinterest page, run this snippet to copy the page&apos;s JSON directly, and paste it into the Raw JSON tab.
            </p>
            <pre className="p-4 bg-slate-950 text-slate-200 font-mono text-xs leading-relaxed rounded-xl border border-slate-800 overflow-x-auto">
              <code>{DEVTOOLS_SNIPPET}</code>
            </pre>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white mt-12">
        <div className="max-w-[1360px] mx-auto px-6 lg:px-10 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <span>PinJSON · Pinterest JSON Video Extractor</span>
          <span>Extracts MP4 and HLS streams from public pin links and JSON payloads.</span>
        </div>
      </footer>
    </div>
  );
}
