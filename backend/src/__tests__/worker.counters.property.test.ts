/**
 * Task 6.6 — Property 10: Batch count conservation (CP-10).
 *
 * Validates: Requirements 2.2, 3.3, 3.8, 3.10
 *
 * Drives an arbitrary batch of N documents — each randomly destined to succeed
 * or fail — through the real analysis-worker pipeline against a stateful
 * in-memory DynamoDB, then asserts:
 *   - pending + processing + completed + failed === total at every observed
 *     point and at the end,
 *   - total is immutable,
 *   - status === 'finished' iff pending + processing === 0,
 *   - completed + failed === total when finished.
 */
import fc from 'fast-check';

// --- Mocks (self-contained factories, delegating to shared harness) ------
import {
  assertCounterInvariant,
  createInMemoryDdb,
  emptyProfile,
  makeBatch,
  makeDocument,
  sqsEvent,
} from './worker-test-harness.js';

const { store, send } = createInMemoryDdb();
jest.mock('../lib/dynamo.js', () => ({ ddb: { send: (...a: unknown[]) => send(...a) } }));

const retrieveReadable = jest.fn();
jest.mock('../lib/retrieve.js', () => ({
  retrieveReadable: (...a: unknown[]) => retrieveReadable(...a),
}));

const bedrockExtract = jest.fn();
const bedrockExplain = jest.fn();
jest.mock('../lib/bedrock.js', () => ({
  bedrockExtract: (...a: unknown[]) => bedrockExtract(...a),
  bedrockExplain: (...a: unknown[]) => bedrockExplain(...a),
}));

const s3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({ send: (...a: unknown[]) => s3Send(...a) })),
  };
});

import { handler } from '../handlers/analysis-worker.js';

// --- Fixtures ------------------------------------------------------------
const OWNER = 'owner-1';

function resetStore() {
  store.batches.clear();
  store.documents.clear();
  store.profiles.clear();
  store.counts.clear();
}

beforeEach(() => {
  jest.clearAllMocks();
  resetStore();
  process.env.BEDROCK_MODEL_ID = 'test-model';
  process.env.CONTENT_BUCKET = 'test-bucket';
  s3Send.mockResolvedValue({});
  bedrockExtract.mockResolvedValue({
    topics: ['t'],
    concepts: ['c'],
    claims: ['x'],
    difficulty: 'INTRO',
    summary: 's',
  });
  bedrockExplain.mockResolvedValue(
    'This is a sufficiently long explanation that satisfies the fifty character minimum requirement.'
  );
});

describe('analysis worker — Property 10: batch count conservation (Req 2.2, 3.3, 3.8, 3.10)', () => {
  it('conserves counters across arbitrary success/failure batches', async () => {
    await fc.assert(
      fc.asyncProperty(
        // N documents, each flagged success(true)/failure(false).
        fc.array(fc.boolean(), { minLength: 1, maxLength: 12 }),
        // How to split the N records across SQS invocations (chunk sizes 1..5).
        fc.integer({ min: 1, max: 5 }),
        async (outcomes, chunkSize) => {
          resetStore();
          send.mockClear();

          const n = outcomes.length;
          const batchId = 'batch-1';
          store.batches.set(batchId, makeBatch(batchId, OWNER, n));
          store.profiles.set(OWNER, emptyProfile(OWNER));

          // Map canonical URL → should-fail, so the retrieve mock can decide.
          const failUrls = new Set<string>();
          const messages = outcomes.map((succeed, i) => {
            const documentId = `doc-${i}`;
            const url = `https://example.com/${i}`;
            store.documents.set(documentId, makeDocument(documentId, OWNER, batchId, url));
            if (!succeed) failUrls.add(url);
            return { documentId, batchId, ownerId: OWNER };
          });

          // A failing doc makes retrieveReadable throw, which the worker turns
          // into a failed document + batchItemFailure.
          retrieveReadable.mockImplementation((url: string) => {
            if (failUrls.has(url)) throw new Error('forced retrieve failure');
            return Promise.resolve({
              text: 'readable content',
              html: '<html>readable content</html>',
              metadata: { sourceDomain: 'example.com', publishedAt: '2024-01-01T00:00:00.000Z' },
              degraded: false,
            });
          });

          // Chunk the records into separate SQS invocations.
          const batch = store.batches.get(batchId)!;
          const reportedFailures: string[] = [];
          for (let i = 0; i < messages.length; i += chunkSize) {
            const chunk = messages.slice(i, i + chunkSize);
            const res = await handler(sqsEvent(chunk));
            // Invariant holds after every invocation.
            assertCounterInvariant(batch);
            expect(batch.total).toBe(n); // total immutable
            for (const f of res.batchItemFailures) reportedFailures.push(f.itemIdentifier);
          }

          // Final assertions.
          assertCounterInvariant(batch);
          expect(batch.total).toBe(n);
          expect(batch.pending).toBe(0);
          expect(batch.processing).toBe(0);

          const expectedFailed = outcomes.filter((o) => !o).length;
          const expectedCompleted = n - expectedFailed;
          expect(batch.failed).toBe(expectedFailed);
          expect(batch.completed).toBe(expectedCompleted);

          // finished iff pending + processing === 0.
          const terminalReached = batch.pending + batch.processing === 0;
          expect(terminalReached).toBe(true);
          expect(batch.status).toBe('finished');
          // completed + failed === total when finished.
          expect(batch.completed + batch.failed).toBe(batch.total);

          // Every failing doc is reported as a batch item failure.
          expect(reportedFailures.length).toBe(expectedFailed);
        }
      ),
      { numRuns: 60 }
    );
  });
});
