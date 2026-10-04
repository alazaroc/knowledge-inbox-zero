import { toRawGitHubUrl } from '../lib/github-url.js';

describe('toRawGitHubUrl', () => {
  it('converts a github.com blob URL to raw', () => {
    expect(toRawGitHubUrl('https://github.com/alazaroc/my-brain/blob/main/me/profile.md')).toBe(
      'https://raw.githubusercontent.com/alazaroc/my-brain/main/me/profile.md'
    );
  });

  it('converts a github.com /raw/ URL to raw host', () => {
    expect(toRawGitHubUrl('https://github.com/you/repo/raw/dev/docs/p.md')).toBe(
      'https://raw.githubusercontent.com/you/repo/dev/docs/p.md'
    );
  });

  it('leaves an existing raw.githubusercontent.com URL unchanged', () => {
    const raw = 'https://raw.githubusercontent.com/you/repo/main/profile.md';
    expect(toRawGitHubUrl(raw)).toBe(raw);
  });

  it('returns null for a bare repo URL (no file)', () => {
    expect(toRawGitHubUrl('https://github.com/alazaroc/my-brain')).toBeNull();
  });

  it('returns null for a non-https URL', () => {
    expect(toRawGitHubUrl('http://github.com/you/repo/blob/main/p.md')).toBeNull();
    expect(toRawGitHubUrl('not a url')).toBeNull();
  });

  it('passes through a non-GitHub https URL as-is', () => {
    const other = 'https://example.com/me/profile.md';
    expect(toRawGitHubUrl(other)).toBe(other);
  });
});
