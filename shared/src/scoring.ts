// Pure, deterministic MKV (Marginal Knowledge Value) scoring core.
//
// All functions here are side-effect free and dependency-free so the exact
// same code is exercised by fast-check property tests and by the analysis
// worker Lambda. Determinism is preserved by injecting `now` into any
// time-dependent computation (freshness).
//
// Requirements: 5.1–5.9, 6.1. Design: Concept-set math, MKV scoring,
// Recommendation state mapping.

import type { RecommendationState, RecommendationTag } from './constants.js';
import type { Scores } from './types.js';

// ---------------------------------------------------------------------------
// Concept-set math (Req 5.6, 5.7; CP-7, CP-8)
// ---------------------------------------------------------------------------

/** Lowercased, trimmed, de-duplicated token set (empties dropped). */
export function normalizeConcepts(items: string[]): Set<string> {
  return new Set(items.map((s) => s.trim().toLowerCase()).filter(Boolean));
}

/**
 * Fraction of the document's concepts already covered by the known set. 0..1.
 * Returns 0 when the document has no concepts. Monotonically non-decreasing as
 * `known` grows (adding elements can only turn misses into hits — CP-7).
 */
function coverage(docConcepts: Set<string>, known: Set<string>): number {
  if (docConcepts.size === 0) return 0;
  let hit = 0;
  for (const c of docConcepts) if (known.has(c)) hit++;
  return hit / docConcepts.size;
}

// ---------------------------------------------------------------------------
// MKV scoring (Req 5; CP-1, CP-4..CP-8)
// ---------------------------------------------------------------------------

export interface ScoreInput {
  docConcepts: Set<string>;
  docTopics: Set<string>;
  interests: Set<string>; // high ∪ medium ∪ currentlyResearching
  known: Set<string>; // alreadyKnown ∪ prior document concepts
  publishedAt?: string; // ISO, optional
  now: Date; // injected for determinism/testability
  isExactPriorDuplicate: boolean; // canonicalUrl seen before (Req 5.4)
  halfLifeDays?: number; // default 180
}

/** Round and clamp to an integer in 0..100 (Req 5.1 — CP-1). */
const clamp100 = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function computeRelevance(i: ScoreInput): number {
  // Overlap of doc topics/concepts with the user's interests.
  const c = coverage(new Set([...i.docConcepts, ...i.docTopics]), i.interests);
  return clamp100(c * 100);
}

export function computeRedundancy(i: ScoreInput): number {
  if (i.isExactPriorDuplicate)
    return Math.max(90, clamp100(coverage(i.docConcepts, i.known) * 100)); // Req 5.4 / CP-4
  const cov = coverage(i.docConcepts, i.known);
  const base = clamp100(cov * 100);
  // Req 5.3: all concepts known ⇒ redundancy ≥ 80.
  return cov >= 1 ? Math.max(80, base) : base;
}

export function computeNovelty(i: ScoreInput): number {
  // CP-8: exact complement of coverage ⇒ novelty and redundancy move oppositely,
  // and CP-7: growing `known` raises coverage, so novelty is non-increasing.
  const cov = coverage(i.docConcepts, i.known);
  return clamp100((1 - cov) * 100);
}

export function computeFreshness(i: ScoreInput): number {
  if (!i.publishedAt) return 50; // Req 5.9 (caller also sets freshnessEstimated=true)
  const ageDays = Math.max(0, (i.now.getTime() - Date.parse(i.publishedAt)) / 86_400_000);
  const halfLife = i.halfLifeDays ?? 180;
  // Exponential half-life decay: monotonically non-increasing in age ⇒ CP-6 / Req 5.8.
  return clamp100(100 * Math.pow(0.5, ageDays / halfLife));
}

export function computeMkv(s: Scores): number {
  // Non-decreasing in relevance & novelty, non-increasing in redundancy (Req 5.5).
  // Weighted blend; redundancy enters via its complement to guarantee monotonicity.
  const mkv = 0.45 * s.relevance + 0.35 * s.novelty + 0.2 * (100 - s.redundancy);
  return clamp100(mkv);
}

// ---------------------------------------------------------------------------
// Recommendation state mapping (Req 6.1; CP-5, CP-9)
// ---------------------------------------------------------------------------

export interface StateResult {
  state: RecommendationState;
  tags: RecommendationTag[];
}

/** Deterministic; always returns exactly one state (CP-9). */
export function scoresToRecommendationState(
  s: Scores,
  ctx: {
    isExactPriorDuplicate: boolean;
    publishedAt?: string;
    now: Date;
  }
): StateResult {
  const tags: RecommendationTag[] = [];
  const fullyRedundant = s.redundancy >= 80;
  if (fullyRedundant) tags.push('REDUNDANT');
  if (s.freshness < 25) tags.push('OUTDATED');
  if (s.freshness >= 75) tags.push('FRESH');

  // CP-5: a fully-redundant doc cannot be treated as high-novelty READ.
  // Its high redundancy has already suppressed novelty (CP-8) and thus mkv,
  // so the ordinary thresholds below naturally route it to SKIP. No override needed.
  let state: RecommendationState;
  if (fullyRedundant || s.mkv < 34) state = 'SKIP';
  else if (s.mkv < 67) state = 'SKIM';
  else state = 'READ';

  if (state !== 'READ' && s.relevance >= 70 && s.novelty < 40) tags.push('REFERENCE');
  return { state, tags };
}
