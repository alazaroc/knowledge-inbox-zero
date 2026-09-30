// User roles.
// USER: regular user — manages their own items and those shared with them.
// ADMIN: app administrator (manages users; does not access other users' data).
export const ROLES = {
  ADMIN: 'ADMIN',
  USER: 'USER',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

// Permissions on a shared item.
export const SHARE_PERMISSION = ['read', 'write'] as const;
export type SharePermission = (typeof SHARE_PERMISSION)[number];

// Item status (generic example entity). Customize for your domain.
export const ITEM_STATUS = ['ACTIVE', 'ARCHIVED'] as const;
export type ItemStatus = (typeof ITEM_STATUS)[number];

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
  ITEMS: getTableName('TABLE_ITEMS', '{{PROJECT_NAME}}-items-test'),
  SHARES: getTableName('TABLE_SHARES', '{{PROJECT_NAME}}-shares-test'),
} as const;

// Type names used as discriminators / in the audit log.
export const ENTITY_TYPE = {
  USER: 'USER',
  ITEM: 'ITEM',
  SHARE: 'SHARE',
} as const;
export type EntityType = (typeof ENTITY_TYPE)[keyof typeof ENTITY_TYPE];
