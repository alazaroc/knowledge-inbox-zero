import type { APIGatewayProxyEvent } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import fc from 'fast-check';
import {
  DIFFICULTY,
  RECOMMENDATION_STATE,
  RECOMMENDATION_TAG,
  TABLE_NAMES,
  type KnowledgeDocument,
} from '@app/shared';

// --- Mocks ---------------------------------------------------------------
const send = jest.fn();
jest.mock('../lib/dynamo.js', () => ({ ddb: { send: (...args: unknown[]) => send(...args) } }));

const verifyToken = jest.fn();
jest.mock('../lib/auth.js', () => ({ verifyToken: (...args: unknown[]) => verifyToken(...args) }));

import { handler } from '../handlers/documents.js';

// --- In-memory documents table (GetCommand only) -------------------------
const store = new Map<string, KnowledgeDocument>();

function installDdb(): void {
  send.mockImplementation((cmd: unknown): Promise<unknown> => {
    if (cmd instanceof GetCommand) {
      const { TableName, Key } = cmd.input;
      if (TableName !== TABLE_NAMES.DOCUMENTS) {
        throw new Error(`Unexpected GetCommand table: ${String(TableName)}`);
      }
      const id = (Key as { documentId: string }).documentId;
      return Promise.resolve({ Item: store.get(id) });
    }
    throw new Error(`Unexpected DynamoDB command: ${String(cmd)}`);
  });
}

function authAs(sub: string): void {
  verifyToken.mockResolvedValue({ sub, email: 'u@test.dev', role: 'USER' });
}

function detailEvent(sub: string, documentId: string): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    headers: { Authorization: `Bearer ${sub}` },
    pathParameters: { documentId },
    queryStringParameters: null,
    body: null,
  } as unknown as APIGatewayProxyEvent;
}

beforeEach(() => {
  jest.clearAllMocks();
  store.clear();
  installDdb();
});

// --- Property 11: Round-trip persistence ---------------------------------
// Validates: Requirements 6.7, 7.1
//
// A fully-analyzed KnowledgeDocument written into the store must come back
// through GET /documents/{documentId} equivalent — scores, recommendation
// state, tags, and explanation round-trip without loss.
describe('documents handler — Property 11: round-trip persistence (Req 6.7, 7.1)', () => {
  const OWNER = 'owner-11';

  const score = fc.integer({ min: 0, max: 100 });
  const scores = fc.record({
    relevance: score,
    novelty: score,
    redundancy: score,
    freshness: score,
    mkv: score,
    freshnessEstimated: fc.boolean(),
  });

  const extraction = fc.record({
    topics: fc.array(fc.string(), { maxLength: 8 }),
    concepts: fc.array(fc.string(), { maxLength: 8 }),
    claims: fc.array(fc.string(), { maxLength: 8 }),
    difficulty: fc.constantFrom(...DIFFICULTY),
    summary: fc.string({ maxLength: 200 }),
    truncated: fc.boolean(),
  });

  const docArb = fc.record({
    documentId: fc.uuid(),
    state: fc.constantFrom(...RECOMMENDATION_STATE),
    tags: fc.uniqueArray(fc.constantFrom(...RECOMMENDATION_TAG), { maxLength: 4 }),
    explanation: fc.string({ minLength: 1, maxLength: 1500 }),
    scores,
    extraction,
  });

  it('write then GET /documents/{id} yields an equivalent object', async () => {
    await fc.assert(
      fc.asyncProperty(docArb, async (d) => {
        store.clear();
        authAs(OWNER);

        const written: KnowledgeDocument = {
          documentId: d.documentId,
          ownerId: OWNER,
          batchId: 'batch-rt',
          rawUrl: `https://example.com/${d.documentId}`,
          canonicalUrl: `https://example.com/${d.documentId}`,
          status: 'completed',
          metadata: { title: 'T', sourceDomain: 'example.com' },
          extraction: d.extraction,
          scores: d.scores,
          recommendationState: d.state,
          tags: d.tags,
          explanation: d.explanation,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        };
        store.set(written.documentId, written);

        const res = await handler(detailEvent(OWNER, d.documentId));
        expect(res.statusCode).toBe(200);
        const got = JSON.parse(res.body) as KnowledgeDocument;

        // Full structural equivalence (JSON round-trip through API).
        expect(got).toEqual(written);
        // Explicit field-level round-trip of the analysis payload.
        expect(got.scores).toEqual(d.scores);
        expect(got.recommendationState).toBe(d.state);
        expect(got.tags).toEqual(d.tags);
        expect(got.explanation).toBe(d.explanation);
        expect(got.extraction).toEqual(d.extraction);
      }),
      { numRuns: 100 }
    );
  });

  // --- Req 7.9: 404 semantics (missing + cross-owner) --------------------
  it('returns 404 for a non-existent document id (Req 7.9)', async () => {
    authAs(OWNER);
    const res = await handler(detailEvent(OWNER, 'does-not-exist'));
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for a document owned by another user (Req 7.9)', async () => {
    authAs(OWNER);
    const foreign: KnowledgeDocument = {
      documentId: 'foreign-doc',
      ownerId: 'someone-else',
      batchId: 'b',
      rawUrl: 'https://example.com/x',
      canonicalUrl: 'https://example.com/x',
      status: 'completed',
      recommendationState: 'READ',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    store.set(foreign.documentId, foreign);

    const res = await handler(detailEvent(OWNER, 'foreign-doc'));
    expect(res.statusCode).toBe(404);
    // Must not leak the foreign document's contents.
    expect(res.body).not.toContain('someone-else');
  });

  it('returns 401 when unauthenticated', async () => {
    verifyToken.mockResolvedValue(null);
    const res = await handler(detailEvent(OWNER, 'anything'));
    expect(res.statusCode).toBe(401);
  });
});
