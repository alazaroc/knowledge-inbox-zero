import { canonicalizeUrl, deriveDocumentId } from '@app/shared';

/**
 * Golden / edge unit tests for URL canonicalization (shared/src/url.ts).
 *
 * Task 2.4 — explicit input→expected assertions for the tricky cases.
 * Requirements: 4.1, 2.4, 2.5
 */
describe('canonicalizeUrl — golden cases', () => {
  it('strips utm_* tracking params', () => {
    expect(canonicalizeUrl('https://example.com/a?utm_source=news&utm_medium=email')).toBe(
      'https://example.com/a'
    );
  });

  it('strips fbclid / gclid and other denylisted trackers', () => {
    expect(canonicalizeUrl('https://example.com/post?fbclid=abc123')).toBe(
      'https://example.com/post'
    );
    expect(canonicalizeUrl('https://example.com/post?gclid=xyz&ref=twitter')).toBe(
      'https://example.com/post'
    );
  });

  it('keeps non-tracking query params but drops trackers mixed in', () => {
    expect(canonicalizeUrl('https://example.com/search?q=cats&utm_source=news')).toBe(
      'https://example.com/search?q=cats'
    );
  });

  it('removes the default http port (80)', () => {
    expect(canonicalizeUrl('http://example.com:80/path')).toBe('http://example.com/path');
  });

  it('removes the default https port (443)', () => {
    expect(canonicalizeUrl('https://example.com:443/path')).toBe('https://example.com/path');
  });

  it('keeps a non-default port', () => {
    expect(canonicalizeUrl('https://example.com:8443/path')).toBe('https://example.com:8443/path');
  });

  it('drops the fragment', () => {
    expect(canonicalizeUrl('https://example.com/doc#section-2')).toBe('https://example.com/doc');
  });

  it('prepends https:// when the scheme is missing', () => {
    expect(canonicalizeUrl('example.com/path')).toBe('https://example.com/path');
  });

  it('normalizes a trailing slash on a path', () => {
    expect(canonicalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
  });

  it('keeps the root "/" slash', () => {
    expect(canonicalizeUrl('https://example.com/')).toBe('https://example.com/');
    expect(canonicalizeUrl('https://example.com')).toBe('https://example.com/');
  });

  it('sorts remaining query params for stable output', () => {
    expect(canonicalizeUrl('https://example.com/s?z=1&a=2&m=3')).toBe(
      'https://example.com/s?a=2&m=3&z=1'
    );
  });

  it('lowercases scheme and host but preserves path case', () => {
    expect(canonicalizeUrl('HTTPS://Example.COM/Path/To/Doc')).toBe(
      'https://example.com/Path/To/Doc'
    );
  });

  it('trims surrounding whitespace', () => {
    expect(canonicalizeUrl('  https://example.com/x  ')).toBe('https://example.com/x');
  });

  it('is idempotent on an already-canonical URL', () => {
    const once = canonicalizeUrl('https://example.com/a?b=2&utm_source=x#frag');
    expect(canonicalizeUrl(once)).toBe(once);
    expect(once).toBe('https://example.com/a?b=2');
  });

  it('throws on syntactically invalid input', () => {
    expect(() => canonicalizeUrl('http://')).toThrow();
    expect(() => canonicalizeUrl(':::::')).toThrow();
    expect(() => canonicalizeUrl('')).toThrow();
  });
});

describe('deriveDocumentId', () => {
  it('is a deterministic 64-char sha256 hex digest', () => {
    const id = deriveDocumentId('owner-1', 'https://example.com/a');
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(deriveDocumentId('owner-1', 'https://example.com/a')).toBe(id);
  });

  it('collides for the same owner + canonical URL across tracking-only differences', () => {
    const a = canonicalizeUrl('https://example.com/a?utm_source=x');
    const b = canonicalizeUrl('https://example.com/a');
    expect(deriveDocumentId('owner-1', a)).toBe(deriveDocumentId('owner-1', b));
  });

  it('differs by owner and by URL', () => {
    const url = 'https://example.com/a';
    expect(deriveDocumentId('owner-1', url)).not.toBe(deriveDocumentId('owner-2', url));
    expect(deriveDocumentId('owner-1', url)).not.toBe(
      deriveDocumentId('owner-1', 'https://example.com/b')
    );
  });
});
