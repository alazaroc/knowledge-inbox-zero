import * as cheerio from 'cheerio';
import type { DocMetadata } from '@app/shared';

// Result of attempting to retrieve + extract readable content for a URL.
export interface RetrieveResult {
  html?: string;
  text?: string;
  metadata: DocMetadata;
  degraded: boolean;
  reason?: string;
}

const RETRIEVE_TIMEOUT_MS = 15_000; // Req 4.4

// A desktop-browser User-Agent. Some hosts (notably YouTube from datacenter /
// AWS IP ranges) serve a stripped page — without the player response that holds
// the caption tracks — to non-browser or server clients. Presenting a real
// browser UA + the EU consent cookie materially raises the hit rate for the
// transcript path (it does not make it guaranteed from an AWS IP).
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Build metadata containing only the source domain, used whenever retrieval
 * fails or the content is not parseable (Req 4.5). Falls back gracefully if the
 * URL cannot be parsed.
 */
export function domainOnly(url: string): DocMetadata {
  try {
    return { sourceDomain: new URL(url).hostname };
  } catch {
    return {};
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

// --------------------------------------------------------------------------
// YouTube transcript support (#1).
// A YouTube URL has no readable article body, so instead of scraping the page
// we fetch the video's TRANSCRIPT (its caption track) and feed THAT through the
// same extract→score→explain pipeline. Captions are free text already, no
// audio download or speech-to-text needed.
// --------------------------------------------------------------------------

/** Extract the 11-char video id from the common YouTube URL shapes, else null. */
export function youtubeVideoId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0];
    return /^[\w-]{11}$/.test(id) ? id : null;
  }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    if (u.pathname === '/watch') {
      const id = u.searchParams.get('v') ?? '';
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    // /embed/<id>, /shorts/<id>, /live/<id>
    const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/);
    if (m) return m[1];
  }
  return null;
}

/** Decode the handful of XML entities that appear in caption text. */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

/**
 * Fetch a YouTube video's transcript + title via the public watch page and the
 * timedtext caption endpoint. No API key, no audio processing. Prefers a
 * manually-authored caption track, else the first available (often auto-generated).
 * Returns degraded when the video has no captions at all.
 */
async function retrieveYoutube(url: string, videoId: string): Promise<RetrieveResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RETRIEVE_TIMEOUT_MS);
  timer.unref?.();
  const metadata = domainOnly(url);
  try {
    // 1. Load the watch page to read the title and the caption-track list.
    const page = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'accept-language': 'en-US,en;q=0.9',
        // Present as a real desktop browser and pre-accept the EU consent gate;
        // otherwise YouTube (especially from datacenter IPs) serves a reduced
        // page without the captionTracks we need (observed in prod: no_captions
        // for videos that DO have captions). See BROWSER_UA.
        'user-agent': BROWSER_UA,
        cookie: 'CONSENT=YES+1',
      },
    });
    if (!page.ok) return { metadata, degraded: true, reason: `http_${page.status}` };
    const body = await page.text();

    const titleMatch =
      body.match(/<meta\s+property="og:title"\s+content="([^"]*)"/i) ||
      body.match(/<title>([^<]*)<\/title>/i);
    if (titleMatch)
      metadata.title = decodeXmlEntities(titleMatch[1])
        .replace(/ - YouTube$/, '')
        .trim();

    // 2. Find caption tracks in the embedded player response JSON.
    const tracks = extractCaptionTracks(body);
    if (tracks.length === 0) {
      return { metadata, degraded: true, reason: 'no_captions' };
    }
    // Prefer a manually-created track, else the first (usually auto-generated).
    const chosen = tracks.find((t) => t.kind !== 'asr') ?? tracks[0];

    // 3. Fetch the transcript XML and turn it into plain text.
    const capRes = await fetch(chosen.baseUrl, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': BROWSER_UA, 'accept-language': 'en-US,en;q=0.9' },
    });
    if (!capRes.ok) return { metadata, degraded: true, reason: 'caption_fetch_failed' };
    const xml = await capRes.text();
    const lines = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) =>
      decodeXmlEntities(m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ')).trim()
    );
    const transcript = lines.filter(Boolean).join(' ');
    if (!transcript.trim()) return { metadata, degraded: true, reason: 'no_readable_text' };

    const titleLine = metadata.title ? `# ${metadata.title}\n\n` : '';
    const text = `${titleLine}Video transcript:\n\n${transcript}`;
    return { text, metadata, degraded: false };
  } catch (err) {
    return { metadata, degraded: true, reason: isAbortError(err) ? 'timeout' : 'fetch_failed' };
  } finally {
    clearTimeout(timer);
  }
}

