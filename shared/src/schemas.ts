import { z } from 'zod';
import { RECOMMENDATION_STATE, ROLES } from './constants.js';

// Profile list entries: trim, drop empties (Req 1.7), cap length/count (Req 1.8).
const trimmedEntry = z.string().transform((s) => s.trim());
const entryList = z
  .array(trimmedEntry)
  .transform((arr) => arr.filter((s) => s.length > 0)) // Req 1.7 drop empties
  .refine((arr) => arr.length <= 100, { message: 'At most 100 entries' }) // Req 1.8
  .refine((arr) => arr.every((s) => s.length <= 200), { message: 'Entry exceeds 200 chars' });

// ---------- Knowledge Inbox Zero domain ----------

// Profile: replace-all semantics; trims entries, drops empties, enforces bounds.
export const profileSchema = z.object({
  highInterests: entryList.default([]),
  mediumInterests: entryList.default([]),
  currentlyResearching: entryList.default([]),
  alreadyKnown: entryList.default([]),
  avoidContentTypes: entryList.default([]),
  context: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length <= 5000, {
      message: 'context exceeds 5000 characters', // Req 1.5
    })
    .optional(),
});

// Imports: raw pasted blob; the handler splits/normalizes lines (Req 2.1).
export const importCreateSchema = z.object({
  urls: z.string().min(1),
});

// Library query: optional state filter (Req 7.5 invalid → 400) + pagination cursor.
export const libraryQuerySchema = z.object({
  state: z.enum(RECOMMENDATION_STATE).optional(),
  cursor: z.string().optional(),
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
export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>;
export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>;
export type ProfileInput = z.input<typeof profileSchema>;
export type ImportCreateInput = z.input<typeof importCreateSchema>;
export type LibraryQueryInput = z.input<typeof libraryQuerySchema>;
