// Unit tests for the Level-1 deterministic feedback adjustment (no LLM).
//
// Pins the behaviour that the app "learns from you" purely from aggregated
// 👍/👎 counts, bounded and saturating, never touching the AI verdict's
// relevance/novelty/redundancy — only the MKV priority.

import {
  applyFeedbackAdjustment,
  buildFeedbackSignals,
  type FeedbackSignals,
  type KnowledgeDocument,
} from '@app/shared';

function signals(
  byDomain: Record<string, number> = {},
  byTopic: Record<string, number> = {}
): FeedbackSignals {
  return {
    byDomain: new Map(Object.entries(byDomain)),
    byTopic: new Map(Object.entries(byTopic)),
  };
}

describe('applyFeedbackAdjustment', () => {
  it('is a no-op when there is no feedback (f(0)=0)', () => {
    expect(applyFeedbackAdjustment(50, signals(), 'example.com', ['aws'])).toBe(50);
  });

  it('is a no-op when the doc domain/topics have no matching feedback', () => {
    const s = signals({ 'other.com': -5 }, { kubernetes: -3 });
    expect(applyFeedbackAdjustment(50, s, 'example.com', ['aws'])).toBe(50);
  });

  it('lowers MKV for a domain the user keeps rejecting (👎)', () => {
    const s = signals({ 'spam.io': -4 });
    const out = applyFeedbackAdjustment(50, s, 'spam.io', []);
    expect(out).toBeLessThan(50);
  });

  it('raises MKV for a topic the user keeps approving (👍)', () => {
    const s = signals({}, { rust: 4 });
    const out = applyFeedbackAdjustment(50, s, 'blog.dev', ['rust']);
    expect(out).toBeGreaterThan(50);
  });

  it('penalises downs more than it rewards ups (asymmetric weights)', () => {
    const down = applyFeedbackAdjustment(50, signals({ 'd.com': -5 }), 'd.com', []);
    const up = applyFeedbackAdjustment(50, signals({ 'u.com': 5 }), 'u.com', []);
    expect(50 - down).toBeGreaterThan(up - 50);
  });

  it('saturates: more feedback moves the score less and less', () => {
    const one = applyFeedbackAdjustment(50, signals({ 'x.com': -1 }), 'x.com', []);
    const five = applyFeedbackAdjustment(50, signals({ 'x.com': -5 }), 'x.com', []);
    const fifty = applyFeedbackAdjustment(50, signals({ 'x.com': -50 }), 'x.com', []);
    // Monotonic downward but with diminishing returns.
    expect(five).toBeLessThan(one);
    expect(fifty).toBeLessThanOrEqual(five);
    // The jump 1→5 is at least as big as 5→50 (saturation; integer rounding can
    // flatten the difference at these magnitudes).
    expect(one - five).toBeGreaterThanOrEqual(five - fifty);
  });

  it('bounds the total delta (feedback nudges, never dominates)', () => {
    const s = signals({ 'x.com': -100 }, { a: -100, b: -100, c: -100 });
    const out = applyFeedbackAdjustment(50, s, 'x.com', ['a', 'b', 'c']);
    expect(out).toBeGreaterThanOrEqual(50 - 20); // FEEDBACK_MAX_DELTA
  });

  it('clamps the result into 0..100', () => {
    expect(
      applyFeedbackAdjustment(5, signals({ 'x.com': -100 }), 'x.com', [])
    ).toBeGreaterThanOrEqual(0);
    expect(
      applyFeedbackAdjustment(98, signals({}, { t: 100 }), 'x.com', ['t'])
    ).toBeLessThanOrEqual(100);
  });

  it('averages topic deltas so many-topic docs are not over-weighted', () => {
    // One topic strongly down vs the same topic diluted among neutral topics.
    const single = applyFeedbackAdjustment(50, signals({}, { aws: -5 }), 'x.com', ['aws']);
    const diluted = applyFeedbackAdjustment(50, signals({}, { aws: -5 }), 'x.com', [
      'aws',
      'neutral1',
      'neutral2',
    ]);
    expect(diluted).toBeGreaterThan(single); // less penalty when diluted
    expect(diluted).toBeLessThan(50); // but still penalised
  });

  it('is case-insensitive on domain and topic matching', () => {
    const s = signals({ 'spam.io': -4 }, { aws: -4 });
    const lower = applyFeedbackAdjustment(50, s, 'spam.io', ['aws']);
    const upper = applyFeedbackAdjustment(50, s, 'SPAM.IO', ['AWS']);
    expect(upper).toBe(lower);
  });
});

describe('buildFeedbackSignals', () => {
  function doc(partial: Partial<KnowledgeDocument>): KnowledgeDocument {
    return {
      documentId: 'd',
      ownerId: 'o',
      batchId: 'b',
      rawUrl: 'u',
      canonicalUrl: 'u',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      ...partial,
    };
  }

  it('ignores documents without explicit feedback', () => {
    const s = buildFeedbackSignals([
      doc({ metadata: { sourceDomain: 'a.com' }, extraction: topics(['aws']) }),
    ]);
    expect(s.byDomain.size).toBe(0);
    expect(s.byTopic.size).toBe(0);
  });

  it('nets ups and downs per domain and per topic', () => {
    const s = buildFeedbackSignals([
      doc({
        userFeedback: 'down',
        metadata: { sourceDomain: 'a.com' },
        extraction: topics(['aws', 'cloud']),
      }),
      doc({
        userFeedback: 'down',
        metadata: { sourceDomain: 'a.com' },
        extraction: topics(['aws']),
      }),
      doc({
        userFeedback: 'up',
        metadata: { sourceDomain: 'a.com' },
        extraction: topics(['cloud']),
      }),
    ]);
    expect(s.byDomain.get('a.com')).toBe(-1); // -1 -1 +1
    expect(s.byTopic.get('aws')).toBe(-2);
    expect(s.byTopic.get('cloud')).toBe(0); // -1 +1
  });
});

function topics(t: string[]): KnowledgeDocument['extraction'] {
  return { topics: t, concepts: [], claims: [], difficulty: 'INTERMEDIATE', summary: '' };
}
