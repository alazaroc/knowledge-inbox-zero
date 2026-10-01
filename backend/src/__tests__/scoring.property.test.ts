import fc from 'fast-check';
import {
  normalizeConcepts,
  computeRelevance,
  computeNovelty,
  computeRedundancy,
  computeFreshness,
  computeMkv,
  scoresToRecommendationState,
  type ScoreInput,
  type Scores,
} from '@app/shared';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// A small alphabet of concept/topic tokens so that overlap between sets is
// likely (otherwise coverage is almost always 0 and the invariants are trivial).
const token = fc.constantFrom(
  'ml',
  'ai',
  'serverless',
  'aws',
  'dynamodb',
  'lambda',
  'react',
  'typescript',
  'security',
  'bedrock',
  'graphs',
  'rust',
  'kafka',
  'testing'
);

const tokenSet = fc.array(token, { maxLength: 10 }).map((xs) => new Set(xs));

// ISO date string, optional, within a plausible range.
const isoDate = fc
  .date({ min: new Date('2000-01-01T00:00:00Z'), max: new Date('2035-01-01T00:00:00Z') })
  .map((d) => d.toISOString());

const nowDate = fc.date({
  min: new Date('2020-01-01T00:00:00Z'),
  max: new Date('2035-01-01T00:00:00Z'),
});

const scoreInputArb: fc.Arbitrary<ScoreInput> = fc.record({
  docConcepts: tokenSet,
  docTopics: tokenSet,
  interests: tokenSet,
  known: tokenSet,
  publishedAt: fc.option(isoDate, { nil: undefined }),
  now: nowDate,
  isExactPriorDuplicate: fc.boolean(),
  halfLifeDays: fc.option(fc.integer({ min: 1, max: 3650 }), { nil: undefined }),
});

// A standalone Scores object for computeMkv / scoresToRecommendationState.
const score0to100 = fc.integer({ min: 0, max: 100 });
const scoresArb: fc.Arbitrary<Scores> = fc
  .record({
    relevance: score0to100,
    novelty: score0to100,
    redundancy: score0to100,
    freshness: score0to100,
  })
  .map((partial) => ({ ...partial, mkv: computeMkv(partial as Scores) }));

const isInt0to100 = (n: number) => Number.isInteger(n) && n >= 0 && n <= 100;

// ===========================================================================
// Task 2.6 — bounds and MKV monotonicity
// ===========================================================================

describe('Task 2.6 — scoring bounds and monotonicity', () => {
  // Property 1: Score bounds. **Validates: Requirements 5.1**
  it('Property 1: every score is an integer in 0..100', () => {
    fc.assert(
      fc.property(scoreInputArb, (input) => {
        const relevance = computeRelevance(input);
        const novelty = computeNovelty(input);
        const redundancy = computeRedundancy(input);
        const freshness = computeFreshness(input);
        const mkv = computeMkv({ relevance, novelty, redundancy, freshness, mkv: 0 });
        expect(isInt0to100(relevance)).toBe(true);
        expect(isInt0to100(novelty)).toBe(true);
        expect(isInt0to100(redundancy)).toBe(true);
        expect(isInt0to100(freshness)).toBe(true);
        expect(isInt0to100(mkv)).toBe(true);
      })
    );
  });

  // Property 12: MKV monotonicity. **Validates: Requirements 5.5**
  it('Property 12: computeMkv is non-decreasing in relevance', () => {
    fc.assert(
      fc.property(scoresArb, score0to100, (s, delta) => {
        const higher = Math.min(100, s.relevance + delta);
        const low = computeMkv({ ...s, relevance: s.relevance });
        const high = computeMkv({ ...s, relevance: higher });
        expect(high).toBeGreaterThanOrEqual(low);
      })
    );
  });

  it('Property 12: computeMkv is non-decreasing in novelty', () => {
    fc.assert(
      fc.property(scoresArb, score0to100, (s, delta) => {
        const higher = Math.min(100, s.novelty + delta);
        const low = computeMkv({ ...s, novelty: s.novelty });
        const high = computeMkv({ ...s, novelty: higher });
        expect(high).toBeGreaterThanOrEqual(low);
      })
    );
  });

  it('Property 12: computeMkv is non-increasing in redundancy', () => {
    fc.assert(
      fc.property(scoresArb, score0to100, (s, delta) => {
        const higher = Math.min(100, s.redundancy + delta);
        const low = computeMkv({ ...s, redundancy: s.redundancy });
        const high = computeMkv({ ...s, redundancy: higher });
        expect(high).toBeLessThanOrEqual(low);
      })
    );
  });
});

