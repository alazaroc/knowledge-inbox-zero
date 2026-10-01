/**
 * Task 6.8 — Integration test for resilience + batch finish.
 *
 * Requirements: 3.6 (a failed document does not stop the batch), 3.8 (batch
 * finishes once no work remains), 3.10 (all-failed batch still finishes),
 * NFR-5 (resilient degradation).
 *
 * Uses the same stateful in-memory DynamoDB as task 6.6 so a real multi-doc
 * batch is driven end-to-end through the worker.
 */
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
const OWNER = 'owner-r';

function resetStore() {
  store.batches.clear();
  store.documents.clear();
  store.profiles.clear();
  store.counts.clear();
}

function seedBatch(batchId: string, urls: string[]) {
  store.batches.set(batchId, makeBatch(batchId, OWNER, urls.length));
  store.profiles.set(OWNER, emptyProfile(OWNER));
  return urls.map((url, i) => {
    const documentId = `${batchId}-doc-${i}`;
    store.documents.set(documentId, makeDocument(documentId, OWNER, batchId, url));
    return { documentId, batchId, ownerId: OWNER };
  });
}

const GOOD_RETRIEVE = {
  text: 'readable content',
  html: '<html>readable content</html>',
  metadata: { sourceDomain: 'example.com', publishedAt: '2024-01-01T00:00:00.000Z' },
  degraded: false,
};

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
    'This explanation is comfortably longer than the fifty character minimum requirement.'
  );
});

describe('worker resilience — a failed document does not stop the batch (Req 3.6, 3.8, NFR-5)', () => {
  it('completes the healthy documents, fails the bad one, and finishes the batch', async () => {
    const BATCH = 'batch-mixed';
    const urls = [
      'https://example.com/good-0',
      'https://example.com/bad-1',
      'https://example.com/good-2',
    ];
    const messages = seedBatch(BATCH, urls);

    retrieveReadable.mockImplementation((url: string) => {
      if (url.includes('bad')) throw new Error('forced retrieve failure');
      return Promise.resolve(GOOD_RETRIEVE);
    });

    const res = await handler(sqsEvent(messages));

    const batch = store.batches.get(BATCH)!;
    assertCounterInvariant(batch);
    expect(batch.total).toBe(3);
    expect(batch.completed).toBe(2);
    expect(batch.failed).toBe(1);
    expect(batch.pending).toBe(0);
    expect(batch.processing).toBe(0);
    expect(batch.status).toBe('finished');

    // Healthy docs completed; bad doc marked failed with a reason.
    expect(store.documents.get(`${BATCH}-doc-0`)!.status).toBe('completed');
    expect(store.documents.get(`${BATCH}-doc-2`)!.status).toBe('completed');
    const bad = store.documents.get(`${BATCH}-doc-1`)!;
    expect(bad.status).toBe('failed');
    expect(bad.failureReason).toBeTruthy();

    // The failed record is reported for SQS redrive; the healthy ones are not.
    expect(res.batchItemFailures).toHaveLength(1);
    expect(res.batchItemFailures[0].itemIdentifier).toBe('msg-1-batch-mixed-doc-1');
  });

  it('still finishes when the failure is a Bedrock extraction + explanation outage', async () => {
    const BATCH = 'batch-bedrock';
    const messages = seedBatch(BATCH, ['https://example.com/a', 'https://example.com/b']);

    retrieveReadable.mockResolvedValue(GOOD_RETRIEVE);
    // Extraction fails → degraded (not a hard failure); explanation also fails
    // → placeholder. The document still COMPLETES (degraded completion, Req 4.5),
    // so the batch finishes with both completed.
    bedrockExtract.mockRejectedValue(new Error('bedrock down'));
    bedrockExplain.mockRejectedValue(new Error('bedrock down'));

    const res = await handler(sqsEvent(messages));

    const batch = store.batches.get(BATCH)!;
    assertCounterInvariant(batch);
    expect(batch.completed).toBe(2);
    expect(batch.failed).toBe(0);
    expect(batch.status).toBe('finished');
    expect(res.batchItemFailures).toHaveLength(0);

    for (const m of messages) {
      const doc = store.documents.get(m.documentId)!;
      expect(doc.status).toBe('completed');
      expect(doc.degraded).toBe(true);
      expect(doc.explanationUnavailable).toBe(true);
      expect(doc.recommendationState).toBeDefined();
    }
  });
});

describe('worker resilience — all-failed batch still finishes (Req 3.10)', () => {
  it('reaches finished with failed === total when every document fails', async () => {
    const BATCH = 'batch-all-fail';
    const messages = seedBatch(BATCH, [
      'https://example.com/x',
      'https://example.com/y',
      'https://example.com/z',
    ]);

    retrieveReadable.mockImplementation(() => {
      throw new Error('every document fails');
    });

    const res = await handler(sqsEvent(messages));

    const batch = store.batches.get(BATCH)!;
    assertCounterInvariant(batch);
    expect(batch.total).toBe(3);
    expect(batch.failed).toBe(3);
    expect(batch.completed).toBe(0);
    expect(batch.pending).toBe(0);
    expect(batch.processing).toBe(0);
    expect(batch.status).toBe('finished');

    expect(res.batchItemFailures).toHaveLength(3);
    for (const m of messages) {
      expect(store.documents.get(m.documentId)!.status).toBe('failed');
    }
  });

  it('finishes an all-failed batch split across multiple SQS invocations', async () => {
    const BATCH = 'batch-all-fail-split';
    const messages = seedBatch(BATCH, [
      'https://example.com/1',
      'https://example.com/2',
      'https://example.com/3',
      'https://example.com/4',
    ]);

    retrieveReadable.mockImplementation(() => {
      throw new Error('all fail');
    });

    const batch = store.batches.get(BATCH)!;
    for (let i = 0; i < messages.length; i += 2) {
      const res = await handler(sqsEvent(messages.slice(i, i + 2)));
      assertCounterInvariant(batch);
      expect(res.batchItemFailures).toHaveLength(2);
    }

    expect(batch.failed).toBe(4);
    expect(batch.status).toBe('finished');
  });
});
