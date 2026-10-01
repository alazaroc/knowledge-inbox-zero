import type { APIGatewayProxyEvent } from 'aws-lambda';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import fc from 'fast-check';
import {
  RECOMMENDATION_STATE,
  TABLE_NAMES,
  type KnowledgeDocument,
  type LibraryResponse,
  type RecommendationState,
} from '@app/shared';

// --- Mocks ---------------------------------------------------------------
// Mock the shared DynamoDB document client; we drive it with an in-memory store
// (built below) that interprets exactly the GetCommand / QueryCommand shapes the
// documents handler issues.
const send = jest.fn();
jest.mock('../lib/dynamo.js', () => ({ ddb: { send: (...args: unknown[]) => send(...args) } }));

// Mock auth so no Cognito verifier is constructed at import time (as in
// imports.test.ts). `authenticate` in handler-utils calls `verifyToken`.
const verifyToken = jest.fn();
jest.mock('../lib/auth.js', () => ({ verifyToken: (...args: unknown[]) => verifyToken(...args) }));

import { handler } from '../handlers/documents.js';

// --- In-memory DynamoDB for the documents table --------------------------
//
// Supports the three operations the handler performs against TABLE_NAMES.DOCUMENTS:
//   1. GetCommand Key={ documentId }                 (detail + COUNTS aggregate)
//   2. QueryCommand IndexName='byOwner'
//        KeyConditionExpression 'ownerId = :o'
//   3. QueryCommand IndexName='byOwnerState'
//        KeyConditionExpression 'ownerId = :o AND begins_with(stateKey, :s)'
// Both queries honour Limit + ExclusiveStartKey and return LastEvaluatedKey.

interface StoredDoc extends KnowledgeDocument {
  stateKey?: string;
}

interface CountsItem {
  documentId: string;
  ownerId: string;
  total?: number;
  READ?: number;
  SKIM?: number;
  SKIP?: number;
}

interface Store {
  // documentId -> item (real documents AND the COUNTS#<ownerId> aggregate)
  docs: Map<string, StoredDoc>;
  counts: Map<string, CountsItem>;
}

function makeStore(): Store {
  return { docs: new Map(), counts: new Map() };
}

/**
 * Deterministic sort key for a GSI page scan. `byOwner` SK is `documentId`,
 * `byOwnerState` SK is `stateKey` (`<state>#<documentId>`). We sort by the
 * relevant SK so paging + ExclusiveStartKey behave like DynamoDB.
 */
function pageQuery(
  items: StoredDoc[],
  sortKey: (d: StoredDoc) => string,
  limit: number,
  startAfter: string | undefined
): { page: StoredDoc[]; last?: string } {
  const sorted = [...items].sort((a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  const startIdx = startAfter === undefined ? 0 : sorted.findIndex((d) => sortKey(d) > startAfter);
  const begin = startIdx === -1 ? sorted.length : startIdx;
  const page = sorted.slice(begin, begin + limit);
  const consumedUpTo = begin + limit;
  const last = consumedUpTo < sorted.length ? sortKey(page[page.length - 1]) : undefined;
  return { page, last };
}

function installDdb(store: Store): void {
  send.mockImplementation((cmd: unknown): Promise<unknown> => {
    if (cmd instanceof GetCommand) {
      const { TableName, Key } = cmd.input;
      if (TableName !== TABLE_NAMES.DOCUMENTS) {
        throw new Error(`Unexpected GetCommand table: ${String(TableName)}`);
      }
      const id = (Key as { documentId: string }).documentId;
      if (id.startsWith('COUNTS#')) {
        return Promise.resolve({ Item: store.counts.get(id) });
      }
      return Promise.resolve({ Item: store.docs.get(id) });
    }

    if (cmd instanceof QueryCommand) {
      const { TableName, IndexName, ExpressionAttributeValues, Limit, ExclusiveStartKey } =
        cmd.input;
      if (TableName !== TABLE_NAMES.DOCUMENTS) {
        throw new Error(`Unexpected QueryCommand table: ${String(TableName)}`);
      }
      const values = (ExpressionAttributeValues ?? {}) as Record<string, string>;
      const ownerId = values[':o'];
      const limit = Limit ?? 100;

      if (IndexName === 'byOwner') {
        // byOwner only surfaces items carrying ownerId: real docs + COUNTS agg.
        const owned: StoredDoc[] = [...store.docs.values()].filter((d) => d.ownerId === ownerId);
        const countsAgg = store.counts.get(`COUNTS#${ownerId}`);
        if (countsAgg) {
          // The COUNTS aggregate shares the table and surfaces in byOwner; the
          // handler must filter it out. Model that by including it here.
          owned.push({
            documentId: countsAgg.documentId,
            ownerId: countsAgg.ownerId,
          } as StoredDoc);
        }
        const startAfter = (ExclusiveStartKey as { documentId?: string } | undefined)?.documentId;
        const { page, last } = pageQuery(owned, (d) => d.documentId, limit, startAfter);
        return Promise.resolve({
          Items: page,
          LastEvaluatedKey: last === undefined ? undefined : { documentId: last },
        });
      }

      if (IndexName === 'byOwnerState') {
        const prefix = values[':s']; // `<state>#`
        // byOwnerState only surfaces items that have a stateKey (real analyzed
        // docs). The COUNTS aggregate has no stateKey so it never appears.
        const matching = [...store.docs.values()].filter(
          (d) =>
            d.ownerId === ownerId && typeof d.stateKey === 'string' && d.stateKey.startsWith(prefix)
        );
        const startAfter = (ExclusiveStartKey as { stateKey?: string } | undefined)?.stateKey;
        const { page, last } = pageQuery(matching, (d) => d.stateKey!, limit, startAfter);
        return Promise.resolve({
          Items: page,
          LastEvaluatedKey: last === undefined ? undefined : { stateKey: last },
        });
      }

      throw new Error(`Unexpected QueryCommand index: ${String(IndexName)}`);
    }

    throw new Error(`Unexpected DynamoDB command: ${String(cmd)}`);
  });
}

// --- Helpers -------------------------------------------------------------
function authAs(sub: string): void {
  verifyToken.mockResolvedValue({ sub, email: 'u@test.dev', role: 'USER' });
}

function listEvent(sub: string, params?: Record<string, string>): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    headers: { Authorization: `Bearer ${sub}` },
    pathParameters: null,
    queryStringParameters: params ?? null,
    body: null,
  } as unknown as APIGatewayProxyEvent;
}

