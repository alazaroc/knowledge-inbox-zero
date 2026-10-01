import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { badRequest, unauthorized } from './response.js';
import { verifyToken, type AuthContext } from './auth.js';
import { formatZodErrors } from './zod-errors.js';

/** Returns the auth context or a 401 response. */
export async function authenticate(
  event: APIGatewayProxyEvent
): Promise<{ ctx: AuthContext } | { error: APIGatewayProxyResult }> {
  const ctx = await verifyToken(event);
  if (!ctx) return { error: unauthorized() };
  return { ctx };
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
