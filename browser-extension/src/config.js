// Shared configuration for the Knowledge Inbox Zero browser extension.
//
// Portability: the default base URL points at the public hosted instance, but it
// is NEVER hardcoded at the call sites — it is only the fallback when the user
// has not set their own. Anyone who forks this extension can either:
//   (a) change DEFAULT_BASE_URL below (one line), or
//   (b) set their own URL in the popup (stored in chrome.storage.sync),
// so a fork never inherits the original author's instance.

export const DEFAULT_BASE_URL = 'https://inbox.playingaws.com';

// The app route that reads ?url=&title= and preloads the "Add content" form
// (frontend/src/pages/app/AddContentPage.tsx). The extension reuses this; it
// needs no Cognito token because it rides the browser's existing app session.
export const ADD_PATH = '/app/add';

// `chrome` is the cross-browser namespace in MV3 (Chrome/Brave/Edge expose it;
// Firefox 121+ also exposes `chrome` alongside `browser`). Using `chrome`
// keeps a single codebase working everywhere without a polyfill.
const api = globalThis.chrome;

/** Read the configured base URL, falling back to the default. */
export async function getBaseUrl() {
  try {
    const { baseUrl } = await api.storage.sync.get('baseUrl');
    return normalizeBaseUrl(baseUrl) || DEFAULT_BASE_URL;
  } catch {
    return DEFAULT_BASE_URL;
  }
}

/** Persist a user-chosen base URL (empty string resets to the default). */
export async function setBaseUrl(value) {
  const normalized = normalizeBaseUrl(value);
  await api.storage.sync.set({ baseUrl: normalized });
  return normalized || DEFAULT_BASE_URL;
}

/** Trim, drop a trailing slash, and reject anything that is not http(s). */
export function normalizeBaseUrl(value) {
  if (!value) return '';
  const trimmed = String(value).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(trimmed)) return '';
  return trimmed;
}

/** Build the full "add this link" URL for a given tab. */
export function buildAddUrl(baseUrl, { url, title }) {
  const target = new URL(ADD_PATH, baseUrl);
  if (url) target.searchParams.set('url', url);
  if (title) target.searchParams.set('title', title);
  return target.toString();
}
