/**
 * Thin HTTP client for the deployed Knowledge Inbox Zero API.
 *
 * This client does NOT re-implement any scoring, extraction, or recommendation
 * logic — all of that lives in the deployed backend. It only:
 *   - POST /imports           submit URLs
 *   - GET  /documents         list recommendations (optional ?state=)
 *   - GET  /documents/{id}    fetch one document's full detail
 *
 * `fetchImpl` is injectable so unit tests can exercise the client without a
 * network (the server passes the global `fetch`).
 */

export type FetchLike = typeof fetch;

/** Minimal shapes mirrored from `@app/shared` (kept local so this server runs standalone). */
export interface Scores {
  relevance: number;
  novelty: number;
  redundancy: number;
  freshness: number;
  mkv: number;
}

export interface KnowledgeDocument {
  documentId: string;
  rawUrl: string;
  canonicalUrl: string;
  status: string;
  recommendationState?: 'READ' | 'SKIM' | 'SKIP';
  scores?: Scores;
  explanation?: string;
  explanationUnavailable?: boolean;
  metadata?: { title?: string };
  [key: string]: unknown;
}

export interface ImportResult {
  batchId: string;
  total: number;
  pending: number;
  rejected: Array<{ line: string; reason: string }>;
  blocked?: string[];
  duplicates?: number;
  [key: string]: unknown;
}

export interface LibraryResponse {
  documents: KnowledgeDocument[];
  counts: Record<string, number>;
  nextCursor?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`API request failed (${status}): ${truncate(body, 500)}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export interface KizApiClientOptions {
  baseUrl: string;
  /** A function returning the current Cognito id token (sent as `Authorization`). */
  getIdToken: () => string;
  /**
   * Optional: obtain a FRESH id token when the current one is rejected (401).
   * Returns whether a renewal was actually possible. When omitted, or when it
   * reports `renewable: false`, a 401 is surfaced as an {@link ApiError} with a
   * readable hint instead of being retried.
   */
  renewToken?: () => Promise<{ renewed: boolean; renewable: boolean }>;
  fetchImpl?: FetchLike;
}

export class KizApiClient {
  private readonly baseUrl: string;
  private readonly getIdToken: () => string;
  private readonly renewToken?: () => Promise<{ renewed: boolean; renewable: boolean }>;
  private readonly fetchImpl: FetchLike;

  constructor(opts: KizApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.getIdToken = opts.getIdToken;
    this.renewToken = opts.renewToken;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** POST /imports — submit newline-joined URLs for analysis. */
  async submitUrls(urls: string[]): Promise<ImportResult> {
    const body = JSON.stringify({ urls: urls.join('\n') });
    return this.request<ImportResult>('POST', '/imports', body);
  }

  /** GET /documents[?state=] — list the caller's analyzed documents. */
  async listDocuments(state?: 'READ' | 'SKIM' | 'SKIP'): Promise<LibraryResponse> {
    const path = state ? `/documents?state=${encodeURIComponent(state)}` : '/documents';
    return this.request<LibraryResponse>('GET', path);
  }

  /** GET /documents/{documentId} — fetch one document's full detail. */
  async getDocument(documentId: string): Promise<KnowledgeDocument> {
    return this.request<KnowledgeDocument>('GET', `/documents/${encodeURIComponent(documentId)}`);
  }

  private async request<T>(method: string, path: string, body?: string): Promise<T> {
    // First attempt with the current token. On a 401 (expired/invalid token),
    // renew ONCE and retry — this is what keeps a long-running MCP session
    // alive past the Cognito id-token's ~1h lifetime without a restart.
    let res = await this.send(method, path, body);

    if (res.status === 401 && this.renewToken) {
      const { renewable } = await this.renewToken();
      if (renewable) {
        res = await this.send(method, path, body);
      }
    }

    const text = await res.text();
    if (!res.ok) {
      if (res.status === 401) {
        throw new ApiError(
          res.status,
          `${text}\nAuthentication failed. The Cognito id token is expired or invalid` +
            (this.renewToken
              ? ' and could not be renewed (id-token mode cannot refresh — use KIZ_EMAIL/KIZ_PASSWORD so the server can re-mint tokens).'
              : '. Provide fresh credentials (KIZ_EMAIL/KIZ_PASSWORD) so the server can renew automatically.')
        );
      }
      throw new ApiError(res.status, text);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** One raw HTTP attempt with the current token attached. */
  private async send(method: string, path: string, body?: string): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.getIdToken()}`,
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return this.fetchImpl(`${this.baseUrl}${path}`, { method, headers, body });
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
