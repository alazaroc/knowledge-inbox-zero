import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { KnowledgeDocument, LibraryResponse, RecommendationState } from '@app/shared';
import { RECOMMENDATION_STATE } from '@app/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';

// The filter tabs: "All" plus one per recommendation state. The active filter
// drives the ?state= query param (Req 8.5).
type Filter = 'ALL' | RecommendationState;
const FILTERS: Filter[] = ['ALL', ...RECOMMENDATION_STATE];

// Visual treatment per state. READ deserves attention; SKIP is attention saved.
const STATE_STYLES: Record<RecommendationState, { badge: string; label: string }> = {
  READ: { badge: 'bg-green-100 text-green-800', label: 'Read' },
  SKIM: { badge: 'bg-amber-100 text-amber-800', label: 'Skim' },
  SKIP: { badge: 'bg-gray-200 text-gray-700', label: 'Skip' },
};

function buildPath(filter: Filter, cursor?: string): string {
  const params = new URLSearchParams();
  if (filter !== 'ALL') params.set('state', filter);
  if (cursor) params.set('cursor', cursor);
  const qs = params.toString();
  return qs ? `/documents?${qs}` : '/documents';
}

export default function LibraryPage() {
  // Reading the session keeps the shared api client authenticated (Req 8.12);
  // the client itself attaches the token and handles retry/backoff.
  useAuth();

  const [filter, setFilter] = useState<Filter>('ALL');
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [counts, setCounts] = useState<LibraryResponse['counts'] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  // Fetch the first page for the current filter. The shared api client exhausts
  // its own retries/backoff before throwing (Req 8.12); a throw here is terminal
  // and surfaces the error + retry control (Req 8.8).
  const load = async (f: Filter) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<LibraryResponse>(buildPath(f));
      setDocuments(res.documents);
      setCounts(res.counts);
      setNextCursor(res.nextCursor);
    } catch (err) {
      setError((err as Error).message || 'Failed to load your library.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Re-fetch whenever the active filter changes.
    void load(filter);
  }, [filter]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    setError('');
    try {
      const res = await api.get<LibraryResponse>(buildPath(filter, nextCursor));
      setDocuments((prev) => [...prev, ...res.documents]);
      setCounts(res.counts);
      setNextCursor(res.nextCursor);
    } catch (err) {
      setError((err as Error).message || 'Failed to load more documents.');
    } finally {
      setLoadingMore(false);
    }
  };

  // Attention saved: documents the app judged do NOT deserve attention. SKIP is
  // the core signal; SKIM is partial. Surfaced as the primary success metric
  // rather than total stored (Req 8.10).
  const total = counts?.total ?? 0;
  const attentionSaved = counts ? counts.SKIP + counts.SKIM : 0;
  const savedPct = total > 0 ? Math.round((attentionSaved / total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Library</h1>
        <p className="text-sm text-gray-500">
          Your analyzed documents, grouped by what deserves your attention.
        </p>
      </div>

      {loading ? (
        // Req 8.7: loading indicator while fetching.
        <p className="text-sm text-gray-500">Loading your library…</p>
      ) : error ? (
        // Req 8.8: error message + retry control after the client's retries are exhausted.
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
          <button
            onClick={() => void load(filter)}
            className="mt-3 rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      ) : total === 0 ? (
        // Req 8.6: empty state, and do NOT render any per-state document list.
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center">
          <p className="text-sm font-medium text-gray-900">No documents yet</p>
          <p className="mt-1 text-sm text-gray-500">
            Once you add content and we analyze it, your library will appear here.
          </p>
          <Link
            to="/app/add"
            className="mt-4 inline-block rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Add content
          </Link>
        </div>
      ) : (
        <>
          {/* Req 8.10: attention saved, prominent and on top. */}
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-6">
            <p className="text-sm font-medium uppercase tracking-wide text-indigo-700">
              Attention saved
            </p>
            <p className="mt-1 text-4xl font-bold text-indigo-900">
              {attentionSaved}
              <span className="text-xl font-semibold text-indigo-500"> / {total}</span>
            </p>
            <p className="mt-1 text-sm text-indigo-700">
              You saved attention on {attentionSaved} of {total} document
              {total === 1 ? '' : 's'} ({savedPct}%) that didn&apos;t deserve it.
            </p>
          </div>

          {/* Req 8.5: filter controls per state + "All", each with its count. */}
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => {
              const label = f === 'ALL' ? 'All' : STATE_STYLES[f].label;
              const count = f === 'ALL' ? counts!.total : counts![f];
              const active = f === filter;
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  aria-pressed={active}
                  className={`rounded-full px-3 py-1 text-sm font-medium transition ${
                    active
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {label}{' '}
                  <span className={active ? 'text-indigo-100' : 'text-gray-400'}>({count})</span>
                </button>
              );
            })}
          </div>

          {documents.length === 0 ? (
            <p className="text-sm text-gray-500">No documents in this group.</p>
          ) : (
            <ul className="space-y-2">
              {documents.map((doc) => (
                <li key={doc.documentId}>
                  <DocumentRow doc={doc} />
                </li>
              ))}
            </ul>
          )}

          {nextCursor && (
            <div className="flex justify-center">
              <button
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="rounded border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DocumentRow({ doc }: { doc: KnowledgeDocument }) {
  const title = doc.metadata?.title?.trim() || doc.canonicalUrl || doc.rawUrl;
  const state = doc.recommendationState;
  return (
    <Link
      to={`/app/library/${doc.documentId}`}
      className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:bg-indigo-50/30"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-900">{title}</p>
        <p className="truncate text-xs text-gray-500">
          {doc.metadata?.sourceDomain ?? doc.canonicalUrl}
        </p>
        {doc.explanation && (
          <p className="mt-1 line-clamp-2 text-xs text-gray-600">{doc.explanation}</p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {state && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_STYLES[state].badge}`}
          >
            {STATE_STYLES[state].label}
          </span>
        )}
        {typeof doc.scores?.mkv === 'number' && (
          <span className="text-xs text-gray-400">MKV {doc.scores.mkv}</span>
        )}
      </div>
    </Link>
  );
}
