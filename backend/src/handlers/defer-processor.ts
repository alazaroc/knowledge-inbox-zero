import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  SendMessageBatchCommand,
  SQSClient,
  type SendMessageBatchRequestEntry,
} from '@aws-sdk/client-sqs';
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import {
  DAILY_IMPORT_LIMIT_USER,
  TABLE_NAMES,
  canonicalizeUrl,
  deriveDocumentId,
  type Batch,
  type DeferredQueue,
  type KnowledgeDocument,
} from '@app/shared';
import { ddb } from '../lib/dynamo.js';
import { newId, now } from '../lib/ids.js';

/**
 * Deferred-import drainer — EventBridge-scheduled once a day, NOT an API route.
 *
 * When a USER pastes more new links than the daily cap allows, the imports
 * handler saves the excess to a per-owner deferred queue (`DEFERRED#<ownerId>`)
 * instead of throwing it away. This job runs every day and, for each owner with
 * a non-empty queue, re-imports as many of those URLs as that day's remaining
 * quota allows — oldest first — exactly like a normal import (canonicalize →
 * dedupe → create pending Documents → enqueue to SQS). What still doesn't fit
 * stays queued for the following day. Whatever it processed, the user gets a
 * short email so they know their saved links are moving on their own.
 *
 * Reuses the SAME per-day USAGE counter as imports, so a user who also imported
 * manually that day doesn't blow past the cap. Deterministic; never calls
 * Bedrock (the worker does, once the SQS messages land).
 */

const sqs = new SQSClient({});
const cognito = new CognitoIdentityProviderClient({});
// SES lives in its own region (same convention as the digest handler).
const ses = new SESv2Client({ region: process.env.DIGEST_SES_REGION || process.env.AWS_REGION });

const queueUrl = () => process.env.ANALYSIS_QUEUE_URL ?? '';
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID ?? '';
const DIGEST_FROM = process.env.DIGEST_FROM ?? '';
const APP_URL = (process.env.DIGEST_APP_URL ?? '').replace(/\/+$/, '');

const USAGE_PREFIX = 'USAGE#';
const DEFERRED_PREFIX = 'DEFERRED#';
const SQS_BATCH_SIZE = 10;

function usageDay(): string {
  return new Date().toISOString().slice(0, 10);
}
function usageKey(ownerId: string): string {
  return `${USAGE_PREFIX}${ownerId}#${usageDay()}`;
}
function deferredKey(ownerId: string): string {
  return `${DEFERRED_PREFIX}${ownerId}`;
}

interface PlannedDoc {
  documentId: string;
  canonicalUrl: string;
  rawUrl: string;
}

export const handler = async (): Promise<{ owners: number; processed: number }> => {
  const queues = await scanDeferredQueues();
  console.log(JSON.stringify({ stage: 'defer-processor', owners: queues.length }));

  let processedTotal = 0;
  let ownersTouched = 0;
  for (const q of queues) {
    try {
      const n = await drainOwner(q);
      if (n > 0) {
        processedTotal += n;
        ownersTouched += 1;
      }
    } catch (err) {
      // One owner's failure never blocks the rest of the run.
      console.error(
        JSON.stringify({
          stage: 'defer-processor-owner',
          ownerId: q.ownerId,
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }

  console.log(
    JSON.stringify({ stage: 'defer-processor', ownersTouched, processed: processedTotal })
  );
  return { owners: ownersTouched, processed: processedTotal };
};

/** Scan the documents table for every per-owner deferred-queue sentinel item. */
async function scanDeferredQueues(): Promise<DeferredQueue[]> {
  const out: DeferredQueue[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAMES.DOCUMENTS,
        FilterExpression: 'begins_with(documentId, :p)',
        ExpressionAttributeValues: { ':p': DEFERRED_PREFIX },
        ExclusiveStartKey: startKey,
      })
    );
    for (const item of (page.Items ?? []) as DeferredQueue[]) {
      if (Array.isArray(item.urls) && item.urls.length > 0) out.push(item);
    }
    startKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  return out;
}

/**
 * Drain one owner's deferred queue up to today's remaining quota. Returns the
 * number of documents actually enqueued (0 when the owner already hit the cap
 * through manual imports — the queue is left untouched for tomorrow).
 */
async function drainOwner(q: DeferredQueue): Promise<number> {
  const ownerId = q.ownerId;
  const usedToday = await readUsageToday(ownerId);
  const remaining = Math.max(0, DAILY_IMPORT_LIMIT_USER - usedToday);
  if (remaining === 0) return 0; // no quota today; keep everything for tomorrow

  // Take the oldest URLs first, up to the remaining quota.
  const take = q.urls.slice(0, remaining);
  const rest = q.urls.slice(remaining);

  // Canonicalize + dedupe against each other and against already-owned docs,
  // exactly like the imports handler. A URL that no longer canonicalizes, or is
  // already owned, is simply skipped (it consumed no quota) — we don't re-queue
  // it to tomorrow since it's resolved.
  const planned = new Map<string, PlannedDoc>();
  for (const raw of take) {
    let canonicalUrl: string;
    try {
      canonicalUrl = canonicalizeUrl(raw);
    } catch {
      continue; // unparseable now → drop (don't carry forever)
    }
    if (planned.has(canonicalUrl)) continue;
    const documentId = deriveDocumentId(ownerId, canonicalUrl);
    const existing = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAMES.DOCUMENTS,
        Key: { documentId },
        ProjectionExpression: 'documentId',
      })
    );
    if (existing.Item) continue; // already owned → nothing to do
    planned.set(canonicalUrl, { documentId, canonicalUrl, rawUrl: raw });
  }

  const newDocs = [...planned.values()];

  // Persist the remaining (un-taken) queue first so a crash mid-run never loses
  // the URLs we didn't get to. If nothing is left, delete the sentinel.
  await saveQueue(ownerId, rest, q.createdAt);

  if (newDocs.length === 0) {
    // Everything we took was a duplicate / unparseable; nothing enqueued, but the
    // queue was still advanced. No email (nothing actionable happened).
    return 0;
  }

  const ts = now();
  const batchId = newId();
  const batch: Batch = {
    batchId,
    ownerId,
    status: 'processing',
    total: newDocs.length,
    pending: newDocs.length,
    processing: 0,
    completed: 0,
    failed: 0,
    rejected: [],
    createdAt: ts,
    updatedAt: ts,
  };
  await ddb.send(new PutCommand({ TableName: TABLE_NAMES.BATCHES, Item: batch }));

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

  await enqueueDocuments(batchId, ownerId, newDocs);
  await incrementUsageToday(ownerId, newDocs.length);

  // Tell the user their saved links are being processed. Best-effort: a mail
  // failure never fails the drain (the links are already enqueued).
  try {
    await notifyUser(ownerId, newDocs.length, rest.length);
  } catch (err) {
    console.error(
      JSON.stringify({
        stage: 'defer-processor-notify',
        ownerId,
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }

  return newDocs.length;
}

/** Persist the remaining deferred URLs, or delete the sentinel when empty. */
async function saveQueue(ownerId: string, urls: string[], createdAt: string): Promise<void> {
  if (urls.length === 0) {
    await ddb.send(
      new DeleteCommand({
        TableName: TABLE_NAMES.DOCUMENTS,
        Key: { documentId: deferredKey(ownerId) },
      })
    );
    return;
  }
  const ts = now();
  const item: DeferredQueue = {
    documentId: deferredKey(ownerId),
    ownerId,
    urls,
    createdAt: createdAt || ts,
    updatedAt: ts,
  };
  await ddb.send(new PutCommand({ TableName: TABLE_NAMES.DOCUMENTS, Item: item }));
}

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

async function readUsageToday(ownerId: string): Promise<number> {
  const r = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAMES.DOCUMENTS,
      Key: { documentId: usageKey(ownerId) },
      ProjectionExpression: '#c',
      ExpressionAttributeNames: { '#c': 'count' },
    })
  );
  const count = (r.Item as { count?: number } | undefined)?.count;
  return typeof count === 'number' ? count : 0;
}

