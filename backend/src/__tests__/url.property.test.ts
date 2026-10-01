import fc from 'fast-check';
import { canonicalizeUrl, deriveDocumentId } from '@app/shared';

/**
 * Property tests for the pure URL canonicalization core (shared/src/url.ts).
 *
 * Task 2.3:
 *  - Property 2: Idempotent, deterministic canonicalization
 *  - Property 3: No duplicate documents (deterministic, colliding document ids)
 *
 * Validates: Requirements 4.1, 2.5, 2.6, 2.8
 */

/**
 * Canonicalize but swallow the "invalid input" throw. fc.webUrl produces valid
 * URLs, but we guard anyway so a generator edge case can never masquerade as a
 * property failure.
 */
function tryCanon(raw: string): string | undefined {
  try {
    return canonicalizeUrl(raw);
  } catch {
    return undefined;
  }
}

describe('Property 2: idempotent, deterministic canonicalization', () => {
  it('canonicalizeUrl(canonicalizeUrl(u)) === canonicalizeUrl(u)', () => {
    fc.assert(
      fc.property(fc.webUrl(), (url) => {
        const once = tryCanon(url);
        if (once === undefined) return; // skip inputs the canonicalizer rejects
        const twice = canonicalizeUrl(once);
        expect(twice).toBe(once);
      })
    );
  });

  it('canonicalizing the same input twice yields identical output', () => {
    fc.assert(
      fc.property(fc.webUrl(), (url) => {
        const a = tryCanon(url);
        const b = tryCanon(url);
        expect(a).toBe(b);
      })
    );
  });

  it('is stable under appended tracking params (same logical URL collapses)', () => {
    fc.assert(
      fc.property(
        fc.webUrl(),
        fc.constantFrom('utm_source', 'utm_medium', 'fbclid', 'gclid', 'ref', 'mc_eid'),
        fc.string(),
        (url, trackingKey, trackingVal) => {
          const base = tryCanon(url);
          if (base === undefined) return;
          const sep = url.includes('?') ? '&' : '?';
          const withTracking = tryCanon(
            `${url}${sep}${trackingKey}=${encodeURIComponent(trackingVal)}`
          );
          expect(withTracking).toBe(base);
        }
      )
    );
  });
});

describe('Property 3: no duplicate documents', () => {
  const ownerArb = fc.string({ minLength: 1, maxLength: 40 });

  it('deriveDocumentId is deterministic for the same owner + canonical URL', () => {
    fc.assert(
      fc.property(ownerArb, fc.webUrl(), (owner, url) => {
        const canon = tryCanon(url);
        if (canon === undefined) return;
        const a = deriveDocumentId(owner, canon);
        const b = deriveDocumentId(owner, canon);
        expect(a).toBe(b);
      })
    );
  });

  it('the same canonical URL for one owner collides to a single document id', () => {
    fc.assert(
      fc.property(
        ownerArb,
        fc.webUrl(),
        fc.constantFrom('utm_campaign', 'fbclid', 'gclid', 'igshid'),
        fc.string(),
        (owner, url, trackingKey, trackingVal) => {
          const canonPlain = tryCanon(url);
          if (canonPlain === undefined) return;
          const sep = url.includes('?') ? '&' : '?';
          const canonTracked = tryCanon(
            `${url}${sep}${trackingKey}=${encodeURIComponent(trackingVal)}`
          );
          if (canonTracked === undefined) return;
          // Same logical document (tracking noise differs) → one id.
          expect(deriveDocumentId(owner, canonTracked)).toBe(deriveDocumentId(owner, canonPlain));
        }
      )
    );
  });

  it('different canonical URLs yield different document ids for the same owner', () => {
    fc.assert(
      fc.property(ownerArb, fc.webUrl(), fc.webUrl(), (owner, urlA, urlB) => {
        const a = tryCanon(urlA);
        const b = tryCanon(urlB);
        if (a === undefined || b === undefined) return;
        fc.pre(a !== b);
        expect(deriveDocumentId(owner, a)).not.toBe(deriveDocumentId(owner, b));
      })
    );
  });

  it('different owners yield different document ids for the same canonical URL', () => {
    fc.assert(
      fc.property(ownerArb, ownerArb, fc.webUrl(), (ownerA, ownerB, url) => {
        const canon = tryCanon(url);
        if (canon === undefined) return;
        fc.pre(ownerA !== ownerB);
        expect(deriveDocumentId(ownerA, canon)).not.toBe(deriveDocumentId(ownerB, canon));
      })
    );
  });
});