function seedDoc(
  store: Store,
  ownerId: string,
  documentId: string,
  state: RecommendationState
): StoredDoc {
  const doc: StoredDoc = {
    documentId,
    ownerId,
    batchId: 'batch-1',
    rawUrl: `https://example.com/${documentId}`,
    canonicalUrl: `https://example.com/${documentId}`,
    status: 'completed',
    recommendationState: state,
    stateKey: `${state}#${documentId}`,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
  store.docs.set(documentId, doc);
  return doc;
}

/** Seed the COUNTS#<ownerId> aggregate to the true per-state totals. */
function seedCounts(store: Store, ownerId: string, docs: StoredDoc[]): void {
  const agg: CountsItem = {
    documentId: `COUNTS#${ownerId}`,
    ownerId,
    total: docs.length,
    READ: 0,
    SKIM: 0,
    SKIP: 0,
  };
  for (const d of docs) {
    agg[d.recommendationState as RecommendationState] =
      (agg[d.recommendationState as RecommendationState] ?? 0) + 1;
  }
  store.counts.set(agg.documentId, agg);
}

/** Walk all pages of GET /documents, following nextCursor until absent. */
async function walkAllPages(
  sub: string,
  params?: Record<string, string>
): Promise<{ documents: KnowledgeDocument[]; counts: LibraryResponse['counts']; pages: number }> {
  const all: KnowledgeDocument[] = [];
  let cursor: string | undefined;
  let counts: LibraryResponse['counts'] | undefined;
  let pages = 0;
  // Guard against an accidental infinite loop in a buggy handler.
  const MAX_PAGES = 10_000;
  do {
    const p = { ...(params ?? {}), ...(cursor ? { cursor } : {}) };
    const res = await handler(listEvent(sub, p));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as LibraryResponse;
    expect(body.documents.length).toBeLessThanOrEqual(100);
    all.push(...body.documents);
    counts = body.counts;
    cursor = body.nextCursor;
    pages += 1;
    if (pages > MAX_PAGES) throw new Error('pagination did not terminate');
  } while (cursor);
  return { documents: all, counts: counts!, pages };
}

// --- Property 16: Library grouping and pagination integrity --------------
// Validates: Requirements 7.2, 7.3, 7.4, 7.7
describe('documents handler — Property 16: library grouping + pagination integrity', () => {
  const OWNER = 'owner-16';
  const OTHER = 'other-owner';

  const docEntry = fc.record({
    id: fc.uuid(),
    state: fc.constantFrom(...RECOMMENDATION_STATE),
  });

  it('counts reflect the full owned set and pages union without dup/omission', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Varied N including >100 to force pagination across multiple pages.
        fc.uniqueArray(docEntry, {
          minLength: 0,
          maxLength: 260,
          selector: (e) => e.id,
        }),
        // Some documents owned by another user, which must never leak.
        fc.array(docEntry, { minLength: 0, maxLength: 40 }),
        fc.context(),
        async (owned, foreign, ctx) => {
          const store = makeStore();
          installDdb(store);
          authAs(OWNER);

          const ownedDocs = owned.map((e) => seedDoc(store, OWNER, e.id, e.state));
          // Foreign docs under a different owner (distinct id namespace); they
          // must never leak into OWNER's library or counts.
          const foreignDocs = foreign.map((e, i) =>
            seedDoc(store, OTHER, `foreign-${i}-${e.id}`, e.state)
          );
          seedCounts(store, OWNER, ownedDocs);
          seedCounts(store, OTHER, foreignDocs);

          // Expected per-state totals over the ENTIRE owned set.
          const expected = { total: ownedDocs.length } as Record<string, number>;
          for (const s of RECOMMENDATION_STATE) expected[s] = 0;
          for (const d of ownedDocs) expected[d.recommendationState as string] += 1;

          // (b) Walk all unfiltered pages.
          const walk = await walkAllPages(OWNER);

          // (a) counts/total reflect the full owned set, pagination-independent.
          expect(walk.counts.total).toBe(ownedDocs.length);
          for (const s of RECOMMENDATION_STATE) {
            expect(walk.counts[s]).toBe(expected[s]);
          }

          // (b) union == full owned set, no dups, no omissions, no COUNTS item.
          const returnedIds = walk.documents.map((d) => d.documentId);
          expect(returnedIds.some((id) => id.startsWith('COUNTS#'))).toBe(false);
          // no duplicates
          expect(new Set(returnedIds).size).toBe(returnedIds.length);
          // same set as owned
          expect(new Set(returnedIds)).toEqual(new Set(ownedDocs.map((d) => d.documentId)));
          // every returned doc is owned by OWNER
          for (const d of walk.documents) expect(d.ownerId).toBe(OWNER);

          // counts are independent of cursor: a bare first page carries the
          // same full counts as the final page.
          const firstRes = await handler(listEvent(OWNER));
          const firstBody = JSON.parse(firstRes.body) as LibraryResponse;
          expect(firstBody.counts).toEqual(walk.counts);

          // (c) state filter: for each state, every returned doc is in that
          // state, and the union equals exactly the owned docs in that state.
          for (const s of RECOMMENDATION_STATE) {
            const filtered = await walkAllPages(OWNER, { state: s });
            // counts still reflect the FULL owned set regardless of filter.
            expect(filtered.counts.total).toBe(ownedDocs.length);
            for (const d of filtered.documents) {
              expect(d.recommendationState).toBe(s);
              expect(d.ownerId).toBe(OWNER);
            }
            const expectedInState = new Set(
              ownedDocs.filter((d) => d.recommendationState === s).map((d) => d.documentId)
            );
            const gotInState = new Set(filtered.documents.map((d) => d.documentId));
            expect(gotInState).toEqual(expectedInState);
          }

          ctx.log(
            `owned=${ownedDocs.length} pages=${walk.pages} ` +
              `READ=${expected.READ} SKIM=${expected.SKIM} SKIP=${expected.SKIP}`
          );
        }
      ),
      { numRuns: 60 }
    );
  });

  it('rejects an invalid ?state= filter with 400 (Req 7.5)', async () => {
    const store = makeStore();
    installDdb(store);
    authAs(OWNER);
    seedCounts(store, OWNER, []);

    const res = await handler(listEvent(OWNER, { state: 'MAYBE' }));
    expect(res.statusCode).toBe(400);
  });

  it('rejects an invalid cursor with 400 (Req 7.7)', async () => {
    const store = makeStore();
    installDdb(store);
    authAs(OWNER);
    seedCounts(store, OWNER, []);

    const res = await handler(listEvent(OWNER, { cursor: 'not-base64url-json' }));
    expect(res.statusCode).toBe(400);
  });

  it('returns zeroed counts and no documents for an owner with no data', async () => {
    const store = makeStore();
    installDdb(store);
    authAs(OWNER);
    // No COUNTS aggregate seeded at all → defaults to 0 (Req 7.3).

    const res = await handler(listEvent(OWNER));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as LibraryResponse;
    expect(body.documents).toHaveLength(0);
    expect(body.counts).toEqual({ total: 0, READ: 0, SKIM: 0, SKIP: 0 });
    expect(body.nextCursor).toBeUndefined();
  });
});
