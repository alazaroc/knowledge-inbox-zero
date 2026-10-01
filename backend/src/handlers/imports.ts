import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  SendMessageBatchCommand,
  SQSClient,
  type SendMessageBatchRequestEntry,
} from '@aws-sdk/client-sqs';
import {
  TABLE_NAMES,
  canonicalizeUrl,
  deriveDocumentId,
  importCreateSchema,
  type Batch,
  type KnowledgeDocument,
  type RejectedEntry,
} from '@app/shared';
import { ddb } from '../lib/dynamo.js';
import { authenticate, parseBody } from '../lib/handler-utils.js';
import { badRequest, created, notFound, ok, serverError } from '../lib/response.js';
import { newId, now } from '../lib/ids.js';

/**
 * Import batches from pasted URLs, enqueue analysis, and serve batch progress.
 *
 * Purely deterministic: validate → canonicalize → dedup → create the `Batch`
 * record + new `Document`s in `pending` → enqueue one SQS message per NEW
 * document → return `201` with the batch id in well under 3 seconds (Req 3.1).
 * All fetching, LLM extraction, scoring, and explanation happen in the async
 * worker. This handler NEVER calls Bedrock.
 *
 * - POST   /imports            → create a batch (Req 2.1–2.8, 3.1, 3.2)
 * - GET    /imports/{batchId}  → batch counts + status for polling (Req 3.3, 8.11)
 * - GET    /imports            → list the caller's batches, newest first (Req 7.1)
 */

// Per-batch cap after normalization (Req 2.7).
const MAX_URLS_PER_BATCH = 500;

// One message per new document; SQS SendMessageBatch accepts up to 10 at a time.
const SQS_BATCH_SIZE = 10;

const sqs = new SQSClient({});
const queueUrl = () => process.env.ANALYSIS_QUEUE_URL ?? '';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const method = event.httpMethod;
    const batchId = event.pathParameters?.batchId;

    if (method === 'POST' && !batchId) return createBatch(event);
    if (method === 'GET' && batchId) return getBatch(event);
    if (method === 'GET' && !batchId) return listBatches(event);

    return badRequest('Unrecognized route');
  } catch (err) {
    return serverError(err);
  }
};

interface PlannedDoc {
  documentId: string;
  canonicalUrl: string;
  rawUrl: string;
}

