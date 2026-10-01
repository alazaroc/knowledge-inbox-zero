import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
  KnowledgeDocument,
  RecommendationState,
  RecommendationTag,
  Scores,
} from '@app/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';

// Visual treatment for the single recommendation verdict (Req 6.1). The state
// is the one obvious next action, so it gets the most prominent styling.
const STATE_STYLES: Record<RecommendationState, string> = {
  READ: 'bg-green-100 text-green-800 ring-green-200',
  SKIM: 'bg-amber-100 text-amber-800 ring-amber-200',
  SKIP: 'bg-gray-100 text-gray-600 ring-gray-200',
};

// Tags are orthogonal reasons, not actions (OD-1) — rendered as subtle chips.
const TAG_STYLES: Record<RecommendationTag, string> = {
  FRESH: 'bg-sky-50 text-sky-700 ring-sky-200',
  REFERENCE: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  REDUNDANT: 'bg-orange-50 text-orange-700 ring-orange-200',
  OUTDATED: 'bg-rose-50 text-rose-700 ring-rose-200',
};

// The five numeric scores, in the order they tell the story: how relevant,
// how new, how redundant, how fresh, and the overall priority (MKV).
const SCORE_FIELDS: { key: keyof Scores; label: string; hint: string }[] = [
  { key: 'relevance', label: 'Relevance', hint: 'How relevant to you' },
  { key: 'novelty', label: 'Novelty', hint: 'How much is new to you' },
  { key: 'redundancy', label: 'Redundancy', hint: 'Overlap with what you know' },
  { key: 'freshness', label: 'Freshness', hint: 'How recent the content is' },
  { key: 'mkv', label: 'Priority (MKV)', hint: 'Overall marginal knowledge value' },
];

export default function DocumentDetailPage() {
  // Route is /app/library/:documentId (registered in App.tsx by the routing agent).
  const { documentId } = useParams<{ documentId: string }>();
  // Reading the session keeps the shared api client authenticated (Req 8.12);
  // the client attaches the token and handles retry/backoff on its own.
  useAuth();

  const [doc, setDoc] = useState<KnowledgeDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    if (!documentId) {
      setError('No document was specified.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await api.get<KnowledgeDocument>(`/documents/${documentId}`);
      setDoc(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Reload whenever the document id in the route changes.
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  const title = doc?.metadata?.title?.trim() || doc?.canonicalUrl || doc?.rawUrl || 'Document';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link
          to="/app/library"
          className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          ← Back to library
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : error ? (
        <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">We couldn&apos;t load this document. {error}</p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void load()}
              className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Retry
            </button>
            <Link to="/app/library" className="text-sm font-medium text-indigo-600 hover:underline">
              Back to library
            </Link>
          </div>
        </div>
      ) : doc ? (
        <article className="space-y-6">
          {/* Header: title, source link, recommendation state and tags. */}
          <header className="space-y-3">
            <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
              {doc.metadata?.author && <span>{doc.metadata.author}</span>}
              {doc.metadata?.sourceDomain && <span>· {doc.metadata.sourceDomain}</span>}
              {doc.metadata?.publishedAt && (
                <span>· {new Date(doc.metadata.publishedAt).toLocaleDateString()}</span>
              )}
            </div>
            <a
              href={doc.canonicalUrl || doc.rawUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block break-all text-sm text-indigo-600 hover:underline"
            >
              {doc.canonicalUrl || doc.rawUrl}
            </a>

            <div className="flex flex-wrap items-center gap-2">
              {doc.recommendationState && (
                <span
                  className={`rounded-full px-3 py-1 text-sm font-semibold ring-1 ${
                    STATE_STYLES[doc.recommendationState]
                  }`}
                >
                  {doc.recommendationState}
                </span>
              )}
              {doc.tags?.map((tag) => (
                <span
                  key={tag}
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${TAG_STYLES[tag]}`}
                >
                  {tag}
                </span>
              ))}
              {doc.degraded && (
                <span className="rounded-full bg-yellow-50 px-2 py-0.5 text-xs font-medium text-yellow-800 ring-1 ring-yellow-200">
                  Limited analysis
                </span>
              )}
            </div>
          </header>

          {/* PRIMARY output: the written explanation (Req 6.8). It covers why the
              document matters, what is new, the reason for the state, and what
              deserves attention vs. what can be ignored (Req 6.2, 8.9). */}
          <section className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/60 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-indigo-700">
              Why this recommendation
            </h2>
            {doc.explanationUnavailable ? (
              <p className="text-sm text-indigo-900/70">
                We couldn&apos;t generate a written explanation for this document. The scores and
                recommendation below are still based on the analysis.
              </p>
            ) : doc.explanation ? (
              <p className="whitespace-pre-line text-base leading-relaxed text-indigo-950">
                {doc.explanation}
              </p>
            ) : (
              <p className="text-sm text-indigo-900/70">
                No explanation available for this document.
              </p>
            )}
          </section>

          {/* What the content says — summary and key claims from the extraction (Req 8.9). */}
          {doc.extraction && (
            <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-gray-900">What the content says</h2>

              {doc.extraction.summary && (
                <p className="text-sm leading-relaxed text-gray-700">{doc.extraction.summary}</p>
              )}

              {doc.extraction.claims.length > 0 && (
                <div className="space-y-1">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    Key claims
                  </h3>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
                    {doc.extraction.claims.map((claim, i) => (
                      <li key={i}>{claim}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap gap-x-6 gap-y-3 pt-1">
                {doc.extraction.topics.length > 0 && (
                  <TagList label="Topics" values={doc.extraction.topics} />
                )}
                {doc.extraction.concepts.length > 0 && (
                  <TagList label="Concepts" values={doc.extraction.concepts} />
                )}
              </div>

              <dl className="flex flex-wrap gap-x-6 gap-y-1 pt-1 text-xs text-gray-500">
                <div className="flex gap-1">
                  <dt>Difficulty:</dt>
                  <dd className="font-medium text-gray-700">{doc.extraction.difficulty}</dd>
                </div>
                {doc.extraction.truncated && (
                  <div className="text-gray-400">Content was truncated before analysis.</div>
                )}
              </dl>
            </section>
          )}

          {/* SECONDARY supporting detail: the numeric scores (Req 6.8). Rendered
              smaller and below the written explanation. */}
          {doc.scores && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Supporting scores
              </h2>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {SCORE_FIELDS.map((field) => (
                  <ScoreStat
                    key={field.key}
                    label={field.label}
                    hint={field.hint}
                    value={doc.scores?.[field.key] as number | undefined}
                    estimated={
                      field.key === 'freshness' ? doc.scores?.freshnessEstimated : undefined
                    }
                  />
                ))}
              </dl>
            </section>
          )}
        </article>
      ) : (
        <p className="text-sm text-gray-500">Document not found.</p>
      )}
    </div>
  );
}

function TagList({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="space-y-1">
      <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</h3>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => (
          <span key={v} className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
            {v}
          </span>
        ))}
      </div>
    </div>
  );
}

function ScoreStat({
  label,
  hint,
  value,
  estimated,
}: {
  label: string;
  hint: string;
  value?: number;
  estimated?: boolean;
}) {
  return (
    <div className="rounded border border-gray-100 bg-gray-50 px-3 py-2 text-center">
      <dt className="text-xs text-gray-500" title={hint}>
        {label}
      </dt>
      <dd className="text-base font-semibold text-gray-900">
        {typeof value === 'number' ? value : '—'}
        {estimated && <span className="ml-0.5 align-top text-xs text-gray-400">*</span>}
      </dd>
    </div>
  );
}
