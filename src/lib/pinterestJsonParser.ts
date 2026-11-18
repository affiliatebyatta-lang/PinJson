export interface VideoStream {
  id: string;
  key: string;
  url: string;
  format: 'MP4' | 'HLS' | 'WEBM' | 'UNKNOWN';
  width: number | null;
  height: number | null;
  durationMs: number | null;
  thumbnail: string | null;
  jsonPath: string;
  qualityLabel: string;
}

export interface ExtractedPinData {
  pinId: string | null;
  sourceUrl: string | null;
  title: string;
  description: string;
  creator: string | null;
  thumbnailUrl: string | null;
  streams: VideoStream[];
  primaryStream: VideoStream | null;
  extractedAt: string;
  extractionMethod: string;
  matchedJsonPaths: string[];
  rawVideoBlock: unknown;
}

export interface ExtractionResponse {
  ok: boolean;
  mode: 'url' | 'json' | 'batch';
  pins: ExtractedPinData[];
  rawJson: unknown;
  error?: string;
  hint?: string;
}

const PIN_URL_REGEX =
  /^https?:\/\/([a-z0-9-]+\.)?(pinterest\.[a-z.]+|pin\.it)\//i;

export function isValidPinterestUrl(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return PIN_URL_REGEX.test(parsed.href);
  } catch {
    return false;
  }
}

