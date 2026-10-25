import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Archive,
  ArchiveRestore,
  Share2,
  Sparkles,
  Star,
  Tag,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react';
import type {
  KnowledgeDocument,
  RecommendationState,
  RecommendationTag,
  Scores,
} from '@app/shared';
import { MAX_USER_LABELS_PER_DOC, MAX_USER_LABEL_LENGTH } from '@app/shared';
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
  {
    key: 'mkv',
    label: 'Priority',
    hint: 'Overall priority for you — how much it is worth your attention',
  },
];

export default function DocumentDetailPage() {
  // Route is /app/library/:documentId (registered in App.tsx by the routing agent).
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // Reading the session keeps the shared api client authenticated (Req 8.12);
  // the client attaches the token and handles retry/backoff on its own.
  useAuth();

  const [doc, setDoc] = useState<KnowledgeDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reanalyzing, setReanalyzing] = useState(false);
  const [reanalyzeError, setReanalyzeError] = useState('');
  // In-flight lifecycle (archive/delete) and feedback actions.
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  // Transient confirmation line shown after a thumbs up/down, so the user gets
  // clear visual acknowledgement (the feedback is a learning signal applied to
  // FUTURE analyses, so nothing changes on this doc's score right now).
  const [feedbackNote, setFeedbackNote] = useState('');

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

  // Re-queue this document for a fresh analysis against the CURRENT profile,
  // then poll until the new run lands (status leaves pending/processing).
  const handleReanalyze = async () => {
    if (!documentId || reanalyzing) return;
    setReanalyzing(true);
    setReanalyzeError('');
    try {
      await api.post(`/documents/${documentId}/reanalyze`, {});
      // Poll the document until it finishes re-processing (≤ ~45s).
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const fresh = await api.get<KnowledgeDocument>(`/documents/${documentId}`);
        if (fresh.status !== 'pending' && fresh.status !== 'processing') {
          setDoc(fresh);
          return;
        }
      }
      // Timed out polling — refresh once so the user sees the latest state.
      await load();
    } catch (err) {
      setReanalyzeError((err as Error).message);
    } finally {
      setReanalyzing(false);
    }
  };

  useEffect(() => {
    // Reload whenever the document id in the route changes.
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  // Deep-link action from the email digest's "Archive" link: ?action=archive.
  // Once the doc has loaded, confirm with the user (archiving hides it from the
  // library — reversible, but we never auto-mutate on arrival without a nod),
  // archive it, then strip the param so a refresh doesn't re-trigger.
  useEffect(() => {
    if (searchParams.get('action') !== 'archive') return;
    if (!doc || lifecycleBusy) return;
    const clearParam = () => {
      const next = new URLSearchParams(searchParams);
      next.delete('action');
      setSearchParams(next, { replace: true });
    };
    if (doc.archived) {
      clearParam(); // already archived — nothing to do
      return;
    }
    const title = doc.metadata?.title?.trim() || 'this document';
    if (window.confirm(`Archive “${title}”? It will be hidden from your library.`)) {
      void handleToggleArchive();
    }
    clearParam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, searchParams]);

  // Toggle archived state via PATCH; archiving does not change owner-wide counts.
  // #5: when ARCHIVING (not un-archiving), close the document and go back to the
  // library — the user is done with it. The library restores the scroll position
  // they left from, so they land back where they were, not at the top.
  const handleToggleArchive = async () => {
    if (!documentId || !doc || lifecycleBusy) return;
    const wasArchiving = !doc.archived;
    setLifecycleBusy(true);
    setError('');
    try {
      const updated = await api.patch<KnowledgeDocument>(`/documents/${documentId}`, {
        archived: !doc.archived,
      });
      if (wasArchiving) {
        navigate('/app/library');
        return;
      }
      setDoc(updated);
    } catch (err) {
      setError((err as Error).message || 'Failed to update the document.');
    } finally {
      setLifecycleBusy(false);
    }
  };

  // Toggle starred ("to read / keep") via PATCH; does not change counts.
  const handleToggleStar = async () => {
    if (!documentId || !doc || lifecycleBusy) return;
    setLifecycleBusy(true);
    setError('');
    try {
      const updated = await api.patch<KnowledgeDocument>(`/documents/${documentId}`, {
        starred: !doc.starred,
      });
      setDoc(updated);
    } catch (err) {
      setError((err as Error).message || 'Failed to update the document.');
    } finally {
      setLifecycleBusy(false);
    }
  };

  // Save the user's own labels (free-form organizing). Replaces the whole set.
  const handleSaveLabels = async (labels: string[]) => {
    if (!documentId || !doc) return;
    try {
      const updated = await api.patch<KnowledgeDocument>(`/documents/${documentId}`, {
        userLabels: labels,
      });
      setDoc(updated);
    } catch (err) {
      setError((err as Error).message || 'Failed to update labels.');
    }
  };

  // Hard delete with confirmation; the backend decrements owner-wide counts.
  const handleDelete = async () => {
    if (!documentId || lifecycleBusy) return;
    const ok = window.confirm(
      'This permanently deletes the document. You may re-import it later. Continue?'
    );
    if (!ok) return;
    setLifecycleBusy(true);
    setError('');
    try {
      await api.delete(`/documents/${documentId}`);
      navigate('/app/library');
    } catch (err) {
      setError((err as Error).message || 'Failed to delete the document.');
      setLifecycleBusy(false);
    }
  };

  // Share this recommendation. The library is private per user, so we do NOT
  // share a link into the app — we share a self-contained text snippet (title,
  // verdict, the "why", and the ORIGINAL article URL). Uses the native share
  // sheet on mobile and falls back to copying the text to the clipboard.
  const [shareNote, setShareNote] = useState('');
  const handleShare = async () => {
    if (!doc) return;
    const verdict = doc.degraded ? "Couldn't analyze" : (doc.recommendationState ?? '');
    const why =
      !doc.explanationUnavailable && doc.explanation ? `\n\n${doc.explanation.trim()}` : '';
    const link = doc.canonicalUrl || doc.rawUrl || '';
    const text = `${title}${verdict ? ` — ${verdict}` : ''}${why}\n\n${link}`.trim();

    try {
      if (navigator.share) {
        await navigator.share({ title, text, url: link || undefined });
        return;
      }
      await navigator.clipboard.writeText(text);
      setShareNote('Copied to clipboard');
      setTimeout(() => setShareNote(''), 2500);
    } catch {
      // User cancelled the share sheet, or clipboard was blocked — stay silent
      // for a cancel, show a hint if copying is what failed.
      try {
        await navigator.clipboard.writeText(text);
        setShareNote('Copied to clipboard');
        setTimeout(() => setShareNote(''), 2500);
      } catch {
        setShareNote('Could not share on this device');
        setTimeout(() => setShareNote(''), 2500);
      }
    }
  };

  // Thumbs up/down on the classification. Clicking the active rating again
  // clears it (sends null). Signal only — does not change counts.
  const handleFeedback = async (value: 'up' | 'down') => {
    if (!documentId || !doc || feedbackBusy) return;
    const next = doc.userFeedback === value ? null : value;
    setFeedbackBusy(true);
    try {
      const updated = await api.patch<KnowledgeDocument>(`/documents/${documentId}`, {
        userFeedback: next,
      });
      setDoc(updated);
      setFeedbackNote(
        next === null
          ? 'Feedback cleared.'
          : next === 'up'
            ? 'Thanks — I’ll prioritise more like this in future analyses.'
            : 'Got it — I’ll show you less like this in future analyses.'
      );
    } catch (err) {
      setError((err as Error).message || 'Failed to save your feedback.');
    } finally {
      setFeedbackBusy(false);
    }
  };

  const title = doc?.metadata?.title?.trim() || doc?.canonicalUrl || doc?.rawUrl || 'Document';

  // #7: mobile "swipe back" gesture. A horizontal swipe that starts near the
  // LEFT edge and moves RIGHT is the universal "go back" gesture (iOS Safari and
  // Android both use edge-swipe-right for back; swiping left means "forward").
  // We implement that standard: a clear left→right swipe returns to the library,
  // which restores the scroll position the user left from. Vertical scrolls and
  // small drags are ignored so it never fights normal scrolling.
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchTracking = useRef(false);
  const onPageTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStartX.current = t.clientX;
    touchStartY.current = t.clientY;
    // Only arm the gesture when it begins near the left edge, like the native
    // back-swipe, so a mid-screen horizontal drag never triggers it by accident.
    touchTracking.current = t.clientX <= 48;
  };
  const onPageTouchEnd = (e: React.TouchEvent) => {
    if (!touchTracking.current) return;
    touchTracking.current = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartX.current;
    const dy = t.clientY - touchStartY.current;
    // Mostly-horizontal, rightward, and long enough to be deliberate.
    if (dx > 90 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      navigate('/app/library');
    }
  };

  return (
    <div className="space-y-6" onTouchStart={onPageTouchStart} onTouchEnd={onPageTouchEnd}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link
          to="/app/library"
          className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          ← Back to library
        </Link>
        {doc && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleToggleStar()}
              disabled={lifecycleBusy}
              aria-pressed={doc.starred}
              title={doc.starred ? 'Remove from “to read”' : 'Mark as “to read”'}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                doc.starred
                  ? 'border-amber-300 bg-amber-50 text-amber-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Star className={`h-4 w-4 ${doc.starred ? 'fill-amber-500 text-amber-500' : ''}`} />{' '}
              To read
            </button>
            <button
              type="button"
              onClick={() => void handleShare()}
              title="Share this recommendation"
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              <Share2 className="h-4 w-4" /> Share
            </button>
            <button
              type="button"
              onClick={() => void handleToggleArchive()}
              disabled={lifecycleBusy}
              title={doc.archived ? 'Unarchive this document' : 'Archive this document'}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {doc.archived ? (
                <>
                  <ArchiveRestore className="h-4 w-4" /> Unarchive
                </>
              ) : (
                <>
                  <Archive className="h-4 w-4" /> Archive
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={lifecycleBusy}
              title="Delete this document permanently"
              className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
            <button
              type="button"
              onClick={() => void handleReanalyze()}
              disabled={reanalyzing}
              title="Re-score this document against your current profile"
              className="inline-flex items-center gap-2 rounded-md border border-indigo-200 bg-white px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {reanalyzing ? 'Re-analyzing…' : 'Re-analyze'}
            </button>
          </div>
        )}
      </div>

      {reanalyzing && (
        <p className="rounded-md bg-indigo-50 px-4 py-2 text-sm text-indigo-800">
          Re-analyzing against your current profile — this takes a few seconds.
        </p>
      )}
      {shareNote && (
        <p className="rounded-md bg-gray-100 px-4 py-2 text-sm text-gray-700">{shareNote}</p>
      )}
      {reanalyzeError && (
        <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">
          Couldn&apos;t re-analyze: {reanalyzeError}
        </p>
      )}

      {doc && (
        <LabelEditor labels={doc.userLabels ?? []} onSave={(l) => void handleSaveLabels(l)} />
      )}

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

            {/* Share image (og:image) when the page exposed one. Clicking opens
                the source. Hidden on load error so a dead image leaves no gap. */}
            {doc.metadata?.imageUrl && (
              <a
                href={doc.canonicalUrl || doc.rawUrl}
                target="_blank"
                rel="noreferrer"
                className="block"
              >
                <img
                  src={doc.metadata.imageUrl}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    const el = e.currentTarget.parentElement;
                    if (el) el.style.display = 'none';
                  }}
                  className="max-h-72 w-full rounded-lg border border-gray-200 object-cover"
                />
              </a>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {doc.degraded ? (
                <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-semibold text-gray-600 ring-1 ring-gray-200">
                  Couldn&apos;t analyze
                </span>
              ) : (
                doc.recommendationState && (
                  <span
                    className={`rounded-full px-3 py-1 text-sm font-semibold ring-1 ${
                      STATE_STYLES[doc.recommendationState]
                    }`}
                  >
                    {doc.recommendationState}
                  </span>
                )
              )}
              {/* #4: show the MKV score right next to the verdict badge, so the
                  overall priority is visible as soon as you open a document —
                  not only buried in the "Supporting scores" grid further down. */}
              {!doc.degraded && typeof doc.scores?.mkv === 'number' && (
                <HeaderMkvBadge value={doc.scores.mkv} />
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
          <section className="space-y-3 rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-white">
                <Sparkles className="h-4 w-4" />
              </span>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-indigo-700">
                Why this recommendation
              </h2>
            </div>
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

          {/* Feedback (Level 1 — collect signal only). Lets the user mark
              whether the classification was accurate. */}
          <section className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white px-5 py-3">
            <span className="text-sm font-medium text-gray-700">
              Was this classification helpful?
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleFeedback('up')}
                disabled={feedbackBusy}
                aria-pressed={doc.userFeedback === 'up'}
                title="Yes, this was accurate"
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition disabled:opacity-60 ${
                  doc.userFeedback === 'up'
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                <ThumbsUp className="h-4 w-4" /> Yes
              </button>
              <button
                type="button"
                onClick={() => void handleFeedback('down')}
                disabled={feedbackBusy}
                aria-pressed={doc.userFeedback === 'down'}
                title="No, this was off"
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition disabled:opacity-60 ${
                  doc.userFeedback === 'down'
                    ? 'border-rose-300 bg-rose-50 text-rose-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                <ThumbsDown className="h-4 w-4" /> No
              </button>
            </div>
            {feedbackNote && (
              <span className="text-xs font-medium text-emerald-600" role="status">
                {feedbackNote}
              </span>
            )}
          </section>
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

// Priority (internally MKV — marginal knowledge value, 0-100) as a colored
// pill, shown next to the recommendation verdict in the header. "Priority" is
// the user-facing word; "MKV" is internal. Green = high, amber = medium, gray = low.
function HeaderMkvBadge({ value }: { value: number }) {
  const tone =
    value >= 67
      ? 'bg-green-100 text-green-800 ring-green-200'
      : value >= 34
        ? 'bg-amber-100 text-amber-800 ring-amber-200'
        : 'bg-gray-100 text-gray-600 ring-gray-200';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold ring-1 ${tone}`}
      title="Priority (0–100) — how much this document is worth your attention right now, given what you already know."
    >
      <span className="text-[0.65rem] font-bold uppercase tracking-wide opacity-70">Priority</span>
      {value}
    </span>
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

// Free-form user labels for a document: add with Enter, remove with ×. Saves
// the whole set via PATCH on each change. Caps mirror the shared schema so the
// UI never offers more than the backend accepts.
function LabelEditor({ labels, onSave }: { labels: string[]; onSave: (labels: string[]) => void }) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const value = draft.trim();
    if (!value) return;
    if (value.length > MAX_USER_LABEL_LENGTH) return;
    if (labels.includes(value)) {
      setDraft('');
      return;
    }
    if (labels.length >= MAX_USER_LABELS_PER_DOC) return;
    onSave([...labels, value]);
    setDraft('');
  };

  const remove = (label: string) => onSave(labels.filter((l) => l !== label));

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center gap-2">
        <Tag className="h-4 w-4 text-gray-500" />
        <h2 className="text-sm font-semibold text-gray-800">Your labels</h2>
        <span className="text-xs text-gray-400">
          Organize what deserves your attention — filter by these in the library.
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {labels.map((label) => (
          <span
            key={label}
            className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700"
          >
            {label}
            <button
              type="button"
              onClick={() => remove(label)}
              title={`Remove “${label}”`}
              className="cursor-pointer text-indigo-400 hover:text-indigo-700"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {labels.length < MAX_USER_LABELS_PER_DOC && (
          <input
            type="text"
            value={draft}
            maxLength={MAX_USER_LABEL_LENGTH}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            onBlur={add}
            placeholder={labels.length ? 'Add label…' : 'e.g. AWS SAA-C03'}
            className="min-w-[8rem] flex-1 rounded border border-gray-200 px-2 py-1 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
        )}
      </div>
    </section>
  );
}
