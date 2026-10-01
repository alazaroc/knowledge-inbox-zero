import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
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

/**
 * Extract the readable main content + metadata from an HTML string using
 * @mozilla/readability over a jsdom document (Req 4.2).
 */
function readabilityExtract(html: string, url: string): { text?: string; metadata: DocMetadata } {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  const metadata = domainOnly(url);

  const article = new Readability(doc).parse();

  if (article) {
    if (article.title?.trim()) metadata.title = article.title.trim();
    if (article.byline?.trim()) metadata.author = article.byline.trim();
  }

  // Published date is not surfaced by Readability; read it from common meta tags.
  const published = readPublishedAt(doc);
  if (published) metadata.publishedAt = published;

  const text = article?.textContent?.trim() ? article.textContent : undefined;

  return { text, metadata };
}

/**
 * Best-effort extraction of a publication date from common metadata tags,
 * normalized to an ISO string when parseable.
 */
function readPublishedAt(doc: Document): string | undefined {
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
    const el = doc.querySelector(selector);
    const content = el?.getAttribute('content')?.trim();
    if (content) {
      const parsed = new Date(content);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
  }

  const timeEl = doc.querySelector('time[datetime]');
  const datetime = timeEl?.getAttribute('datetime')?.trim();
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

    const html = await res.text();
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
