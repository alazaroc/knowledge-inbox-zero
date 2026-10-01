// User roles.
// USER: regular user — manages their own documents and imports.
// ADMIN: app administrator (manages users; does not access other users' data).
export const ROLES = {
  ADMIN: 'ADMIN',
  USER: 'USER',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

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
  USERS: getTableName('TABLE_USERS', '{{PROJECT_NAME}}-users-test'),
  PROFILES: getTableName('TABLE_PROFILES', '{{PROJECT_NAME}}-profiles-test'),
  BATCHES: getTableName('TABLE_BATCHES', '{{PROJECT_NAME}}-batches-test'),
  DOCUMENTS: getTableName('TABLE_DOCUMENTS', '{{PROJECT_NAME}}-documents-test'),
} as const;

// Type names used as discriminators / in the audit log.
export const ENTITY_TYPE = {
  USER: 'USER',
} as const;
export type EntityType = (typeof ENTITY_TYPE)[keyof typeof ENTITY_TYPE];