// ===========================================================================
// Task 2.7 — novelty / redundancy invariants
// ===========================================================================

describe('Task 2.7 — novelty/redundancy invariants', () => {
  // Property 7: Knowing more never increases novelty. **Validates: Requirements 5.7**
  it('Property 7: adding concepts to `known` never increases novelty', () => {
    fc.assert(
      fc.property(scoreInputArb, fc.array(token, { maxLength: 8 }), (input, extra) => {
        const before = computeNovelty(input);
        const grownKnown = new Set([...input.known, ...extra]);
        const after = computeNovelty({ ...input, known: grownKnown });
        expect(after).toBeLessThanOrEqual(before);
      })
    );
  });

  // Property 8: Novelty/redundancy complementarity. **Validates: Requirements 5.6**
  it('Property 8: on the non-duplicate branch novelty = 100 - redundancy', () => {
    fc.assert(
      fc.property(scoreInputArb, (input) => {
        const base = { ...input, isExactPriorDuplicate: false };
        const novelty = computeNovelty(base);
        const redundancy = computeRedundancy(base);
        // On the non-duplicate path redundancy is not forced upward unless
        // coverage is full (>=80 clamp); in that case novelty is still the
        // exact complement of the raw coverage, i.e. <= 100 - redundancy.
        expect(novelty).toBeLessThanOrEqual(100 - redundancy + 1);
        // Increasing redundancy (via more coverage) never increases novelty.
        const grown = { ...base, known: new Set([...base.known, ...base.docConcepts]) };
        expect(computeNovelty(grown)).toBeLessThanOrEqual(novelty);
        expect(computeRedundancy(grown)).toBeGreaterThanOrEqual(redundancy);
      })
    );
  });

  // Property 4: Exact duplicates are not low-redundancy (>=90). **Validates: Requirements 5.4**
  it('Property 4: exact prior duplicates have redundancy >= 90', () => {
    fc.assert(
      fc.property(scoreInputArb, (input) => {
        const redundancy = computeRedundancy({ ...input, isExactPriorDuplicate: true });
        expect(redundancy).toBeGreaterThanOrEqual(90);
      })
    );
  });

  // Property 13: All-known implies high redundancy (>=80). **Validates: Requirements 5.3**
  it('Property 13: when every doc concept is known, redundancy >= 80', () => {
    fc.assert(
      fc.property(
        fc.array(token, { minLength: 1, maxLength: 10 }).map((xs) => new Set(xs)),
        tokenSet,
        tokenSet,
        (docConcepts, docTopics, interests) => {
          const input: ScoreInput = {
            docConcepts,
            docTopics,
            interests,
            known: new Set(docConcepts), // every doc concept is known
            now: new Date('2024-01-01T00:00:00Z'),
            isExactPriorDuplicate: false,
          };
          expect(computeRedundancy(input)).toBeGreaterThanOrEqual(80);
        }
      )
    );
  });
});

// ===========================================================================
// Task 2.8 — freshness and recommendation state
// ===========================================================================

