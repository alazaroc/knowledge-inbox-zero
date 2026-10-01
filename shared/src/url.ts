import { createHash } from 'node:crypto';

// Tracking/query parameters that carry no addressing meaning and should be
// stripped so the same logical document canonicalizes identically regardless
// of the campaign/referrer noise appended to its URL (Req 2.6, 2.8).
const TRACKING_PARAM_DENYLIST = [
  /^utm_/,
  /^fbclid$/,
  /^gclid$/,
  /^mc_eid$/,
  /^mc_cid$/,
  /^igshid$/,
  /^ref$/,
  /^ref_src$/,
  /^spm$/,
  /^_hsenc$/,
  /^_hsmi$/,
];

// Default ports per scheme — stripped so e.g. https://x:443/ === https://x/.
const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };

/**
 * Canonicalize a URL into a stable, comparable form.
 *
 * Deterministic and idempotent: lowercases scheme/host, strips default ports,
 * drops the fragment, removes tracking params via a denylist, sorts the
 * remaining params for stable output, normalizes a trailing slash (keeping the
 * root "/"), and prepends `https://` when a scheme is absent (Req 2.5).
 *
 * Throws on syntactically invalid input so callers can record it as rejected
 * (Req 2.4).
 */
export function canonicalizeUrl(raw: string): string {
  let input = raw.trim();
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input)) input = 'https://' + input; // Req 2.5
  const u = new URL(input); // throws → caller records rejected (Req 2.4)

  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();
  if (DEFAULT_PORTS[u.protocol] === u.port) u.port = ''; // strip default port
  u.hash = ''; // drop fragment

  // Remove tracking params, keep the rest, sort for stable output.
  const kept = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAM_DENYLIST.some((re) => re.test(k)))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  u.search = '';
  for (const [k, v] of kept) u.searchParams.append(k, v);

  // Normalize the path so repeated runs are stable in a single pass (Req 2.5):
  // collapse consecutive slashes to one, then strip a single trailing slash
  // while preserving the root "/".
  u.pathname = u.pathname.replace(/\/{2,}/g, '/');
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);

  return u.toString();
}

/** sha256 hex digest of the given string. */
function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Deterministic per-owner document id. Re-importing the same canonical URL for
 * the same owner yields a colliding id, making re-import an idempotent upsert
 * (CP-3, Req 2.8).
 */
export function deriveDocumentId(ownerId: string, canonicalUrl: string): string {
  return sha256Hex(`${ownerId}#${canonicalUrl}`);
}
