import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { ROLES, TABLE_NAMES, type Role, type SharePermission } from '@app/shared';
import { ddb } from './dynamo.js';

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID!,
  tokenUse: 'id',
  clientId: process.env.COGNITO_CLIENT_ID!,
});

export interface AuthContext {
  sub: string;
  email: string;
  role: Role;
}

/** Verifies the Cognito JWT (id token) from the Authorization header. */
export async function verifyToken(event: APIGatewayProxyEvent): Promise<AuthContext | null> {
  const header = event.headers?.Authorization ?? event.headers?.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const payload = await verifier.verify(header.slice(7));
    const role = (payload['custom:role'] as Role) ?? ROLES.USER;
    const email = (payload['email'] as string) ?? '';
    return { sub: payload.sub, email, role };
  } catch {
    return null;
  }
}

export const isAdmin = (ctx: AuthContext) => ctx.role === ROLES.ADMIN;

export type ItemAccess =
  | { allowed: true; ownerId: string; permission: 'owner' | SharePermission }
  | { allowed: false; reason: 'not_found' | 'forbidden' };

const accessCache = new Map<string, { value: ItemAccess; until: number }>();
const CACHE_TTL_MS = 30_000;

/**
 * Resolves whether the user can access the item and with which permission.
 * - owner: absolute owner.
 * - read/write: present in the shares table.
 * 30s local cache to avoid two GetItem calls per request.
 */
export async function checkItemAccess(ctx: AuthContext, itemId: string): Promise<ItemAccess> {
  const cacheKey = `${ctx.sub}:${itemId}`;
  const cached = accessCache.get(cacheKey);
  const nowMs = Date.now();
  if (cached && cached.until > nowMs) return cached.value;

  const item = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAMES.ITEMS,
      Key: { itemId },
      ProjectionExpression: 'ownerId',
    })
  );
  if (!item.Item) {
    const v: ItemAccess = { allowed: false, reason: 'not_found' };
    accessCache.set(cacheKey, { value: v, until: nowMs + CACHE_TTL_MS });
    return v;
  }
  const ownerId = item.Item.ownerId as string;
  if (ownerId === ctx.sub) {
    const v: ItemAccess = { allowed: true, ownerId, permission: 'owner' };
    accessCache.set(cacheKey, { value: v, until: nowMs + CACHE_TTL_MS });
    return v;
  }
  const share = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAMES.SHARES,
      Key: { itemId, userId: ctx.sub },
      ProjectionExpression: 'permission',
    })
  );
  if (!share.Item) {
    const v: ItemAccess = { allowed: false, reason: 'forbidden' };
    accessCache.set(cacheKey, { value: v, until: nowMs + CACHE_TTL_MS });
    return v;
  }
  const v: ItemAccess = {
    allowed: true,
    ownerId,
    permission: share.Item.permission as SharePermission,
  };
  accessCache.set(cacheKey, { value: v, until: nowMs + CACHE_TTL_MS });
  return v;
}

export const canWrite = (acc: ItemAccess) =>
  acc.allowed && (acc.permission === 'owner' || acc.permission === 'write');

export const canRead = (acc: ItemAccess) => acc.allowed;
export const isOwner = (acc: ItemAccess) => acc.allowed && acc.permission === 'owner';