export function extractPinIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/pin\/(?:[^/]*--)?(\d+)(?:\/|$)/i) ||
      parsed.pathname.match(/\/pin\/([a-zA-Z0-9_-]+)(?:\/|$)/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function inferFormat(url: string, key: string): VideoStream['format'] {
  const lowerUrl = url.toLowerCase();
  const lowerKey = key.toLowerCase();
  if (lowerUrl.includes('.m3u8') || lowerKey.includes('hls')) return 'HLS';
  if (lowerUrl.includes('.webm')) return 'WEBM';
  if (lowerUrl.includes('.mp4') || lowerKey.includes('720p') || lowerKey.includes('exp')) {
    return 'MP4';
  }
  return 'UNKNOWN';
}

function formatQualityLabel(
  key: string,
  width: number | null,
  height: number | null,
  format: VideoStream['format']
): string {
  if (width && height) {
    const shortSide = Math.min(width, height);
    return `${shortSide}p ${format}`;
  }
  const cleanKey = key.replace(/^V_/, '').replace(/_/g, ' ');
  return cleanKey ? `${cleanKey} (${format})` : format;
}

function toNumberOrNull(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string' && val.trim() !== '') {
    const num = Number(val);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function normalizeDurationMs(val: unknown): number | null {
  const num = toNumberOrNull(val);
  if (num === null || num <= 0) return null;
  // Pinterest video_list duration is typically in milliseconds (e.g. 15400),
  // while ISO or JSON-LD might be seconds (< 1000).
  return num < 300 ? Math.round(num * 1000) : Math.round(num);
}

function isMediaVideoUrl(val: unknown): val is string {
  if (typeof val !== 'string') return false;
  if (!val.startsWith('http://') && !val.startsWith('https://')) return false;
  const lower = val.toLowerCase();
  return (
    lower.includes('.mp4') ||
    lower.includes('.m3u8') ||
    lower.includes('.webm') ||
    (lower.includes('pinimg.com') && lower.includes('/videos/'))
  );
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

export function extractVideoStreamsFromObject(
  root: unknown,
  basePath = '$'
): {
  streams: VideoStream[];
  matchedPaths: string[];
  rawVideoBlocks: unknown[];
} {
  const streams: VideoStream[] = [];
  const seenUrls = new Set<string>();
  const matchedPaths: string[] = [];
  const rawVideoBlocks: unknown[] = [];
  const visited = new Set<object>();

  function addStream(
    url: string,
    key: string,
    path: string,
    meta?: {
      width?: unknown;
      height?: unknown;
      duration?: unknown;
      thumbnail?: unknown;
    }
  ) {
    const cleanUrl = url.replace(/\\u002F/g, '/').trim();
    if (!cleanUrl || seenUrls.has(cleanUrl)) return;
    seenUrls.add(cleanUrl);

    const width = toNumberOrNull(meta?.width);
    const height = toNumberOrNull(meta?.height);
    const durationMs = normalizeDurationMs(meta?.duration);
    const thumbnail =
      typeof meta?.thumbnail === 'string' && meta.thumbnail.startsWith('http')
        ? meta.thumbnail
        : null;
    const format = inferFormat(cleanUrl, key);

    streams.push({
      id: `${key || 'stream'}-${streams.length + 1}`,
      key: key || `STREAM_${streams.length + 1}`,
      url: cleanUrl,
      format,
      width,
      height,
      durationMs,
      thumbnail,
      jsonPath: path,
      qualityLabel: formatQualityLabel(key, width, height, format),
    });
  }

  function walk(node: unknown, path: string, depth: number) {
    if (depth > 22 || node === null || node === undefined) return;

    if (typeof node === 'string') {
      if (isMediaVideoUrl(node)) {
        const lastKey = path.split('.').pop() || 'url';
        addStream(node, lastKey, path);
        matchedPaths.push(path);
      }
      return;
    }

    if (typeof node !== 'object') return;
    if (visited.has(node)) return;
    visited.add(node);

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        walk(node[i], `${path}[${i}]`, depth + 1);
      }
      return;
    }

    if (isRecord(node)) {
      // Detect Pinterest `video_list` object specifically
      if (isRecord(node.video_list)) {
        const vPath = `${path}.video_list`;
        matchedPaths.push(vPath);
        rawVideoBlocks.push(node.video_list);

        for (const [variantKey, variantVal] of Object.entries(node.video_list)) {
          if (isRecord(variantVal) && isMediaVideoUrl(variantVal.url)) {
            addStream(variantVal.url, variantKey, `${vPath}.${variantKey}`, {
              width: variantVal.width,
              height: variantVal.height,
              duration: variantVal.duration,
              thumbnail: variantVal.thumbnail,
            });
          } else if (isMediaVideoUrl(variantVal)) {
            addStream(variantVal, variantKey, `${vPath}.${variantKey}`);
          }
        }
      }

      // Detect Schema.org VideoObject
      if (node['@type'] === 'VideoObject' && isMediaVideoUrl(node.contentUrl)) {
        matchedPaths.push(`${path}.contentUrl`);
        rawVideoBlocks.push(node);
        addStream(node.contentUrl, 'VideoObject', `${path}.contentUrl`, {
          width: node.width,
          height: node.height,
          thumbnail: node.thumbnailUrl,
        });
      }

      for (const [key, val] of Object.entries(node)) {
        if (key === 'video_list') continue;
        walk(val, `${path}.${key}`, depth + 1);
      }
    }
  }

  walk(root, basePath, 0);

  // Sort streams: MP4 first, then WEBM, then HLS; within format sort by resolution descending
  streams.sort((a, b) => {
    const formatScore = (f: VideoStream['format']) =>
      f === 'MP4' ? 3 : f === 'WEBM' ? 2 : f === 'HLS' ? 1 : 0;
    const scoreDiff = formatScore(b.format) - formatScore(a.format);
    if (scoreDiff !== 0) return scoreDiff;

    const areaA = (a.width || 0) * (a.height || 0);
    const areaB = (b.width || 0) * (b.height || 0);
    if (areaB !== areaA) return areaB - areaA;

    // Prefer V_720P or V_EXP7 over lower EXP tags
    const priority = (k: string) => {
      if (k.includes('720')) return 100;
      if (k.includes('1080')) return 120;
      if (k.includes('EXP7')) return 90;
      if (k.includes('EXP6')) return 80;
      if (k.includes('480')) return 70;
      if (k.includes('EXP5')) return 60;
      if (k.includes('360')) return 50;
      return 10;
    };
    return priority(b.key) - priority(a.key);
  });

  return {
    streams,
    matchedPaths: Array.from(new Set(matchedPaths)),
    rawVideoBlocks,
  };
}

function findPinMetadata(root: unknown, fallbackPinId: string | null): {
  pinId: string | null;
  title: string;
  description: string;
  creator: string | null;
  thumbnailUrl: string | null;
  sourceUrl: string | null;
} {
  let pinId = fallbackPinId;
  let title = '';
  let description = '';
  let creator: string | null = null;
  let thumbnailUrl: string | null = null;
  let sourceUrl: string | null = null;

  const visited = new Set<object>();

  function scan(node: unknown, depth: number) {
    if (depth > 14 || !node || typeof node !== 'object') return;
    if (visited.has(node)) return;
    visited.add(node);

    if (Array.isArray(node)) {
      for (const item of node) scan(item, depth + 1);
      return;
    }

    if (isRecord(node)) {
      if (!pinId && (typeof node.id === 'string' || typeof node.id === 'number')) {
        const idStr = String(node.id);
        if (/^\d{6,}$/.test(idStr)) pinId = idStr;
      }

      if (!title) {
        if (typeof node.grid_title === 'string' && node.grid_title.trim()) {
          title = node.grid_title.trim();
        } else if (typeof node.title === 'string' && node.title.trim()) {
          title = node.title.trim();
        } else if (typeof node.name === 'string' && node.name.trim()) {
          title = node.name.trim();
        }
      }

      if (!description && typeof node.description === 'string' && node.description.trim()) {
        description = node.description.trim();
      }

      if (!creator) {
        if (isRecord(node.pinner)) {
          const pName = node.pinner.full_name || node.pinner.username;
          if (typeof pName === 'string' && pName.trim()) creator = pName.trim();
        } else if (isRecord(node.native_creator)) {
          const cName = node.native_creator.full_name || node.native_creator.username;
          if (typeof cName === 'string' && cName.trim()) creator = cName.trim();
        } else if (typeof node.creator === 'string' && node.creator.trim()) {
          creator = node.creator.trim();
        }
      }

      if (!thumbnailUrl && isRecord(node.images)) {
        const orig = node.images.orig || node.images['736x'] || node.images['564x'] || node.images['474x'];
        if (isRecord(orig) && typeof orig.url === 'string') {
          thumbnailUrl = orig.url;
        }
      }

      if (!thumbnailUrl && typeof node.thumbnailUrl === 'string' && node.thumbnailUrl.startsWith('http')) {
        thumbnailUrl = node.thumbnailUrl;
      }

      if (!sourceUrl && typeof node.url === 'string' && PIN_URL_REGEX.test(node.url)) {
        sourceUrl = node.url;
      }

      for (const val of Object.values(node)) {
        scan(val, depth + 1);
      }
    }
  }

  scan(root, 0);

  return {
    pinId,
    title: title || (pinId ? `Pinterest Pin ${pinId}` : 'Extracted Pinterest Video'),
    description,
    creator,
    thumbnailUrl,
    sourceUrl,
  };
}

export function extractPinFromJsonPayload(
  jsonInput: unknown,
  options?: {
    pinId?: string | null;
    sourceUrl?: string | null;
    extractionMethod?: string;
    fallbackTitle?: string;
    fallbackThumbnail?: string | null;
  }
): ExtractedPinData {
  const { streams, matchedPaths, rawVideoBlocks } = extractVideoStreamsFromObject(jsonInput);
  const meta = findPinMetadata(jsonInput, options?.pinId ?? null);

  const primaryStream = streams.find((s) => s.format === 'MP4') || streams[0] || null;
  const streamThumbnail = streams.find((s) => s.thumbnail)?.thumbnail || null;

  return {
    pinId: meta.pinId || options?.pinId || null,
    sourceUrl: options?.sourceUrl || meta.sourceUrl || null,
    title: meta.title || options?.fallbackTitle || 'Extracted Pinterest Video',
    description: meta.description,
    creator: meta.creator,
    thumbnailUrl: meta.thumbnailUrl || streamThumbnail || options?.fallbackThumbnail || null,
    streams,
    primaryStream,
    extractedAt: new Date().toISOString(),
    extractionMethod: options?.extractionMethod || 'JSON Recursive AST Traversal',
    matchedJsonPaths: matchedPaths,
    rawVideoBlock: rawVideoBlocks.length === 1 ? rawVideoBlocks[0] : rawVideoBlocks,
  };
}

export function formatDurationMs(ms: number | null): string {
  if (!ms || ms <= 0) return '—';
  const totalSec = Math.round(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatResolution(width: number | null, height: number | null): string {
  if (!width || !height) return 'Auto';
  return `${width} × ${height}`;
}

export const DEVTOOLS_SNIPPET = `(() => {
  const pws = document.getElementById('__PWS_DATA__');
  if (pws) {
    copy(pws.textContent);
    console.log('Copied __PWS_DATA__ JSON to clipboard!');
    return;
  }
  const scripts = [...document.querySelectorAll('script[type="application/json"]')];
  const videoScript = scripts.find(s => s.textContent.includes('video_list'));
  if (videoScript) {
    copy(videoScript.textContent);
    console.log('Copied Pinterest video JSON to clipboard!');
  } else {
    console.warn('No video_list JSON found on this page.');
  }
})();`;
