import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  RECOMMENDATION_STATE,
  TABLE_NAMES,
  type KnowledgeDocument,
  type LibraryResponse,
  type RecommendationState,
} from '@app/shared';
import { ddb } from '../lib/dynamo.js';
import { authenticate } from '../lib/handler-utils.js';
import { badRequest, notFound, ok, serverError } from '../lib/response.js';

/**
 * Read-only library + document detail for the Knowledge Inbox Zero domain.
 *
 * Deterministic only — this handler NEVER calls Bedrock. All reads are scoped
 * to the authenticated owner (`ctx.sub`, Req 7.6).
 *
 * - GET /documents              → library: a page of ≤100 owned documents plus
 *                                 owner-wide per-state counts + total that
 *                                 reflect the ENTIRE owned set regardless of
 *                                 pagination (Req 7.2–7.5, 7.7).
 * - GET /documents/{documentId} → detail: metadata/summary/scores/state/
 *                                 explanation; 404 when missing or not owned
 *                                 (Req 7.8, 7.9, 6.7, 6.8).
 */

// Only ≤100 documents are returned per page (Req 7.7).
const PAGE_LIMIT = 100;

// Sentinel prefix for the per-owner counts aggregate item that shares the
// documents table (`documentId = "COUNTS#<ownerId>"`). It carries `ownerId`,
// so it surfaces in the `byOwner` GSI and must be excluded from the document
// list; it has no `stateKey`, so it never surfaces in `byOwnerState`.
const COUNTS_PREFIX = 'COUNTS#';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const method = event.httpMethod;
    const documentId = event.pathParameters?.documentId;

    if (method === 'GET' && !documentId) return listDocuments(event);
    if (method === 'GET' && documentId) return getDocument(event);

    return badRequest('Unrecognized route');
  } catch (err) {
    return serverError(err);
  }
};

/** True for the per-owner counts aggregate sentinel item (not a real document). */
function isCountsItem(item: { documentId?: string }): boolean {
  return typeof item.documentId === 'string' && item.documentId.startsWith(COUNTS_PREFIX);
}

/** Narrow an arbitrary string to a defined recommendation state (Req 7.5). */
function parseState(value: string | undefined): RecommendationState | undefined | 'invalid' {
  if (value === undefined) return undefined;
  return (RECOMMENDATION_STATE as readonly string[]).includes(value)
    ? (value as RecommendationState)
    : 'invalid';
}

/** Base64url-encode a DynamoDB LastEvaluatedKey into an opaque cursor. */
function encodeCursor(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key), 'utf-8').toString('base64url');
}

/** Decode an opaque cursor back into an ExclusiveStartKey, or 'invalid'. */
function decodeCursor(cursor: string): Record<string, unknown> | 'invalid' {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return 'invalid';
  } catch {
    return 'invalid';
  }
}

/**
 * Read the per-owner counts aggregate (`COUNTS#<ownerId>`) and project it onto
 * the LibraryResponse counts shape. Every defined state defaults to 0 when the
 * aggregate item, or an individual state counter, is absent (Req 7.3). The
 * counts reflect the whole owned set and are pagination-independent (Req 7.2,
 * 7.7).
 */
async function readCounts(ownerId: string): Promise<LibraryResponse['counts']> {
  const r = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAMES.DOCUMENTS,
      Key: { documentId: `${COUNTS_PREFIX}${ownerId}` },
    })
  );
  const agg = (r.Item ?? {}) as Partial<Record<RecommendationState | 'total', number>>;

  const counts = { total: 0 } as LibraryResponse['counts'];
  for (const state of RECOMMENDATION_STATE) {
    counts[state] = typeof agg[state] === 'number' ? agg[state] : 0;
  }
  counts.total = typeof agg.total === 'number' ? agg.total : 0;
  return counts;
}

async function listDocuments(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const auth = await authenticate(event);
  if ('error' in auth) return auth.error;
  const ownerId = auth.ctx.sub;

  // Validate the optional ?state= filter against the taxonomy (Req 7.5).
  const q = event.queryStringParameters ?? {};
  const state = parseState(q.state ?? undefined);
  if (state === 'invalid') return badRequest('Invalid recommendation state');

  // Decode the optional continuation cursor (Req 7.7).
  let exclusiveStartKey: Record<string, unknown> | undefined;
  if (q.cursor) {
    const decoded = decodeCursor(q.cursor);
    if (decoded === 'invalid') return badRequest('Invalid cursor');
    exclusiveStartKey = decoded;
  }

  // Counts always reflect the ENTIRE owned set, independent of the page or the
  // state filter (Req 7.2, 7.3, 7.7).
  const counts = await readCounts(ownerId);

  // A state filter uses the byOwnerState GSI (SK `<state>#<documentId>`); the
  // unfiltered library uses the byOwner GSI. Both are keyed on ownerId (Req 7.6).
  const query = state
    ? new QueryCommand({
        TableName: TABLE_NAMES.DOCUMENTS,
        IndexName: 'byOwnerState',
        KeyConditionExpression: 'ownerId = :o AND begins_with(stateKey, :s)',
        ExpressionAttributeValues: { ':o': ownerId, ':s': `${state}#` },
        Limit: PAGE_LIMIT,
        ExclusiveStartKey: exclusiveStartKey,
      })
    : new QueryCommand({
        TableName: TABLE_NAMES.DOCUMENTS,
        IndexName: 'byOwner',
        KeyConditionExpression: 'ownerId = :o',
        ExpressionAttributeValues: { ':o': ownerId },
        Limit: PAGE_LIMIT,
        ExclusiveStartKey: exclusiveStartKey,
      });

  const r = await ddb.send(query);

  // Exclude the COUNTS aggregate sentinel; it shares the table and appears in
  // the byOwner GSI (Req 7.2 — it is not a document).
  const documents = ((r.Items ?? []) as KnowledgeDocument[]).filter((d) => !isCountsItem(d));

  const response: LibraryResponse = { documents, counts };
  if (r.LastEvaluatedKey) {
    response.nextCursor = encodeCursor(r.LastEvaluatedKey as Record<string, unknown>);
  }
  return ok(response);
}

async function getDocument(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const auth = await authenticate(event);
  if ('error' in auth) return auth.error;

  const documentId = event.pathParameters?.documentId;
  if (!documentId) return badRequest('Missing documentId');

  const r = await ddb.send(
    new GetCommand({ TableName: TABLE_NAMES.DOCUMENTS, Key: { documentId } })
  );
  const doc = r.Item as KnowledgeDocument | undefined;

  // 404 when missing OR owned by another user — never leak existence (Req 7.9).
  if (!doc || doc.ownerId !== auth.ctx.sub) return notFound('Document');

  // Return the full document: metadata, summary (in extraction), scores, state,
  // explanation (Req 7.8, 6.7, 6.8).
  return ok(doc);
}