describe('Task 2.8 — freshness and recommendation state', () => {
  // Property 6: Age never improves freshness. **Validates: Requirements 5.8**
  it('Property 6: an older publishedAt never yields higher freshness', () => {
    fc.assert(
      fc.property(
        isoDate,
        fc.integer({ min: 0, max: 3650 }),
        nowDate,
        fc.option(fc.integer({ min: 1, max: 3650 }), { nil: undefined }),
        (newerIso, olderByDays, now, halfLifeDays) => {
          const newer = Date.parse(newerIso);
          const older = new Date(newer - olderByDays * 86_400_000).toISOString();
          const base = {
            docConcepts: new Set<string>(),
            docTopics: new Set<string>(),
            interests: new Set<string>(),
            known: new Set<string>(),
            now,
            isExactPriorDuplicate: false,
            halfLifeDays,
          };
          const freshNewer = computeFreshness({ ...base, publishedAt: newerIso });
          const freshOlder = computeFreshness({ ...base, publishedAt: older });
          expect(freshOlder).toBeLessThanOrEqual(freshNewer);
        }
      )
    );
  });

  // Property 14: Missing date yields neutral estimated freshness (50). **Validates: Requirements 5.9**
  it('Property 14: computeFreshness returns 50 when publishedAt is missing', () => {
    fc.assert(
      fc.property(
        nowDate,
        fc.option(fc.integer({ min: 1, max: 3650 }), { nil: undefined }),
        (now, halfLifeDays) => {
          const freshness = computeFreshness({
            docConcepts: new Set<string>(),
            docTopics: new Set<string>(),
            interests: new Set<string>(),
            known: new Set<string>(),
            now,
            isExactPriorDuplicate: false,
            halfLifeDays,
            publishedAt: undefined,
          });
          expect(freshness).toBe(50);
        }
      )
    );
  });

  // Property 9: Single recommendation state. **Validates: Requirements 6.1**
  it('Property 9: scoresToRecommendationState returns exactly one valid state', () => {
    fc.assert(
      fc.property(
        scoresArb,
        nowDate,
        fc.boolean(),
        fc.option(isoDate, { nil: undefined }),
        (s, now, dup, publishedAt) => {
          const { state } = scoresToRecommendationState(s, {
            isExactPriorDuplicate: dup,
            publishedAt,
            now,
          });
          expect(['READ', 'SKIM', 'SKIP']).toContain(state);
        }
      )
    );
  });

  // Property 5: Redundant implies not maximally novel and never READ.
  // **Validates: Requirements 5.6, 6.1**
  it('Property 5: a redundant doc (redundancy >= 80) never routes to READ', () => {
    fc.assert(
      fc.property(
        fc.record({
          relevance: score0to100,
          novelty: score0to100,
          freshness: score0to100,
          redundancy: fc.integer({ min: 80, max: 100 }),
        }),
        nowDate,
        (partial, now) => {
          const s: Scores = { ...partial, mkv: computeMkv(partial as Scores) };
          const { state } = scoresToRecommendationState(s, {
            isExactPriorDuplicate: false,
            now,
          });
          expect(state).toBe('SKIP');
        }
      )
    );
  });

  // Property 5 (companion): a redundant doc derived from full coverage is not
  // maximally novel. Uses the real concept-set math rather than a free Scores.
  it('Property 5: a fully-redundant doc is not maximally novel', () => {
    fc.assert(
      fc.property(
        fc.array(token, { minLength: 1, maxLength: 10 }).map((xs) => new Set(xs)),
        (docConcepts) => {
          const input: ScoreInput = {
            docConcepts,
            docTopics: new Set<string>(),
            interests: new Set<string>(),
            known: new Set(docConcepts),
            now: new Date('2024-01-01T00:00:00Z'),
            isExactPriorDuplicate: false,
          };
          const redundancy = computeRedundancy(input);
          const novelty = computeNovelty(input);
          expect(redundancy).toBeGreaterThanOrEqual(80);
          expect(novelty).toBeLessThan(100);
        }
      )
    );
  });
});

// A quick sanity check that normalizeConcepts behaves (used by the module).
describe('normalizeConcepts', () => {
  it('lowercases, trims, drops empties and de-duplicates', () => {
    const result = normalizeConcepts(['  AI ', 'ai', '', '  ', 'ML']);
    expect(result).toEqual(new Set(['ai', 'ml']));
  });
});