async function createBatch(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const auth = await authenticate(event);
  if ('error' in auth) return auth.error;

  const body = parseBody(event, importCreateSchema);
  if ('error' in body) return body.error;

  const ownerId = auth.ctx.sub;

  // Req 2.1: normalize each line — trim, drop blank/whitespace-only lines.
  const lines = body.data.urls
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Req 2.3 / 3.2: zero non-blank lines → reject without creating a Batch.
  if (lines.length === 0) {
    return badRequest('No URLs were provided');
  }

  // Req 2.7: more than 500 lines after normalization → reject.
  if (lines.length > MAX_URLS_PER_BATCH) {
    return badRequest(`Per-batch limit of ${MAX_URLS_PER_BATCH} URLs was exceeded`);
  }

  const rejected: RejectedEntry[] = [];
  // Canonical URL → the NEW document planned for it (dedup within the submission, Req 2.6).
  const newDocsByCanonical = new Map<string, PlannedDoc>();

  for (const line of lines) {
    let canonicalUrl: string;
    try {
      // Req 2.5: canonicalizeUrl prepends https:// when scheme is absent.
      canonicalUrl = canonicalizeUrl(line);
    } catch {
      // Req 2.4: invalid URL → record rejected and continue with the rest.
      rejected.push({ line, reason: 'invalid_url' });
      continue;
    }

    const documentId = deriveDocumentId(ownerId, canonicalUrl);

    // Req 2.6: within-submission duplicate → counted as accepted, no new document.
    if (newDocsByCanonical.has(canonicalUrl)) continue;

    // Req 2.8: reuse an existing owned document rather than creating a duplicate.
    const existing = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAMES.DOCUMENTS,
        Key: { documentId },
        ProjectionExpression: 'documentId',
      })
    );
    if (existing.Item) continue; // accepted, but reuses the existing Document

    newDocsByCanonical.set(canonicalUrl, { documentId, canonicalUrl, rawUrl: line });
  }

  const newDocs = [...newDocsByCanonical.values()];

  const ts = now();
  const batchId = newId();

  // Counter semantics (Req 2.2; CP-10 — `pending+processing+completed+failed == total`):
  // only NEW documents transition through the pipeline counters, so `pending`
  // is the number of new documents enqueued and `total = pending + rejected`.
  // Duplicates / already-owned URLs are accepted but create no Document and so
  // are not tracked by the per-document counters (they would otherwise leave
  // the batch unable to ever reach `finished`).
  const pending = newDocs.length;
  const batch: Batch = {
    batchId,
    ownerId,
    status: 'processing',
    total: pending + rejected.length,
    pending,
    processing: 0,
    completed: 0,
    failed: 0,
    rejected,
    createdAt: ts,
    updatedAt: ts,
  };

  await ddb.send(new PutCommand({ TableName: TABLE_NAMES.BATCHES, Item: batch }));

  // Create new Document items in `pending`.
  await Promise.all(
    newDocs.map((d) => {
      const doc: KnowledgeDocument = {
        documentId: d.documentId,
        ownerId,
        batchId,
        rawUrl: d.rawUrl,
        canonicalUrl: d.canonicalUrl,
        status: 'pending',
        createdAt: ts,
        updatedAt: ts,
      };
      return ddb.send(new PutCommand({ TableName: TABLE_NAMES.DOCUMENTS, Item: doc }));
    })
  );

  // Enqueue ONE SQS message per NEW document for the async worker.
  await enqueueDocuments(batchId, ownerId, newDocs);

  // Req 3.1: acknowledge the batch (batchId + counts) within 3s.
  return created({
    batchId,
    total: batch.total,
    pending: batch.pending,
    rejected,
  });
}

/** Enqueues one analysis message per new document (batched in groups of 10). */
async function enqueueDocuments(
  batchId: string,
  ownerId: string,
  docs: PlannedDoc[]
): Promise<void> {
  const url = queueUrl();
  if (!url || docs.length === 0) return;

  for (let i = 0; i < docs.length; i += SQS_BATCH_SIZE) {
    const slice = docs.slice(i, i + SQS_BATCH_SIZE);
    const entries: SendMessageBatchRequestEntry[] = slice.map((d, idx) => ({
      Id: String(idx),
      MessageBody: JSON.stringify({ documentId: d.documentId, batchId, ownerId }),
    }));
    await sqs.send(new SendMessageBatchCommand({ QueueUrl: url, Entries: entries }));
  }
}

async function getBatch(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const auth = await authenticate(event);
  if ('error' in auth) return auth.error;
  const batchId = event.pathParameters?.batchId;
  if (!batchId) return badRequest('Missing batchId');

  const r = await ddb.send(new GetCommand({ TableName: TABLE_NAMES.BATCHES, Key: { batchId } }));
  const batch = r.Item as Batch | undefined;
  // 404 when missing or not owned by the caller (Req 3.3, 8.11).
  if (!batch || batch.ownerId !== auth.ctx.sub) return notFound('Batch');
  return ok(batch);
}

async function listBatches(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const auth = await authenticate(event);
  if ('error' in auth) return auth.error;

  // List the caller's batches via the byOwner GSI (PK ownerId, SK createdAt),
  // newest first (Req 7.1).
  const r = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAMES.BATCHES,
      IndexName: 'byOwner',
      KeyConditionExpression: 'ownerId = :o',
      ExpressionAttributeValues: { ':o': auth.ctx.sub },
      ScanIndexForward: false,
    })
  );
  return ok({ batches: (r.Items ?? []) as Batch[] });
}