/** Parse the captionTracks array out of a watch page's ytInitialPlayerResponse. */
function extractCaptionTracks(html: string): { baseUrl: string; kind?: string }[] {
  const marker = '"captionTracks":';
  const at = html.indexOf(marker);
  if (at === -1) return [];
  // Slice from the array's opening bracket to its matching close.
  const start = html.indexOf('[', at);
  if (start === -1) return [];
  let depth = 0;
  let end = -1;
  for (let i = start; i < html.length; i++) {
    if (html[i] === '[') depth++;
    else if (html[i] === ']' && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end === -1) return [];
  try {
    const arr = JSON.parse(html.slice(start, end + 1)) as { baseUrl?: string; kind?: string }[];
    return arr
      .filter((t) => typeof t.baseUrl === 'string')
      .map((t) => ({ baseUrl: t.baseUrl as string, kind: t.kind }));
  } catch {
    return [];
  }
}

/**
 * Decode a fetched HTML body honoring its declared charset.
 *
 * `Response.text()` always assumes UTF-8, which mangles pages served as
 * windows-1252 / ISO-8859-1 (common on older Spanish-content sites): accented
 * characters become U+FFFD "�". We instead read the raw bytes and pick the
 * charset from the HTTP `content-type`, then the `<meta charset>` /
 * `<meta http-equiv>` declaration, defaulting to UTF-8. Unknown labels fall
 * back to UTF-8 (TextDecoder would otherwise throw).
 */
function decodeBody(buffer: ArrayBuffer, contentType: string): string {
  const bytes = new Uint8Array(buffer);

  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  // Sniff the first ~2KB as latin1 (lossless byte→char) to read the <meta> tag
  // before we know the real charset — the charset declaration itself is ASCII.
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
  const fromMeta =
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ||
    /<meta[^>]+content=["'][^"']*charset=([\w-]+)/i.exec(head)?.[1];

  const label = (fromHeader || fromMeta || 'utf-8').toLowerCase();

  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    // Unsupported/invalid charset label — decode as UTF-8 rather than fail.
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/**
 * Extract the readable main content + metadata from an HTML string using
 * cheerio (Req 4.2). cheerio is a pure Node HTML parser with no browser-asset
 * dependency, so it runs cleanly inside the Lambda bundle — unlike jsdom, which
 * reads a stylesheet file from its package directory at runtime that esbuild
 * does not bundle (ENOENT /browser/default-stylesheet.css crashed the worker).
 */
export function readabilityExtract(
  html: string,
  url: string
): { text?: string; metadata: DocMetadata } {
  const $ = cheerio.load(html);

  const metadata = domainOnly(url);

  // Title: prefer og:title, then <title>, then first <h1>.
  const title =
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('title').first().text().trim() ||
    $('h1').first().text().trim();
  if (title) metadata.title = title;

  // Author: common author meta tags, then rel=author.
  const author =
    $('meta[name="author"]').attr('content')?.trim() ||
    $('meta[property="article:author"]').attr('content')?.trim() ||
    $('[rel="author"]').first().text().trim();
  if (author) metadata.author = author;

  const published = readPublishedAt($);
  if (published) metadata.publishedAt = published;

  // Share thumbnail: og:image, then twitter:image. Resolve relative URLs
  // against the page URL (some sites emit a path-only og:image). http(s) only.
  const rawImage =
    $('meta[property="og:image"]').attr('content')?.trim() ||
    $('meta[property="og:image:url"]').attr('content')?.trim() ||
    $('meta[name="twitter:image"]').attr('content')?.trim() ||
    $('meta[name="twitter:image:src"]').attr('content')?.trim();
  if (rawImage) {
    try {
      const abs = new URL(rawImage, url).href;
      if (/^https?:\/\//i.test(abs)) metadata.imageUrl = abs;
    } catch {
      // Malformed image URL — just skip it.
    }
  }

  // Readable text: drop non-content noise, then prefer the main content region.
  $('script, style, noscript, nav, header, footer, aside, form, iframe, svg').remove();

  const container =
    pickFirstNonEmpty($, [
      'article',
      'main',
      '[role="main"]',
      '#content',
      '.content',
      '.container',
      '#root',
      '[class*="hero"]',
      'section',
    ]) ?? $('body');

  // Readable text as lightweight MARKDOWN: headings, paragraphs and list items
  // keep their boundaries instead of being collapsed into one wall of text.
  // Flattening with a single whitespace pass (the old behaviour) glued every
  // block together, which both read badly in the profile preview and gave the
  // model a structureless blob to reason over.
  let text = structuredMarkdown($, container);

  // Fallback for landing/SaaS pages whose visible DOM is mostly chrome and
  // yields little text: synthesize a readable blob from metadata + headings +
  // paragraphs so a document still contributes topics to the extractor.
  if (text.length < 120) {
    text = landingFallbackText($, metadata) || text;
  }

  return { text: text || undefined, metadata };
}

/**
 * Build a best-effort text blob for pages with no substantial body text
 * (typical SaaS landing pages): title + meta/og description + headings +
 * paragraphs. Returns an empty string when nothing useful is found.
 */
function landingFallbackText($: cheerio.CheerioAPI, metadata: DocMetadata): string {
  const parts: string[] = [];

  if (metadata.title) parts.push(metadata.title);

  const description =
    $('meta[name="description"]').attr('content')?.trim() ||
    $('meta[property="og:description"]').attr('content')?.trim();
  if (description) parts.push(description);

  $('h1, h2, h3').each((_, el) => {
    const t = normalizeWhitespace($(el).text());
    if (t) parts.push(t);
  });

  $('p, li').each((_, el) => {
    const t = normalizeWhitespace($(el).text());
    if (t.length > 20) parts.push(t);
  });

  return normalizeWhitespace(parts.join('. '));
}

/** First selector that yields a node with non-trivial text, else undefined. */
function pickFirstNonEmpty(
  $: cheerio.CheerioAPI,
  selectors: string[]
): ReturnType<cheerio.CheerioAPI> | undefined {
  for (const sel of selectors) {
    const el = $(sel).first();
    if (el.length && normalizeWhitespace(el.text()).length > 120) {
      return el;
    }
  }
  return undefined;
}

/** Collapse runs of whitespace/newlines into single spaces and trim. */
function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Serialize a content container into lightweight Markdown, preserving the
 * block structure the plain-text pass used to destroy: headings become `#`
 * lines, list items `- ` bullets, and paragraphs are separated by blank lines.
 * Inline whitespace inside each block is still normalized, so the output is
 * clean Markdown rather than raw HTML indentation.
 */
function structuredMarkdown(
  $: cheerio.CheerioAPI,
  container: ReturnType<cheerio.CheerioAPI>
): string {
  const blocks: string[] = [];
  const seen = new Set<unknown>();

  const push = (s: string) => {
    const t = normalizeWhitespace(s);
    if (t) blocks.push(t);
  };

  // Walk only block-level content nodes in document order. Nested blocks are
  // de-duplicated via `seen` so a <p> inside a matched <section> is not emitted
  // twice (once for the section text, once for itself).
  container.find('h1, h2, h3, h4, h5, h6, p, li, blockquote, pre').each((_, el) => {
    if (seen.has(el)) return;
    seen.add(el);
    const tag = (el as { tagName?: string }).tagName?.toLowerCase() ?? '';
    const raw = $(el).text();
    const text = normalizeWhitespace(raw);
    if (!text) return;

    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      push(`${'#'.repeat(level)} ${text}`);
    } else if (tag === 'li') {
      push(`- ${text}`);
    } else if (tag === 'blockquote') {
      push(`> ${text}`);
    } else if (tag === 'pre') {
      push('```\n' + raw.trim() + '\n```');
    } else {
      push(text);
    }
  });

  // No block-level children matched (rare, e.g. a <div>-only page): fall back
  // to the flat text so we never return empty.
  if (blocks.length === 0) return normalizeWhitespace(container.text());

  return blocks.join('\n\n');
}

/**
 * Best-effort extraction of a publication date from common metadata tags,
 * normalized to an ISO string when parseable.
 */
function readPublishedAt($: cheerio.CheerioAPI): string | undefined {
  const selectors = [
    'meta[property="article:published_time"]',
    'meta[name="article:published_time"]',
    'meta[name="date"]',
    'meta[name="dc.date"]',
    'meta[name="dc.date.issued"]',
    'meta[itemprop="datePublished"]',
    'meta[property="og:published_time"]',
  ];

  for (const selector of selectors) {
    const content = $(selector).attr('content')?.trim();
    if (content) {
      const parsed = new Date(content);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
  }

  const datetime = $('time[datetime]').first().attr('datetime')?.trim();
  if (datetime) {
    const parsed = new Date(datetime);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  return undefined;
}

/**
 * Retrieve a URL and extract its readable main content + metadata.
 *
 * Degrades gracefully (never throws) returning `degraded: true` with a `reason`
 * for: fetch timeouts (Req 4.4), non-OK HTTP responses, non-HTML/text content
 * types, dead/unreachable links, and documents with no readable text (Req 4.5).
 */
export async function retrieveReadable(url: string): Promise<RetrieveResult> {
  // #1: a YouTube URL has no article body — synthesize its content from the
  // video transcript instead of scraping the player page.
  const ytId = youtubeVideoId(url);
  if (ytId) return retrieveYoutube(url, ytId);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RETRIEVE_TIMEOUT_MS); // Req 4.4
  // Never let a pending abort timer keep the Lambda/process event loop alive
  // (avoids a dangling handle; `clearTimeout` in `finally` is still the normal path).
  timer.unref?.();

  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });

    if (!res.ok) {
      return { metadata: domainOnly(url), degraded: true, reason: `http_${res.status}` };
    }

    const type = res.headers.get('content-type') ?? '';
    if (!/text\/html|text\//.test(type)) {
      // Req 4.5 — non-HTML/text (e.g. PDF, binary) is not parseable here.
      return { metadata: domainOnly(url), degraded: true, reason: 'unparseable_content_type' };
    }

    const html = decodeBody(await res.arrayBuffer(), type);
    const { text, metadata } = readabilityExtract(html, url);

    if (!text?.trim()) {
      // Req 4.5 — reachable but no extractable readable text.
      return { metadata, degraded: true, reason: 'no_readable_text' };
    }

    return { html, text, metadata, degraded: false };
  } catch (err) {
    return {
      metadata: domainOnly(url),
      degraded: true,
      reason: isAbortError(err) ? 'timeout' : 'fetch_failed',
    };
  } finally {
    clearTimeout(timer);
  }
}
