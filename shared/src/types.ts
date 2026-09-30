import type { ItemStatus, Role, SharePermission } from './constants.js';

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

// Example root entity. Owned by a user (ownerId) and can be shared.
// Replace these fields with those of your real domain.
export interface Item extends Timestamped {
  itemId: string;
  ownerId: string;
  name: string;
  description?: string;
  status: ItemStatus;
}

// Access grant of an item to another user.
export interface ItemShare extends Timestamped {
  itemId: string;
  userId: string;
  permission: SharePermission;
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
