import { describe, it, expect } from '@jest/globals';
import { youtubeVideoId } from '../lib/retrieve.js';

describe('youtubeVideoId', () => {
  it('parses the standard watch URL', () => {
    expect(youtubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses extra query params around v', () => {
    expect(youtubeVideoId('https://youtube.com/watch?list=PL123&v=dQw4w9WgXcQ&t=30s')).toBe(
      'dQw4w9WgXcQ'
    );
  });

  it('parses the short youtu.be form', () => {
    expect(youtubeVideoId('https://youtu.be/dQw4w9WgXcQ?si=abc')).toBe('dQw4w9WgXcQ');
  });

  it('parses embed, shorts and live paths', () => {
    expect(youtubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('handles m. and music. hosts', () => {
    expect(youtubeVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for non-YouTube or malformed URLs', () => {
    expect(youtubeVideoId('https://aws.amazon.com/devops-agent')).toBeNull();
    expect(youtubeVideoId('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(youtubeVideoId('not a url')).toBeNull();
    expect(youtubeVideoId('https://youtube.com/')).toBeNull();
  });
});
