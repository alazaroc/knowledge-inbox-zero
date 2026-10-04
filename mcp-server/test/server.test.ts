/**
 * No-network contract + handler tests for the Knowledge Inbox Zero MCP server.
 *
 * Runs with `node --test` against the compiled output (see package.json `test`).
 * It:
 *   1. asserts the three tool names and their input schemas (contract guard),
 *   2. validates each tool's input schema accepts/rejects the right shapes,
 *   3. exercises each handler against a KizApiClient whose `fetchImpl` is a
 *      stub — so no real HTTP happens.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig, ConfigError } from '../src/config.js';
import { KizApiClient, type FetchLike } from '../src/api.js';
import {
  TOOL_DEFINITIONS,
  submitUrlsSchema,
  listRecommendationsSchema,
  explainDocumentSchema,
  handleSubmitUrls,
  handleListRecommendations,
  handleExplainDocument,
} from '../src/tools.js';

// A fetch stub that records the last call and returns a canned JSON response.
function stubFetch(
  status: number,
  jsonBody: unknown
): { fetch: FetchLike; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(jsonBody),
    } as Response;
  }) as unknown as FetchLike;
  return { fetch: fetchImpl, calls };
}

function clientWith(fetchImpl: FetchLike): KizApiClient {
  return new KizApiClient({
    baseUrl: 'https://example.test',
    getIdToken: () => 'test-id-token',
    fetchImpl,
  });
}

// ── 1. Contract: three tools with the expected names + schemas ───────────────

test('exposes exactly the three expected tools', () => {
  const names = TOOL_DEFINITIONS.map((t) => t.name).sort();
  assert.deepEqual(names, ['explain_document', 'list_recommendations', 'submit_urls']);
});

test('every tool has a non-empty description and a zod input schema', () => {
  for (const def of TOOL_DEFINITIONS) {
    assert.ok(def.description.length > 10, `${def.name} needs a description`);
    assert.ok(def.inputSchema && typeof def.inputSchema === 'object', `${def.name} inputSchema`);
    assert.equal(typeof def.handler, 'function', `${def.name} handler`);
    // schema parses an object
    assert.equal(typeof def.schema.safeParse, 'function');
  }
});

// ── 2. Input schema validation ───────────────────────────────────────────────

test('submit_urls schema accepts valid URLs and rejects bad input', () => {
  assert.equal(submitUrlsSchema.safeParse({ urls: ['https://a.test'] }).success, true);
  assert.equal(submitUrlsSchema.safeParse({ urls: [] }).success, false); // min 1
  assert.equal(submitUrlsSchema.safeParse({ urls: ['not a url'] }).success, false);
  assert.equal(submitUrlsSchema.safeParse({}).success, false);
});

test('list_recommendations schema allows optional state only from the enum', () => {
  assert.equal(listRecommendationsSchema.safeParse({}).success, true);
  assert.equal(listRecommendationsSchema.safeParse({ state: 'READ' }).success, true);
  assert.equal(listRecommendationsSchema.safeParse({ state: 'NOPE' }).success, false);
});

test('explain_document schema requires a non-empty documentId', () => {
  assert.equal(explainDocumentSchema.safeParse({ documentId: 'abc' }).success, true);
  assert.equal(explainDocumentSchema.safeParse({ documentId: '' }).success, false);
  assert.equal(explainDocumentSchema.safeParse({}).success, false);
});

// ── 3. Handlers against a mocked client (no network) ─────────────────────────

test('handleSubmitUrls POSTs to /imports with newline-joined urls', async () => {
  const { fetch, calls } = stubFetch(201, {
    batchId: 'b1',
    total: 2,
    pending: 2,
    rejected: [],
    duplicates: 0,
    blocked: [],
  });
  const res = await handleSubmitUrls(clientWith(fetch), {
    urls: ['https://a.test', 'https://b.test'],
  });
  // request shape
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.test/imports');
  assert.equal(calls[0].init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    urls: 'https://a.test\nhttps://b.test',
  });
  // auth header forwarded
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'test-id-token');
  // result
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.batchId, 'b1');
  assert.equal(parsed.pending, 2);
});

test('handleListRecommendations GETs /documents and summarizes docs', async () => {
  const { fetch, calls } = stubFetch(200, {
    counts: { READ: 1, SKIM: 0, SKIP: 0, total: 1 },
    documents: [
      {
        documentId: 'd1',
        rawUrl: 'https://a.test',
        canonicalUrl: 'https://a.test/',
        status: 'completed',
        recommendationState: 'READ',
        scores: { relevance: 80, novelty: 70, redundancy: 10, freshness: 60, mkv: 72 },
        metadata: { title: 'Great article' },
      },
    ],
  });
  const res = await handleListRecommendations(clientWith(fetch), { state: 'READ' });
  assert.equal(calls[0].url, 'https://example.test/documents?state=READ');
  assert.equal(calls[0].init?.method, 'GET');
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.documents[0].documentId, 'd1');
  assert.equal(parsed.documents[0].mkv, 72);
  assert.equal(parsed.documents[0].state, 'READ');
  assert.equal(parsed.documents[0].title, 'Great article');
});

test('handleListRecommendations without state omits the query param', async () => {
  const { fetch, calls } = stubFetch(200, { counts: { total: 0 }, documents: [] });
  await handleListRecommendations(clientWith(fetch), {});
  assert.equal(calls[0].url, 'https://example.test/documents');
});

test('handleExplainDocument GETs /documents/{id} and returns explanation + scores', async () => {
  const { fetch, calls } = stubFetch(200, {
    documentId: 'd1',
    rawUrl: 'https://a.test',
    canonicalUrl: 'https://a.test/',
    status: 'completed',
    recommendationState: 'SKIM',
    scores: { relevance: 50, novelty: 40, redundancy: 30, freshness: 20, mkv: 41 },
    explanation: 'Mostly things you already know; skim the last section.',
    metadata: { title: 'Known topic' },
  });
  const res = await handleExplainDocument(clientWith(fetch), { documentId: 'd1' });
  assert.equal(calls[0].url, 'https://example.test/documents/d1');
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.state, 'SKIM');
  assert.equal(parsed.scores.mkv, 41);
  assert.match(parsed.explanation, /skim the last section/);
});

test('a non-2xx API response throws an ApiError carrying the status', async () => {
  const { fetch } = stubFetch(401, { message: 'Unauthorized' });
  await assert.rejects(
    () => handleExplainDocument(clientWith(fetch), { documentId: 'd1' }),
    (err) => {
      assert.equal(err instanceof Error, true);
      assert.match(String((err as Error).message), /401/);
      return true;
    }
  );
});

// ── 4. Config resolution (pure, env-driven) ──────────────────────────────────

test('loadConfig requires KIZ_API_URL', () => {
  assert.throws(() => loadConfig({}), ConfigError);
});

test('loadConfig accepts id-token mode', () => {
  const cfg = loadConfig({ KIZ_API_URL: 'https://api.test', KIZ_ID_TOKEN: 'tok' });
  assert.equal(cfg.auth.kind, 'id-token');
  assert.equal(cfg.apiUrl, 'https://api.test');
});

test('loadConfig accepts password mode with a client id', () => {
  const cfg = loadConfig({
    KIZ_API_URL: 'https://api.test/',
    KIZ_EMAIL: 'u@test',
    KIZ_PASSWORD: 'pw',
    KIZ_COGNITO_CLIENT_ID: 'client123',
  });
  assert.equal(cfg.auth.kind, 'password');
  assert.equal(cfg.apiUrl, 'https://api.test'); // trailing slash stripped
});

test('loadConfig rejects password mode without a client id', () => {
  assert.throws(
    () => loadConfig({ KIZ_API_URL: 'https://api.test', KIZ_EMAIL: 'u@test', KIZ_PASSWORD: 'pw' }),
    ConfigError
  );
});

test('loadConfig rejects when no auth is provided', () => {
  assert.throws(() => loadConfig({ KIZ_API_URL: 'https://api.test' }), ConfigError);
});