async function incrementUsageToday(ownerId: string, n: number): Promise<void> {
  if (n <= 0) return;
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAMES.DOCUMENTS,
      Key: { documentId: usageKey(ownerId) },
      UpdateExpression: 'ADD #c :n SET updatedAt = :ts',
      ExpressionAttributeNames: { '#c': 'count' },
      ExpressionAttributeValues: { ':n': n, ':ts': now() },
    })
  );
}

/** Resolve a user's email from Cognito by their sub (the owner id). */
async function emailForUser(sub: string): Promise<string | undefined> {
  if (!USER_POOL_ID) return undefined;
  const r = await cognito.send(
    new ListUsersCommand({ UserPoolId: USER_POOL_ID, Filter: `sub = "${sub}"`, Limit: 1 })
  );
  const attrs = r.Users?.[0]?.Attributes ?? [];
  return attrs.find((a) => a.Name === 'email')?.Value;
}

/** Email the user that their deferred links were picked up today. */
async function notifyUser(ownerId: string, processed: number, stillQueued: number): Promise<void> {
  if (!DIGEST_FROM) return; // SES not configured → skip quietly
  const to = await emailForUser(ownerId);
  if (!to) return;

  const libraryUrl = APP_URL ? `${APP_URL}/app/library` : '';
  const stillLine =
    stillQueued > 0
      ? `<p style="margin:0 0 12px;color:#4b5563">${stillQueued} more ${
          stillQueued === 1 ? 'link is' : 'links are'
        } still saved and will be processed on the next day${stillQueued === 1 ? '' : 's'}.</p>`
      : '';
  const cta = libraryUrl
    ? `<p style="margin:16px 0 0"><a href="${libraryUrl}" style="background:#4f46e5;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600">Open your library</a></p>`
    : '';

  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px">` +
    `<h1 style="font-size:18px;margin:0 0 12px;color:#111827">Your saved links are on the move</h1>` +
    `<p style="margin:0 0 12px;color:#111827">We just started analyzing <strong>${processed}</strong> ` +
    `link${processed === 1 ? '' : 's'} you added over your daily limit earlier. They'll appear in your ` +
    `library as they finish — no need to re-add them.</p>` +
    stillLine +
    cta +
    `</div>`;
  const text =
    `We just started analyzing ${processed} link${processed === 1 ? '' : 's'} you added over your ` +
    `daily limit earlier. They'll appear in your library as they finish — no need to re-add them.` +
    (stillQueued > 0
      ? ` ${stillQueued} more ${stillQueued === 1 ? 'link is' : 'links are'} still saved for the next day.`
      : '') +
    (libraryUrl ? `\n\nOpen your library: ${libraryUrl}` : '');

  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: DIGEST_FROM,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: {
            Data: `${processed} saved link${processed === 1 ? '' : 's'} now being analyzed`,
          },
          Body: { Html: { Data: html }, Text: { Data: text } },
        },
      },
    })
  );
}
