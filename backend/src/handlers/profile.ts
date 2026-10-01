import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { TABLE_NAMES, profileSchema, type Profile } from '@app/shared';
import { ddb } from '../lib/dynamo.js';
import { authenticate, parseBody } from '../lib/handler-utils.js';
import { badRequest, ok, serverError } from '../lib/response.js';
import { now } from '../lib/ids.js';

/**
 * Per-user knowledge `Profile` — the single source of "what this user already
 * knows and cares about". One item per user, keyed by the Cognito `sub`.
 * - GET /profile → the caller's profile, or the synthetic empty profile
 *   (`notConfigured: true`, all lists empty, no context) when none exists (Req 1.4).
 * - PUT /profile → validate, trim/drop empties (via the schema), replace all
 *   fields, and stamp a server-generated `updatedAt` in UTC (Req 1.3, 1.9).
 * Every read and write is scoped to the authenticated user (Req 1.6).
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const method = event.httpMethod;

    if (method === 'GET') return getProfile(event);
    if (method === 'PUT') return putProfile(event);

    return badRequest('Unrecognized route');
  } catch (err) {
    return serverError(err);
  }
};

/** Builds the synthetic empty profile returned when the user has none (Req 1.4). */
function emptyProfile(userId: string): Profile {
  const ts = now();
  return {
    userId,
    highInterests: [],
    mediumInterests: [],
    currentlyResearching: [],
    alreadyKnown: [],
    avoidContentTypes: [],
    context: '',
    notConfigured: true,
    createdAt: ts,
    updatedAt: ts,
  };
}

async function getProfile(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const auth = await authenticate(event);
  if ('error' in auth) return auth.error;

  const r = await ddb.send(
    new GetCommand({ TableName: TABLE_NAMES.PROFILES, Key: { userId: auth.ctx.sub } })
  );
  if (!r.Item) return ok(emptyProfile(auth.ctx.sub));
  return ok(r.Item as Profile);
}

async function putProfile(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const auth = await authenticate(event);
  if ('error' in auth) return auth.error;

  // The schema trims list entries, drops empties (Req 1.7), and enforces the
  // 100-entry / 200-char / 5000-char bounds (Req 1.1, 1.5, 1.8).
  const body = parseBody(event, profileSchema);
  if ('error' in body) return body.error;

  // Preserve the original creation timestamp when one already exists; the
  // server always stamps `updatedAt` and never trusts client time (Req 1.3, 1.9).
  const existing = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAMES.PROFILES,
      Key: { userId: auth.ctx.sub },
      ProjectionExpression: 'createdAt',
    })
  );
  const ts = now();
  const createdAt = (existing.Item?.createdAt as string | undefined) ?? ts;

  // Replace-all semantics: every stored field is overwritten with the
  // submitted values; `notConfigured` is intentionally not set on a real save.
  const profile: Profile = {
    userId: auth.ctx.sub,
    highInterests: body.data.highInterests,
    mediumInterests: body.data.mediumInterests,
    currentlyResearching: body.data.currentlyResearching,
    alreadyKnown: body.data.alreadyKnown,
    avoidContentTypes: body.data.avoidContentTypes,
    context: body.data.context ?? '',
    createdAt,
    updatedAt: ts,
  };

  await ddb.send(new PutCommand({ TableName: TABLE_NAMES.PROFILES, Item: profile }));
  return ok(profile);
}
