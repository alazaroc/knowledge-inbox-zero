// User roles.
// USER: regular user — manages their own documents and imports.
// ADMIN: app administrator (manages users; does not access other users' data).
export const ROLES = {
  ADMIN: 'ADMIN',
  USER: 'USER',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

// Daily cap on NEW documents a USER may enqueue for analysis (cost control for
// open/multi-user deployments). Counts only new documents actually enqueued —
// duplicates, already-owned URLs and rejected lines do not consume quota.
// ADMIN is unlimited. The excess is NOT dropped silently: a hard block returns
// the unprocessed URLs so the user can save them and retry the next day.
export const DAILY_IMPORT_LIMIT_USER = 100;

// Single source of truth for the "About you" / profile context length limit.
// The SAME number governs: the editable About textarea in the UI, the stored
// `context` schema bound, and the imported-file snapshot cap. Keeping them in
// one place is what prevents the UI from accepting a length the store then
// silently truncates. 8000 chars fits a full "about me" page.
export const MAX_PROFILE_CONTEXT_CHARS = 8000;

// User-defined labels on a document (free-form organization, e.g. "AWS
// SAA-C03"). Bounded so a document item stays small and the UI stays sane.
export const MAX_USER_LABELS_PER_DOC = 12;
export const MAX_USER_LABEL_LENGTH = 40;

// Recommendation state — the single verdict per analyzed document (Req 6.1).
export const RECOMMENDATION_STATE = ['READ', 'SKIM', 'SKIP'] as const;
export type RecommendationState = (typeof RECOMMENDATION_STATE)[number];

// Recommendation tags — non-exclusive qualifiers explaining a recommendation.
export const RECOMMENDATION_TAG = ['REDUNDANT', 'OUTDATED', 'REFERENCE', 'FRESH'] as const;
export type RecommendationTag = (typeof RECOMMENDATION_TAG)[number];

// Estimated reading difficulty of a document.
export const DIFFICULTY = ['INTRO', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'] as const;
export type Difficulty = (typeof DIFFICULTY)[number];

// Per-document processing status through the analysis pipeline.
export const DOC_STATUS = ['pending', 'processing', 'completed', 'failed'] as const;
export type DocStatus = (typeof DOC_STATUS)[number];

// Import batch status.
export const BATCH_STATUS = ['processing', 'finished'] as const;
export type BatchStatus = (typeof BATCH_STATUS)[number];

// DynamoDB table names (multi-table, one per entity).
// In Lambda they come from the env vars injected by CDK; locally the default is used.
const getTableName = (key: string, defaultName: string) => {
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key] ?? defaultName;
  }
  return defaultName;
};

export const TABLE_NAMES = {
  USERS: getTableName('TABLE_USERS', 'knowledge-inbox-zero-users-test'),
  PROFILES: getTableName('TABLE_PROFILES', 'knowledge-inbox-zero-profiles-test'),
  BATCHES: getTableName('TABLE_BATCHES', 'knowledge-inbox-zero-batches-test'),
  DOCUMENTS: getTableName('TABLE_DOCUMENTS', 'knowledge-inbox-zero-documents-test'),
} as const;

// Type names used as discriminators / in the audit log.
export const ENTITY_TYPE = {
  USER: 'USER',
} as const;
export type EntityType = (typeof ENTITY_TYPE)[keyof typeof ENTITY_TYPE];

// ---------------------------------------------------------------------------
// Weekly email digest (opt-in).
//
// The backend sends at THREE FIXED UTC HOURS (00:00, 08:00, 16:00) — one
// EventBridge rule per slot, so at most 3 runs a day regardless of how many
// users or timezones exist. The user's TIMEZONE only changes how those fixed
// slots are DISPLAYED: a +2 user sees the 08:00-UTC slot as "10:00", a +6 user
// sees it as "14:00". The send time never moves; only the label does.
// ---------------------------------------------------------------------------

// Day of week the digest is sent (0 = Sunday … 6 = Saturday), matching JS
// Date.getUTCDay(). Default is Sunday.
export const DIGEST_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export type DigestDay = (typeof DIGEST_DAYS)[number];

// The three slots, identified by their FIXED UTC send hour (00/08/16). Using
// the UTC hour as the id keeps the backend trivial — the EventBridge rule for
// each hour selects the users whose digestSlot equals that hour.
export const DIGEST_SLOT = ['s0', 's8', 's16'] as const;
export type DigestSlot = (typeof DIGEST_SLOT)[number];

// Fixed UTC send hour for each slot. Keep in sync with the EventBridge cron
// hours in infra/cdk/lib/api-stack.ts.
export const DIGEST_SLOT_HOUR: Record<DigestSlot, number> = {
  s0: 0, // 00:00 UTC
  s8: 8, // 08:00 UTC
  s16: 16, // 16:00 UTC
} as const;

/**
 * Convert a slot's fixed UTC hour to the local hour for a given UTC offset (in
 * hours; may be fractional, e.g. 5.5 for India). Returns 0..23. Used ONLY for
 * display — the actual send stays at the UTC hour.
 */
export function digestSlotLocalHour(slot: DigestSlot, offsetHours: number): number {
  const h = DIGEST_SLOT_HOUR[slot] + offsetHours;
  return ((Math.round(h) % 24) + 24) % 24;
}

/** Format a slot's local send time as "HH:00" for the given offset. */
export function digestSlotLocalLabel(slot: DigestSlot, offsetHours: number): string {
  const h = digestSlotLocalHour(slot, offsetHours);
  return `${String(h).padStart(2, '0')}:00`;
}

export const DIGEST_DAY_LABEL: Record<DigestDay, string> = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
} as const;
