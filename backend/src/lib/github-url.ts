/**
 * Normalize a user-pasted GitHub file URL to its raw-content URL so we can
 * fetch the file's bytes. Users naturally paste the browser URL
 * (`github.com/<owner>/<repo>/blob/<ref>/<path>`), which serves the HTML page,
 * not the file — fetching it would return markup, never their profile text.
 *
 * Handled inputs:
 *   - github.com/<owner>/<repo>/blob/<ref>/<path>   → raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>
 *   - github.com/<owner>/<repo>/raw/<ref>/<path>    → same
 *   - raw.githubusercontent.com/...                 → unchanged (already raw)
 *   - any other https URL                           → unchanged (fetched as-is)
 *
 * A bare repo URL with no file path (`github.com/<owner>/<repo>`) returns
 * `null`: there is no single file to fetch, and the caller must surface a clear
 * "point at a file, not the repo" error instead of fetching the repo homepage.
 */
export function toRawGitHubUrl(input: string): string | null {
  const url = input.trim();
  if (!/^https:\/\//i.test(url)) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();

  // Already a raw URL — use as-is.
  if (host === 'raw.githubusercontent.com') return url;

  if (host === 'github.com' || host === 'www.github.com') {
    // Path: /<owner>/<repo>/<blob|raw>/<ref>/<...path>
    const segments = parsed.pathname.split('/').filter(Boolean);
    const kindIndex = segments.findIndex((s) => s === 'blob' || s === 'raw');
    // Need owner, repo, blob|raw, ref, and at least one path segment.
    if (kindIndex >= 2 && segments.length > kindIndex + 2) {
      const owner = segments[0];
      const repo = segments[1];
      const ref = segments[kindIndex + 1];
      const filePath = segments.slice(kindIndex + 2).join('/');
      return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`;
    }
    // github.com URL with no identifiable file (e.g. bare repo) → not fetchable.
    return null;
  }

  // Any other host (e.g. GitLab raw, a personal site): fetch as given.
  return url;
}
