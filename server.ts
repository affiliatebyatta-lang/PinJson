import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import {
  extractPinFromJsonPayload,
  extractPinIdFromUrl,
  isValidPinterestUrl,
} from './src/lib/pinterestJsonParser.ts';
import type { ExtractedPinData } from './src/lib/pinterestJsonParser.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};

function isAllowedMediaHost(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    return host === 'pinimg.com' || host.endsWith('.pinimg.com');
  } catch {
    return false;
  }
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractMetaTag(html: string, nameOrProp: string): string | null {
  const escaped = nameOrProp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern1 = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    'i'
  );
  const pattern2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
    'i'
  );
  const match = html.match(pattern1) || html.match(pattern2);
  return match ? decodeHtmlEntities(match[1]) : null;
}

function extractScriptJsonBlocks(html: string): {
  pwsData: unknown | null;
  jsonScripts: unknown[];
  ldJsonBlocks: unknown[];
} {
  let pwsData: unknown | null = null;
  const jsonScripts: unknown[] = [];
  const ldJsonBlocks: unknown[] = [];

  const pwsMatch = html.match(
    /<script[^>]+id=["']__PWS_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (pwsMatch && pwsMatch[1]) {
    try {
      pwsData = JSON.parse(pwsMatch[1].trim());
    } catch {
      // Ignore malformed __PWS_DATA__
    }
  }

  const scriptRegex =
    /<script[^>]+type=["'](application\/json|application\/ld\+json)["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html)) !== null) {
    const scriptType = match[1].toLowerCase();
    const content = match[2].trim();
    if (!content) continue;
    try {
      const parsed = JSON.parse(content);
      if (scriptType === 'application/ld+json') {
        ldJsonBlocks.push(parsed);
      } else {
        jsonScripts.push(parsed);
      }
    } catch {
      // Ignore non-JSON script blocks
    }
  }

  return { pwsData, jsonScripts, ldJsonBlocks };
}

function scopePwsDataToPin(pwsData: unknown, pinId: string | null): unknown {
  if (!pwsData || typeof pwsData !== 'object') return pwsData;
  const record = pwsData as Record<string, unknown>;
  const props = record.props as Record<string, unknown> | undefined;
  const redux = props?.initialReduxState as Record<string, unknown> | undefined;

  if (redux && typeof redux === 'object') {
    const pins = redux.pins as Record<string, unknown> | undefined;
    if (pins && pinId && pins[pinId]) {
      return pins[pinId];
    }
    if (pins && Object.keys(pins).length > 0) {
      const firstKey = Object.keys(pins)[0];
      return pins[firstKey];
    }
    if (redux.resources) {
      return redux.resources;
    }
  }
  return pwsData;
}

