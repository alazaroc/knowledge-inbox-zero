import { z } from 'zod';
import {
  RECOMMENDATION_STATE,
  ROLES,
  MAX_PROFILE_CONTEXT_CHARS,
  MAX_USER_LABELS_PER_DOC,
  MAX_USER_LABEL_LENGTH,
} from './constants.js';

// Profile list entries: trim, drop empties (Req 1.7), cap length/count (Req 1.8).
const trimmedEntry = z.string().transform((s) => s.trim());
const entryList = z
  .array(trimmedEntry)
  .transform((arr) => arr.filter((s) => s.length > 0)) // Req 1.7 drop empties
  .refine((arr) => arr.length <= 50, { message: 'At most 50 entries' })
  .refine((arr) => arr.every((s) => s.length <= 200), { message: 'Entry exceeds 200 chars' });

// ---------- Knowledge Inbox Zero domain ----------

// Profile: replace-all semantics; trims entries, drops empties, enforces bounds.
export const profileSchema = z.object({
  highInterests: entryList.default([]),
  mediumInterests: entryList.default([]),
  currentlyResearching: entryList.default([]),
  alreadyKnown: entryList.default([]),
  avoidContentTypes: entryList.default([]),
  activeContexts: entryList.default([]), // active initiatives/projects
  context: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length <= MAX_PROFILE_CONTEXT_CHARS, {
      message: `context exceeds ${MAX_PROFILE_CONTEXT_CHARS} characters`,
    })
    .optional(),
  // Optional PUBLIC raw URL of the user's own profile.md ("bring your own").
  // Only the URL is persisted; the worker fetches it at analysis time.
  profileSourceUrl: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s === '' || /^https:\/\/.+/.test(s), { message: 'Must be an https:// URL' })
    .refine((s) => s.length <= 2000, { message: 'URL exceeds 2000 characters' })
    .optional(),
  // Optional PRIVATE repo profile source. The URL is persisted on the profile;
  // the token is NOT — it is stored (write-only) in Secrets Manager and never
  // returned. Send githubToken='' to CLEAR a stored token.
  profileRepoUrl: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s === '' || /^https:\/\/.+/.test(s), { message: 'Must be an https:// URL' })
    .refine((s) => s.length <= 2000, { message: 'URL exceeds 2000 characters' })
    .optional(),
  githubToken: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length <= 400, { message: 'Token too long' })
    .optional(),
  // Language the AI writes its recommendation explanations in. 'auto' matches
  // the language of the user's profile text; the rest force that language.
  outputLanguage: z.enum(['auto', 'en', 'es', 'fr', 'de', 'pt', 'it']).default('auto'),
  // Weekly email digest (opt-in). Day 0=Sunday..6=Saturday; slot is a coarse
  // time band so the backend only runs a few fixed times per day.
  digestEnabled: z.boolean().optional(),
  digestDay: z.number().int().min(0).max(6).optional() as z.ZodType<
    0 | 1 | 2 | 3 | 4 | 5 | 6 | undefined
  >,
  digestSlot: z.enum(['s0', 's8', 's16']).optional(),
  // IANA timezone for DISPLAY only (the send time is a fixed UTC hour). Stored
  // so the UI can show each user their own local send time.
  digestTimezone: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length <= 64, { message: 'Timezone too long' })
    .optional(),
  // Monthly email digest (opt-in, separate from the weekly one). Sent on the
  // last day of the month, reusing the same slot/timezone; lists ALL pending.
  monthlyDigestEnabled: z.boolean().optional(),
});

// Profile import (draft generation): give EITHER a public URL to fetch OR raw
// text pasted by the user. The worker/handler turns it into an editable draft
// profile via one LLM call — it is never saved directly (Req: review before save).
export const profileImportSchema = z
  .object({
    url: z
      .string()
      .transform((s) => s.trim())
      .refine((s) => s === '' || /^https:\/\/.+/.test(s), { message: 'Must be an https:// URL' })
      .refine((s) => s.length <= 2000, { message: 'URL exceeds 2000 characters' })
      .optional(),
    text: z
      .string()
      .transform((s) => s.trim())
      .refine((s) => s.length <= 50000, { message: 'Text exceeds 50000 characters' })
      .optional(),
  })
  .refine((v) => Boolean(v.url) || Boolean(v.text), {
    message: 'Provide a URL or paste some text',
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

// Document PATCH: user lifecycle + feedback. At least one field required.
// `userFeedback: null` clears a prior thumbs rating.
export const documentPatchSchema = z
  .object({
    archived: z.boolean().optional(),
    starred: z.boolean().optional(),
    userFeedback: z.enum(['up', 'down']).nullable().optional(),
    // Free-form user labels. Replaces the whole set; trimmed, de-duped,
    // bounded. An empty array clears all labels.
    userLabels: z
      .array(z.string().transform((s) => s.trim()))
      .transform((arr) => Array.from(new Set(arr.filter((s) => s.length > 0))))
      .refine((arr) => arr.length <= MAX_USER_LABELS_PER_DOC, {
        message: `At most ${MAX_USER_LABELS_PER_DOC} labels`,
      })
      .refine((arr) => arr.every((s) => s.length <= MAX_USER_LABEL_LENGTH), {
        message: `Each label is at most ${MAX_USER_LABEL_LENGTH} characters`,
      })
      .optional(),
  })
  .refine(
    (v) =>
      v.archived !== undefined ||
      v.starred !== undefined ||
      v.userFeedback !== undefined ||
      v.userLabels !== undefined,
    {
      message: 'Nothing to update',
    }
  );

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

// Profile sync (test & snapshot a "bring your own" source): give the file URL,
// and OPTIONALLY a fresh token (used for this fetch and, on success, stored).
// Omit `githubToken` to reuse an already-stored token. The handler fetches the
// file live, returns the extracted text for the user to review, and saves it.
export const profileSyncSchema = z.object({
  profileSourceUrl: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s === '' || /^https:\/\/.+/.test(s), { message: 'Must be an https:// URL' })
    .refine((s) => s.length <= 2000, { message: 'URL exceeds 2000 characters' })
    .optional(),
  profileRepoUrl: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s === '' || /^https:\/\/.+/.test(s), { message: 'Must be an https:// URL' })
    .refine((s) => s.length <= 2000, { message: 'URL exceeds 2000 characters' })
    .optional(),
  githubToken: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length <= 400, { message: 'Token too long' })
    .optional(),
});

// Inferred types
export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>;
export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>;
export type ProfileInput = z.input<typeof profileSchema>;
export type ProfileImportInput = z.input<typeof profileImportSchema>;
export type ImportCreateInput = z.input<typeof importCreateSchema>;
export type LibraryQueryInput = z.input<typeof libraryQuerySchema>;
export type DocumentPatchInput = z.infer<typeof documentPatchSchema>;
