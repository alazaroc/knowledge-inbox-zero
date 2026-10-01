import type {
  BatchStatus,
  Difficulty,
  DocStatus,
  RecommendationState,
  RecommendationTag,
  Role,
} from './constants.js';

export interface Timestamped {
  createdAt: string;
  updatedAt: string;
}

export interface User extends Timestamped {
  userId: string;
  email: string;
  name: string;
  role: Role;
}

// Summary of a Cognito user for admin management.
export interface AdminUserSummary {
  username: string; // Cognito username (= email)
  email: string;
  role: Role;
  enabled: boolean;
  status: string; // Cognito UserStatus (CONFIRMED, FORCE_CHANGE_PASSWORD…)
  createdAt?: string;
}

export interface ApiList<T> {
  items: T[];
  nextCursor?: string;
}

// ---------------------------------------------------------------------------
// Knowledge Inbox Zero domain
// ---------------------------------------------------------------------------

// Per-user knowledge profile — the single source of "what this user already
// knows and cares about". One item per user, keyed by Cognito sub.
export interface Profile extends Timestamped {
  userId: string;
  highInterests: string[];
  mediumInterests: string[];
  currentlyResearching: string[];
  alreadyKnown: string[]; // topics/concepts the user already knows
  avoidContentTypes: string[];
  context?: string; // free text, <=5000 chars trimmed
  notConfigured?: boolean; // true only for the synthetic empty profile (Req 1.4)
}

// Deterministic per-document scores (all 0..100). MKV is the overall priority.
export interface Scores {
  relevance: number; // 0..100
  novelty: number; // 0..100
  redundancy: number; // 0..100
  freshness: number; // 0..100
  mkv: number; // 0..100 overall priority
  freshnessEstimated?: boolean; // Req 5.9
}

// Metadata parsed from the retrieved document.
export interface DocMetadata {
  title?: string;
  author?: string;
  sourceDomain?: string;
  publishedAt?: string; // ISO date if found
}

// Structured LLM extraction of a document's content.
export interface Extraction {
  topics: string[];
  concepts: string[];
  claims: string[];
  difficulty: Difficulty;
  summary: string; // <=500 chars
  truncated?: boolean; // Req 4.6
}

// One analyzed document per canonical URL per owner.
export interface KnowledgeDocument extends Timestamped {
  documentId: string; // sha256(ownerId#canonicalUrl)
  ownerId: string;
  batchId: string;
  rawUrl: string;
  canonicalUrl: string;
  status: DocStatus;
  degraded?: boolean; // Req 4.5
  failureReason?: string; // Req 3.6, 3.9, 4.5
  metadata?: DocMetadata;
  extraction?: Extraction;
  scores?: Scores;
  recommendationState?: RecommendationState;
  tags?: RecommendationTag[];
  explanation?: string; // 50..1500 chars, or placeholder (Req 6.6)
  explanationUnavailable?: boolean; // Req 6.6
  s3ContentRef?: string; // set when raw content >300KB (Req 4.7)
}

// A rejected import line and why it was rejected (Req 2.4).
export interface RejectedEntry {
  line: string;
  reason: string;
}

// An import batch with atomic progress counters (CP-10).
export interface Batch extends Timestamped {
  batchId: string;
  ownerId: string;
  status: BatchStatus;
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  rejected: RejectedEntry[];
}

// Library listing response: a page of documents plus owner-wide state counts.
export interface LibraryResponse {
  documents: KnowledgeDocument[];
  counts: Record<RecommendationState, number> & { total: number };
  nextCursor?: string;
}
