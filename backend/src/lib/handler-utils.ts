import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { badRequest, forbidden, notFound, unauthorized } from './response.js';
import {
  verifyToken,
  checkItemAccess,
  canRead,
  canWrite,
  isOwner,
  type AuthContext,
  type ItemAccess,
} from './auth.js';
import { formatZodErrors } from './zod-errors.js';
import type { SharePermission } from '@app/shared';

/** Returns the auth context or a 401 response. */
export async function authenticate(
  event: APIGatewayProxyEvent
): Promise<{ ctx: AuthContext } | { error: APIGatewayProxyResult }> {
  const ctx = await verifyToken(event);
  if (!ctx) return { error: unauthorized() };
  return { ctx };
}

/**
 * Authenticates and resolves access to the item in the path.
 * `required`: 'read' | 'write' | 'owner'. Returns an error if the token is missing,
 * the item does not exist, or the user lacks the required permission.
 */
export async function authorizeItem(
  event: APIGatewayProxyEvent,
  required: 'read' | 'write' | 'owner'
): Promise<
  | {
      ctx: AuthContext;
      itemId: string;
      access: ItemAccess;
      myPermission: 'owner' | SharePermission;
    }
  | { error: APIGatewayProxyResult }
> {
  const auth = await authenticate(event);
  if ('error' in auth) return auth;
  const itemId = event.pathParameters?.itemId;
  if (!itemId) return { error: badRequest('Missing itemId') };
  const acc = await checkItemAccess(auth.ctx, itemId);
  if (!acc.allowed) {
    return { error: acc.reason === 'not_found' ? notFound('Item') : forbidden() };
  }
  if (required === 'owner' && !isOwner(acc)) return { error: forbidden() };
  if (required === 'write' && !canWrite(acc)) return { error: forbidden() };
  if (required === 'read' && !canRead(acc)) return { error: forbidden() };
  return { ctx: auth.ctx, itemId, access: acc, myPermission: acc.permission };
}

/** Parses the JSON body validating it with the schema, or returns 400. */
export function parseBody<T extends z.ZodTypeAny>(
  event: APIGatewayProxyEvent,
  schema: T
): { data: z.infer<T> } | { error: APIGatewayProxyResult } {
  let raw: unknown;
  try {
    raw = event.body ? JSON.parse(event.body) : {};
  } catch {
    return { error: badRequest('Invalid JSON') };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return { error: badRequest(formatZodErrors(result.error.issues)) };
  }
  return { data: result.data };
}
