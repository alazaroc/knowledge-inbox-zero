/**
 * The three Knowledge Inbox Zero MCP tools.
 *
 * Each tool is a thin wrapper over a single deployed API endpoint — this server
 * never scores or classifies anything itself. Input is validated with zod; the
 * schemas and handlers are exported so a unit test can assert the contract and
 * exercise the handlers against a mocked client (no network).
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { KizApiClient, KnowledgeDocument } from './api.js';

export const RECOMMENDATION_STATES = ['READ', 'SKIM', 'SKIP'] as const;

// ── Input schemas (also the source of truth for the tool contract) ───────────

export const submitUrlsInput = {
  urls: z
    .array(z.string().url('Each entry must be a valid URL'))
    .min(1, 'Provide at least one URL')
    .max(500, 'At most 500 URLs per submission'),
} as const;

export const listRecommendationsInput = {
  state: z.enum(RECOMMENDATION_STATES).optional(),
} as const;

export const explainDocumentInput = {
  documentId: z.string().min(1, 'documentId is required'),
} as const;

export const submitUrlsSchema = z.object(submitUrlsInput);
export const listRecommendationsSchema = z.object(listRecommendationsInput);
export const explainDocumentSchema = z.object(explainDocumentInput);

/** A text-only MCP tool result. */
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

function text(obj: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }],
  };
}

/** One compact line summarizing a document for `list_recommendations`. */
function summarizeDocument(doc: KnowledgeDocument): Record<string, unknown> {
  const title = doc.metadata?.title ?? doc.canonicalUrl ?? doc.rawUrl;
  return {
    documentId: doc.documentId,
    state: doc.recommendationState ?? null,
    mkv: doc.scores?.mkv ?? null,
    title,
    url: doc.canonicalUrl ?? doc.rawUrl,
    status: doc.status,
  };
}

// ── Handlers (pure wrappers over the API client) ─────────────────────────────

export async function handleSubmitUrls(
  client: KizApiClient,
  args: z.infer<typeof submitUrlsSchema>
): Promise<ToolResult> {
  const result = await client.submitUrls(args.urls);
  return text({
    batchId: result.batchId,
    total: result.total,
    pending: result.pending,
    duplicates: result.duplicates ?? 0,
    blocked: result.blocked ?? [],
    rejected: result.rejected ?? [],
  });
}

export async function handleListRecommendations(
  client: KizApiClient,
  args: z.infer<typeof listRecommendationsSchema>
): Promise<ToolResult> {
  const library = await client.listDocuments(args.state);
  return text({
    counts: library.counts,
    documents: (library.documents ?? []).map(summarizeDocument),
    nextCursor: library.nextCursor ?? null,
  });
}

export async function handleExplainDocument(
  client: KizApiClient,
  args: z.infer<typeof explainDocumentSchema>
): Promise<ToolResult> {
  const doc = await client.getDocument(args.documentId);
  return text({
    documentId: doc.documentId,
    state: doc.recommendationState ?? null,
    scores: doc.scores ?? null,
    explanation: doc.explanationUnavailable
      ? 'Explanation unavailable for this document.'
      : (doc.explanation ?? null),
    title: doc.metadata?.title ?? null,
    url: doc.canonicalUrl ?? doc.rawUrl,
    status: doc.status,
  });
}

/** Static metadata for every tool — reused by the server and by tests. */
export const TOOL_DEFINITIONS = [
  {
    name: 'submit_urls',
    title: 'Submit URLs to Knowledge Inbox Zero',
    description:
      "Send one or more URLs to the user's Knowledge Inbox Zero for analysis. " +
      'Maps to POST /imports. Returns the created batch summary (batchId, pending, ' +
      'total, duplicates, blocked, rejected). Analysis is asynchronous.',
    inputSchema: submitUrlsInput,
    schema: submitUrlsSchema,
    handler: handleSubmitUrls,
  },
  {
    name: 'list_recommendations',
    title: 'List Knowledge Inbox Zero recommendations',
    description:
      'List the analyzed documents with their recommendation state (READ/SKIM/SKIP), ' +
      'MKV score, and title/url. Optionally filter by state. Maps to GET /documents.',
    inputSchema: listRecommendationsInput,
    schema: listRecommendationsSchema,
    handler: handleListRecommendations,
  },
  {
    name: 'explain_document',
    title: 'Explain a Knowledge Inbox Zero document',
    description:
      'Fetch the full recommendation for one document: the written LLM explanation, ' +
      'the scores, and the state. Maps to GET /documents/{documentId}.',
    inputSchema: explainDocumentInput,
    schema: explainDocumentSchema,
    handler: handleExplainDocument,
  },
] as const;

export type ToolName = (typeof TOOL_DEFINITIONS)[number]['name'];

/** Wrap a handler so any thrown error becomes a readable MCP tool error. */
function safe<A>(fn: (client: KizApiClient, args: A) => Promise<ToolResult>, client: KizApiClient) {
  return async (args: A): Promise<ToolResult> => {
    try {
      return await fn(client, args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
    }
  };
}

/** Register all three tools on an McpServer bound to the given API client. */
export function registerTools(server: McpServer, client: KizApiClient): void {
  for (const def of TOOL_DEFINITIONS) {
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.inputSchema,
      },
      // The SDK validates args against inputSchema before calling us; the cast
      // keeps the shared handler signatures while satisfying each tool's shape.
      safe(def.handler as never, client) as never
    );
  }
}