async function fetchPinResourceJson(pinId: string): Promise<unknown | null> {
  const dataParam = JSON.stringify({
    options: {
      id: pinId,
      field_set_key: 'unauth_react_main_pin',
    },
  });
  const resourceUrl = `https://www.pinterest.com/resource/PinResource/get/?source_url=${encodeURIComponent(
    `/pin/${pinId}/`
  )}&data=${encodeURIComponent(dataParam)}`;

  try {
    const resp = await fetch(resourceUrl, {
      headers: {
        'User-Agent': BROWSER_HEADERS['User-Agent'],
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-Requested-With': 'XMLHttpRequest',
        'X-Pinterest-AppState': 'active',
        'X-Pinterest-Source-Url': `/pin/${pinId}/`,
        Referer: `https://www.pinterest.com/pin/${pinId}/`,
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as Record<string, unknown>;
    const resResponse = json.resource_response as Record<string, unknown> | undefined;
    if (resResponse && resResponse.data) {
      return resResponse.data;
    }
    return json;
  } catch {
    return null;
  }
}

async function extractFromPinterestUrl(rawUrl: string): Promise<{
  pin: ExtractedPinData;
  rawJson: unknown;
}> {
  const response = await fetch(rawUrl, {
    headers: BROWSER_HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) {
    throw new Error(
      `Pinterest returned HTTP ${response.status}. Try copying the Pin JSON via DevTools and using the Raw JSON tab.`
    );
  }

  const finalUrl = response.url || rawUrl;
  const pinId = extractPinIdFromUrl(finalUrl) || extractPinIdFromUrl(rawUrl);
  const html = await response.text();

  const ogTitle = extractMetaTag(html, 'og:title');
  const ogImage = extractMetaTag(html, 'og:image');
  const ogVideo =
    extractMetaTag(html, 'og:video:secure_url') ||
    extractMetaTag(html, 'og:video:url') ||
    extractMetaTag(html, 'og:video');

  const { pwsData, jsonScripts, ldJsonBlocks } = extractScriptJsonBlocks(html);

  // 1. Try __PWS_DATA__ scoped to pin
  if (pwsData) {
    const scoped = scopePwsDataToPin(pwsData, pinId);
    const extracted = extractPinFromJsonPayload(scoped, {
      pinId,
      sourceUrl: finalUrl,
      extractionMethod: '__PWS_DATA__ JSON',
      fallbackTitle: ogTitle || undefined,
      fallbackThumbnail: ogImage,
    });
    if (extracted.streams.length > 0) {
      return { pin: extracted, rawJson: scoped };
    }
  }

  // 2. Try other embedded application/json script tags
  for (const scriptObj of jsonScripts) {
    const extracted = extractPinFromJsonPayload(scriptObj, {
      pinId,
      sourceUrl: finalUrl,
      extractionMethod: 'Embedded Script JSON',
      fallbackTitle: ogTitle || undefined,
      fallbackThumbnail: ogImage,
    });
    if (extracted.streams.length > 0) {
      return { pin: extracted, rawJson: scriptObj };
    }
  }

  // 3. Try PinResource JSON endpoint directly if we have a pinId
  if (pinId) {
    const resourceData = await fetchPinResourceJson(pinId);
    if (resourceData) {
      const extracted = extractPinFromJsonPayload(resourceData, {
        pinId,
        sourceUrl: finalUrl,
        extractionMethod: 'Pinterest PinResource JSON API',
        fallbackTitle: ogTitle || undefined,
        fallbackThumbnail: ogImage,
      });
      if (extracted.streams.length > 0) {
        return { pin: extracted, rawJson: resourceData };
      }
    }
  }

  // 4. Try JSON-LD VideoObject
  for (const ldObj of ldJsonBlocks) {
    const extracted = extractPinFromJsonPayload(ldObj, {
      pinId,
      sourceUrl: finalUrl,
      extractionMethod: 'JSON-LD VideoObject',
      fallbackTitle: ogTitle || undefined,
      fallbackThumbnail: ogImage,
    });
    if (extracted.streams.length > 0) {
      return { pin: extracted, rawJson: ldObj };
    }
  }

  // 5. Fallback: look for direct video_list or pinimg video URLs inside inline scripts/HTML
  const mp4Matches = html.match(
    /https:\/\/v[0-9a-z-]*\.pinimg\.com\/videos\/[^"'\s\\<>]+\.(?:mp4|m3u8)/gi
  );
  if (mp4Matches && mp4Matches.length > 0) {
    const uniqueUrls = Array.from(new Set(mp4Matches));
    const syntheticJson = {
      id: pinId,
      url: finalUrl,
      title: ogTitle || `Pinterest Pin ${pinId || ''}`.trim(),
      thumbnailUrl: ogImage,
      videos: {
        video_list: Object.fromEntries(
          uniqueUrls.map((u, idx) => [
            u.includes('720p') ? 'V_720P' : `V_STREAM_${idx + 1}`,
            { url: u, thumbnail: ogImage },
          ])
        ),
      },
    };
    const extracted = extractPinFromJsonPayload(syntheticJson, {
      pinId,
      sourceUrl: finalUrl,
      extractionMethod: 'HTML Video CDN Extraction -> JSON',
      fallbackTitle: ogTitle || undefined,
      fallbackThumbnail: ogImage,
    });
    return { pin: extracted, rawJson: syntheticJson };
  }

  // 6. Fallback to OpenGraph video tag if present
  if (ogVideo) {
    const ogJson = {
      id: pinId,
      url: finalUrl,
      title: ogTitle || 'Pinterest Video',
      thumbnailUrl: ogImage,
      videos: {
        video_list: {
          V_OG: { url: ogVideo, thumbnail: ogImage },
        },
      },
    };
    const extracted = extractPinFromJsonPayload(ogJson, {
      pinId,
      sourceUrl: finalUrl,
      extractionMethod: 'OpenGraph Meta -> JSON',
    });
    return { pin: extracted, rawJson: ogJson };
  }

  throw new Error(
    'No video stream found in this Pinterest pin. Verify the pin contains a video (not a static image), or paste its __PWS_DATA__ JSON in the Raw JSON tab.'
  );
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post('/api/extract', async (req: Request, res: Response) => {
    try {
      const { url, json } = req.body as { url?: unknown; json?: unknown };

      if (json !== undefined && json !== null && json !== '') {
        let parsed: unknown = json;
        if (typeof json === 'string') {
          try {
            parsed = JSON.parse(json);
          } catch {
            res.status(400).json({
              ok: false,
              mode: 'json',
              pins: [],
              rawJson: null,
              error: 'Invalid JSON syntax. Please verify brackets, quotes, and commas.',
            });
            return;
          }
        }

        // Support array of URLs or array of Pin JSON objects
        if (Array.isArray(parsed)) {
          const allStringUrls =
            parsed.length > 0 && parsed.every((item) => typeof item === 'string');

          if (allStringUrls) {
            const urls = (parsed as string[]).slice(0, 10);
            const pins: ExtractedPinData[] = [];
            const rawResults: unknown[] = [];

            for (const itemUrl of urls) {
              if (!isValidPinterestUrl(itemUrl)) continue;
              try {
                const { pin, rawJson } = await extractFromPinterestUrl(itemUrl.trim());
                pins.push(pin);
                rawResults.push(rawJson);
              } catch {
                // Continue batch on individual failure
              }
            }

            if (pins.length === 0) {
              res.status(422).json({
                ok: false,
                mode: 'batch',
                pins: [],
                rawJson: parsed,
                error:
                  'Could not extract video streams from the provided URLs in the JSON array.',
              });
              return;
            }

            res.json({
              ok: true,
              mode: 'batch',
              pins,
              rawJson: rawResults,
            });
            return;
          }

          // Array of Pin JSON objects
          const pins = parsed
            .map((item) =>
              extractPinFromJsonPayload(item, {
                extractionMethod: 'Batch JSON Array Parser',
              })
            )
            .filter((p) => p.streams.length > 0);

          if (pins.length === 0) {
            res.status(422).json({
              ok: false,
              mode: 'json',
              pins: [],
              rawJson: parsed,
              error:
                'No video_list or MP4/HLS video URLs were found inside the JSON array.',
            });
            return;
          }

          res.json({
            ok: true,
            mode: 'json',
            pins,
            rawJson: parsed,
          });
          return;
        }

        // Single JSON object with { url: "https://pinterest.com/pin/..." }
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          'url' in parsed &&
          typeof (parsed as Record<string, unknown>).url === 'string' &&
          isValidPinterestUrl((parsed as Record<string, unknown>).url as string) &&
          extractPinFromJsonPayload(parsed).streams.length === 0
        ) {
          const targetUrl = ((parsed as Record<string, unknown>).url as string).trim();
          const { pin, rawJson } = await extractFromPinterestUrl(targetUrl);
          res.json({
            ok: true,
            mode: 'url',
            pins: [pin],
            rawJson,
          });
          return;
        }

        const pin = extractPinFromJsonPayload(parsed, {
          extractionMethod: 'Direct JSON AST Extraction',
        });

        if (pin.streams.length === 0) {
          res.status(422).json({
            ok: false,
            mode: 'json',
            pins: [],
            rawJson: parsed,
            error:
              'Valid JSON parsed, but no video_list or MP4/HLS video stream URLs were found.',
          });
          return;
        }

        res.json({
          ok: true,
          mode: 'json',
          pins: [pin],
          rawJson: parsed,
        });
        return;
      }

      if (typeof url === 'string' && url.trim()) {
        const cleanUrl = url.trim();
        if (!isValidPinterestUrl(cleanUrl)) {
          res.status(400).json({
            ok: false,
            mode: 'url',
            pins: [],
            rawJson: null,
            error:
              'Please enter a valid Pinterest link (e.g., https://www.pinterest.com/pin/... or https://pin.it/...).',
          });
          return;
        }

        const { pin, rawJson } = await extractFromPinterestUrl(cleanUrl);
        res.json({
          ok: true,
          mode: 'url',
          pins: [pin],
          rawJson,
        });
        return;
      }

      res.status(400).json({
        ok: false,
        mode: 'url',
        pins: [],
        rawJson: null,
        error: 'Provide either a Pinterest URL or a JSON payload.',
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unexpected extraction error.';
      res.status(422).json({
        ok: false,
        mode: 'url',
        pins: [],
        rawJson: null,
        error: message,
        hint: 'If Pinterest blocks automated server requests for this pin, copy the __PWS_DATA__ JSON from your browser DevTools and paste it into the Raw JSON tab.',
      });
    }
  });

  app.get('/api/download', async (req: Request, res: Response) => {
    const targetUrl = typeof req.query.url === 'string' ? req.query.url : '';
    const requestedName =
      typeof req.query.filename === 'string' ? req.query.filename : 'pinterest-video.mp4';

    if (!targetUrl || !isAllowedMediaHost(targetUrl)) {
      res.status(400).json({
        ok: false,
        error: 'Download URL must point to a verified Pinterest media CDN (*.pinimg.com).',
      });
      return;
    }

    const safeFilename = requestedName.replace(/[^a-zA-Z0-9._-]/g, '_');

    try {
      const upstream = await fetch(targetUrl, {
        headers: {
          'User-Agent': BROWSER_HEADERS['User-Agent'],
          Referer: 'https://www.pinterest.com/',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!upstream.ok || !upstream.body) {
        res.status(upstream.status || 502).json({
          ok: false,
          error: `Upstream CDN returned HTTP ${upstream.status}.`,
        });
        return;
      }

      const contentType = upstream.headers.get('content-type') || 'video/mp4';
      const contentLength = upstream.headers.get('content-length');

      res.setHeader('Content-Type', contentType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${safeFilename}"`
      );
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }

      const nodeStream = Readable.fromWeb(
        upstream.body as unknown as import('stream/web').ReadableStream
      );
      nodeStream.pipe(res);
    } catch {
      res.status(502).json({
        ok: false,
        error: 'Failed to stream video from Pinterest CDN.',
      });
    }
  });

  app.get('/api/proxy-media', async (req: Request, res: Response) => {
    const targetUrl = typeof req.query.url === 'string' ? req.query.url : '';
    if (!targetUrl || !isAllowedMediaHost(targetUrl)) {
      res.status(400).send('Invalid media host.');
      return;
    }

    try {
      const headers: Record<string, string> = {
        'User-Agent': BROWSER_HEADERS['User-Agent'],
        Referer: 'https://www.pinterest.com/',
      };
      if (req.headers.range) {
        headers.Range = req.headers.range;
      }

      const upstream = await fetch(targetUrl, {
        headers,
        signal: AbortSignal.timeout(20000),
      });

      if (!upstream.ok && upstream.status !== 206) {
        res.status(upstream.status).send('Media unavailable');
        return;
      }

      res.status(upstream.status);
      const passHeaders = [
        'content-type',
        'content-length',
        'content-range',
        'accept-ranges',
      ];
      for (const h of passHeaders) {
        const val = upstream.headers.get(h);
        if (val) res.setHeader(h, val);
      }
      res.setHeader('Cache-Control', 'public, max-age=3600');

      if (upstream.body) {
        const nodeStream = Readable.fromWeb(
          upstream.body as unknown as import('stream/web').ReadableStream
        );
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch {
      res.status(502).send('Media proxy error');
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PinJSON server running on http://localhost:${PORT}`);
  });
}

startServer();
