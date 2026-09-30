import { z } from 'zod';
import { ITEM_STATUS, ROLES, SHARE_PERMISSION } from './constants.js';

// Helpers
const shortText = z.string().min(1).max(200);
const longText = z.string().max(5000).optional();

// ---------- Item (example entity) ----------
export const itemCreateSchema = z.object({
  name: shortText,
  description: longText,
  status: z.enum(ITEM_STATUS).default('ACTIVE'),
});
export const itemUpdateSchema = itemCreateSchema.partial();

export const itemShareSchema = z.object({
  userId: z.string().min(1),
  permission: z.enum(SHARE_PERMISSION),
});

// ---------- Users (admin management) ----------
// User creation by an admin (creates the Cognito user with a temporary password).
export const adminCreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'At least 8 characters').max(256),
  role: z.enum([ROLES.ADMIN, ROLES.USER]).default(ROLES.USER),
});

// User update by an admin: enable/disable and/or change role.
export const adminUpdateUserSchema = z
  .object({
    enabled: z.boolean().optional(),
    role: z.enum([ROLES.ADMIN, ROLES.USER]).optional(),
  })
  .refine((v) => v.enabled !== undefined || v.role !== undefined, {
    message: 'Nothing to update',
  });

// Inferred types
export type ItemCreateInput = z.infer<typeof itemCreateSchema>;
export type ItemUpdateInput = z.infer<typeof itemUpdateSchema>;
export type ItemShareInput = z.infer<typeof itemShareSchema>;
export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>;
export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>;
