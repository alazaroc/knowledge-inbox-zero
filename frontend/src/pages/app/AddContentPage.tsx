import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Clock,
  Inbox,
  Upload,
  Check,
  CheckCircle2,
  CalendarClock,
  ArrowRight,
  Plus,
  AlertTriangle,
} from 'lucide-react';
import type {
  Batch,
  ImportResult,
  KnowledgeDocument,
  LibraryResponse,
  RecommendationState,
} from '@app/shared';
import { RECOMMENDATION_LABEL, DAILY_IMPORT_LIMIT_USER, ROLES } from '@app/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';

// Poll batch progress no slower than every 5s (Req 8.11, 3.5). 2.5s keeps the
// UI feeling live while staying well under the ceiling.
const POLL_INTERVAL_MS = 2500;

// A batch is terminal when no document is still queued or in flight. The
// backend reports this as status === 'finished', equivalently pending+processing === 0.
const isTerminal = (batch: Batch): boolean =>
  batch.status === 'finished' || batch.pending + batch.processing === 0;

export default function AddContentPage() {
  // Reading the session keeps the shared api client authenticated (Req 8.12);
  // the client itself attaches the token and handles retry/backoff.
  const { user } = useAuth();
  // The daily cap only applies to USER accounts (ADMIN is unlimited), so the
  // preventive "max 100/day" messaging is shown only to regular users.
  const hasDailyLimit = user?.role !== ROLES.ADMIN;

  const [urls, setUrls] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [batch, setBatch] = useState<Batch | null>(null);
  const [createResult, setCreateResult] = useState<ImportResult | null>(null);
  // The analyzed documents from THIS batch, fetched once the batch is terminal
  // so the user sees WHAT was added (verdict, score, type) right here instead
  // of having to open the library and hunt through everything mixed together.
  const [batchDocs, setBatchDocs] = useState<KnowledgeDocument[] | null>(null);
  // Whether the user just copied the blocked URLs (brief "Copied" confirmation).
  const [copiedBlocked, setCopiedBlocked] = useState(false);
  // The user's recent import batches, newest first — shown on the idle screen so
  // Add content isn't an empty box. Uses the existing GET /imports (no backend
  // change). Null until loaded; [] when the user has imported nothing yet.
  const [recentBatches, setRecentBatches] = useState<Batch[] | null>(null);

  // Hidden file input used by the "Import bookmarks (HTML)" button.
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Capture-link entry point: the Settings bookmarklet (and any ?url=/text=
  // link) opens /app/add with the link as query params. Seed the textarea with
  // whatever carries links, then clear the params so a reload doesn't re-seed.
  // The auto-extract on submit pulls the URLs out of `text`.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const shared = [searchParams.get('url'), searchParams.get('text'), searchParams.get('title')]
      .filter(Boolean)
      .join('\n');
    if (shared) {
      setUrls((prev) => (prev ? `${prev}\n${shared}` : shared));
      setNotice('Added the link — press “Add to inbox” to analyze it.');
      // Strip the params so a refresh/back doesn't duplicate the seed.
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Extract every http(s) URL from an arbitrary blob of text, dedupe (keeping
  // order) and return them one per line. Lets the user paste a messy export,
  // a note from another tool, or a list of tabs — not just clean URLs.
  const extractUrls = (text: string): string[] => {
    const re = /https?:\/\/[^\s"'<>)\]]+/gi;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of text.matchAll(re)) {
      const u = m[0].replace(/[.,;]+$/, ''); // trailing punctuation from prose
      if (!seen.has(u)) {
        seen.add(u);
        out.push(u);
      }
    }
    return out;
  };

  // Pull hrefs out of a browser bookmarks export (Netscape bookmark HTML, used
  // by Chrome/Firefox/Safari). Parsed in the browser — no backend parser.
  const parseBookmarksHtml = (html: string): string[] => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const hrefs = Array.from(doc.querySelectorAll('a[href]'))
      .map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? '')
      .filter((h) => /^https?:\/\//i.test(h));
    const seen = new Set<string>();
    return hrefs.filter((h) => (seen.has(h) ? false : (seen.add(h), true)));
  };

  // Merge newly found URLs into the textarea, deduping against what is there.
  const mergeIntoTextarea = (found: string[]) => {
    const existing = urls.split(/\s+/).filter(Boolean);
    const seen = new Set(existing);
    const added: string[] = [];
    for (const u of found) {
      if (!seen.has(u)) {
        seen.add(u);
        added.push(u);
      }
    }
    const next = [...existing, ...added];
    setUrls(next.join('\n'));
    return { added: added.length, total: next.length };
  };

  const onBookmarksFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setError('');
    try {
      const text = await file.text();
      const found = parseBookmarksHtml(text);
      if (found.length === 0) {
        setNotice('No bookmarks found in that file.');
        return;
      }
      const { added, total } = mergeIntoTextarea(found);
      setNotice(`Imported ${added} bookmark${added === 1 ? '' : 's'} (${total} URLs ready).`);
    } catch {
      setError('Could not read that file. Export your bookmarks as HTML and try again.');
    }
  };

  // Hold the interval id so we can clear it on terminal state and on unmount.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  // Clean up any live interval when the component unmounts (Req 8.11).
  useEffect(() => stopPolling, []);

  // Load the recent import batches for the idle screen's "Recent imports" list.
  const loadRecentBatches = async () => {
    try {
      const res = await api.get<{ batches: Batch[] }>('/imports');
      setRecentBatches(res.batches ?? []);
    } catch {
      setRecentBatches([]); // non-fatal: the composer still works
    }
  };
  useEffect(() => {
    void loadRecentBatches();
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setSubmitting(true);
    // Reset any previous run; keep the entered text until we know it was accepted.
    stopPolling();
    setBatch(null);
    setCreateResult(null);
    setBatchDocs(null);

    // Auto-extract: if the box holds arbitrary text (tabs dump, notes, a list
    // from another tool), pull the http(s) URLs out of it automatically — no
    // separate button to press. If no scheme'd URL is found we send the raw
    // text as-is, so hand-typed bare domains (example.com) still work (the
    // backend prepends https://).
    const extracted = extractUrls(urls);
    const payloadUrls = extracted.length > 0 ? extracted.join('\n') : urls;

    try {
      const res = await api.post<ImportResult>('/imports', { urls: payloadUrls });

      // Nothing enqueued AND nothing blocked by quota AND nothing rejected AND
      // nothing reused as a duplicate means the submission carried no valid URL
      // (Req 8.4). A duplicate (the URL already exists in the library) is a
      // LEGITIMATE outcome — the URL was valid, we just already had it — so it
      // must NOT trigger the "no valid URL" error.
      const nothingHappened =
        res.pending === 0 &&
        res.blocked.length === 0 &&
        res.rejected.length === 0 &&
        !res.duplicates;
      if (nothingHappened) {
        setError('At least one valid URL is required.');
        setSubmitting(false);
        return;
      }

      setCreateResult(res);
      setCopiedBlocked(false);
      // Submission processed: safe to clear the textarea. If the limit blocked
      // some URLs, they are preserved in `res.blocked` and shown below so the
      // user can copy and retry tomorrow.
      setUrls('');
      // Only poll when there is actually something in flight.
      if (res.pending > 0) startPolling(res.batchId);
    } catch (err) {
      // Surface backend 400 messages (e.g. empty submission, per-batch cap) verbatim.
      setError((err as Error).message || 'At least one valid URL is required.');
    } finally {
      setSubmitting(false);
    }
  };

  const startPolling = (batchId: string) => {
    const poll = async () => {
      try {
        const b = await api.get<Batch>(`/imports/${batchId}`);
        setBatch(b);
        // Req 8.11: stop polling once the batch reaches a terminal state.
        if (isTerminal(b)) {
          stopPolling();
          // Refresh the recent-imports list so this batch shows as Done.
          void loadRecentBatches();
          // Fetch what was actually analyzed so we can show the per-article
          // results (verdict, score, type) right on this page.
          void loadBatchDocs(batchId);
        }
      } catch (err) {
        // Transient failures are already retried by the api client; surface a
        // persistent failure but keep the last known counts on screen.
        setError((err as Error).message);
      }
    };

    // Fetch immediately so the user sees counts without waiting a full interval,
    // then poll on a fixed cadence.
    void poll();
    pollRef.current = setInterval(() => void poll(), POLL_INTERVAL_MS);
  };

  // Load the analyzed documents belonging to this batch. The library listing is
  // owner-scoped (newest first, up to 100 per page) and each document carries
  // its batchId, so the just-finished batch — bounded by the per-day limit —
  // sits on the first page. We filter client-side by batchId; no backend change.
  const loadBatchDocs = async (batchId: string) => {
    try {
      const res = await api.get<LibraryResponse>(`/documents?batch=${encodeURIComponent(batchId)}`);
      setBatchDocs(res.documents);
    } catch {
      // Non-fatal: the counters and the "See your library" link still work.
      setBatchDocs([]);
    }
  };

  const processing = batch !== null && !isTerminal(batch);

  // Copy the quota-blocked URLs to the clipboard so the user can save and retry.
  const copyBlocked = async () => {
    if (!createResult?.blocked.length) return;
    try {
      await navigator.clipboard.writeText(createResult.blocked.join('\n'));
      setCopiedBlocked(true);
      setTimeout(() => setCopiedBlocked(false), 2000);
    } catch {
      // Clipboard denied (rare) — the list is already visible to copy manually.
    }
  };

  // Derived progress figures, resilient to the first render before the first
  // poll returns (fall back to the create acknowledgement).
  const total = batch?.total ?? createResult?.total ?? 0;
  const completed = batch?.completed ?? 0;
  const failed = batch?.failed ?? 0;
  const done = completed + failed;
  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;

  // This-batch stats, derived from the fetched documents: how the verdicts
  // split (Worth it / Maybe / Skip), how many couldn't be analyzed, and the
  // total estimated reading time across the batch. Shown as a quick summary
  // above the per-article list so the batch has a "shape" at a glance.
  const batchStats = useMemo(() => {
    if (!batchDocs || batchDocs.length === 0) return null;
    const byState: Record<RecommendationState, number> = { READ: 0, SKIM: 0, SKIP: 0 };
    let degraded = 0;
    let readingMinutes = 0;
    for (const d of batchDocs) {
      if (d.degraded) {
        degraded += 1;
        continue;
      }
      if (d.recommendationState) byState[d.recommendationState] += 1;
      if (typeof d.readingMinutes === 'number') readingMinutes += d.readingMinutes;
    }
    return { byState, degraded, readingMinutes, total: batchDocs.length };
  }, [batchDocs]);

  // The just-finished batch id, for linking into the library pre-filtered to it.
  const batchId = batch?.batchId ?? createResult?.batchId;

  // Live count of distinct URLs currently in the textarea, so we can warn the
  // USER BEFORE they submit that they're over the daily cap — rather than only
  // telling them after the hard block. New-vs-duplicate isn't known until the
  // server dedupes, so this is an upper bound; we phrase it as "up to N".
  const pastedUrlCount = useMemo(() => (urls.trim() ? extractUrls(urls).length : 0), [urls]);
  const overDailyLimit = hasDailyLimit && pastedUrlCount > DAILY_IMPORT_LIMIT_USER;

  // Which of the three screens to show: a running batch (analyzing), a finished
  // batch (results), or the idle composer + recent imports.
  const showBatch = createResult !== null;

  return (
    <div className="flex flex-col gap-5">
      {/* Sober header — one line of value, no oversized hero. */}
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Add content</h1>
        <p className="text-sm text-gray-500">
          Paste a pile of links — a clean list, a notes dump, your open tabs. We fetch, de-dupe and
          score each one, then surface the few worth your attention.
        </p>
      </div>

      {/* ── STATE 2/3: a batch is running or has just finished ───────────── */}
      {showBatch && createResult && (
        <>
          {processing ? (
            <AnalyzingCard
              total={total}
              done={done}
              progressPct={progressPct}
              batch={batch}
              createResult={createResult}
              batchDocs={batchDocs}
            />
          ) : (
            <FinishedCard
              completed={completed}
              failed={failed}
              total={total}
              batchStats={batchStats}
              batchDocs={batchDocs}
              batchId={batchId}
            />
          )}

          {/* Cross-cutting outcomes that apply whether running or finished:
              duplicates, deferred (saved for later), hard block, rejected. */}
          {createResult.duplicates ? (
            <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-800">
              {createResult.duplicates} {createResult.duplicates === 1 ? 'link was' : 'links were'}{' '}
              already in your library — reused, not analyzed again.
            </div>
          ) : null}

          {createResult.deferred ? (
            <div className="space-y-1 rounded-md border border-indigo-200 bg-indigo-50 p-4">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-indigo-900">
                <CalendarClock className="h-4 w-4" />
                Daily limit reached — {createResult.deferred} link
                {createResult.deferred === 1 ? '' : 's'} saved for later
              </p>
              <p className="text-sm text-indigo-800">
                You can analyze up to {createResult.dailyLimit} new links per day. We saved the rest
                and will process {createResult.deferred === 1 ? 'it' : 'them'} automatically on the
                next day{createResult.deferred === 1 ? '' : 's'} — you don’t need to add them again.
                We’ll email you when they start.
              </p>
            </div>
          ) : null}

          {createResult.blocked.length > 0 && (
            <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-900">
                {createResult.blocked.length} link
                {createResult.blocked.length === 1 ? '' : 's'} couldn’t be saved
              </p>
              <p className="text-sm text-amber-800">
                Your saved-for-later queue is full, so these couldn’t be stored. Copy and keep them,
                then add them again once your backlog clears.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void copyBlocked()}
                  className="rounded border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
                >
                  {copiedBlocked ? 'Copied ✓' : 'Copy unprocessed links'}
                </button>
              </div>
              <ul className="max-h-48 space-y-0.5 overflow-auto rounded border border-amber-200 bg-white p-2 text-xs text-gray-700">
                {createResult.blocked.map((u, i) => (
                  <li key={`${u}-${i}`} className="font-mono break-all">
                    {u}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {createResult.rejected.length > 0 && (
            <div className="space-y-1 rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-xs font-medium text-gray-700">
                {createResult.rejected.length} line
                {createResult.rejected.length === 1 ? '' : 's'} rejected
              </p>
              <ul className="max-h-40 space-y-0.5 overflow-auto text-xs text-gray-500">
                {createResult.rejected.map((r, i) => (
                  <li key={`${r.line}-${i}`} className="font-mono">
                    {r.line} <span className="text-gray-400">({r.reason})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Keep adding while a batch runs. */}
          {processing && (
            <button
              type="button"
              onClick={() => {
                stopPolling();
                setBatch(null);
                setCreateResult(null);
                setBatchDocs(null);
              }}
              className="self-start text-sm font-medium text-indigo-600 hover:underline"
            >
              + Add more links
            </button>
          )}
        </>
      )}

      {/* ── STATE 1: idle composer + recent imports ──────────────────────── */}
      {!showBatch && (
        <>
          <form onSubmit={onSubmit} className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="urls" className="text-sm font-medium text-gray-700">
                URLs
              </label>
              <span className="text-xs text-gray-400">
                {pastedUrlCount > 0
                  ? `${pastedUrlCount} link${pastedUrlCount === 1 ? '' : 's'} detected`
                  : 'one per line'}
              </span>
            </div>
            <textarea
              id="urls"
              className="min-h-40 w-full rounded-lg border border-gray-200 bg-gray-50/60 p-3 font-mono text-sm focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              placeholder={'https://example.com/article\nhttps://example.com/another'}
            />

            {/* Discreet daily-limit line — NOT a banner. Turns amber only when the
                pasted list already exceeds the cap (preventive, point #3). */}
            {hasDailyLimit &&
              (overDailyLimit ? (
                <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-amber-700">
                  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  You’ve pasted {pastedUrlCount} links. We analyze up to {DAILY_IMPORT_LIMIT_USER}{' '}
                  new links per day — the first {DAILY_IMPORT_LIMIT_USER} go now, the rest are saved
                  and processed automatically the next day. Nothing is lost.
                </p>
              ) : (
                <p className="mt-2 text-xs text-gray-400">
                  Up to {DAILY_IMPORT_LIMIT_USER} new links a day. Over that, we save the rest and
                  process them automatically the next day — nothing is lost.
                </p>
              ))}

            {notice && <p className="mt-2 text-xs text-emerald-600">{notice}</p>}
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                <Inbox className="h-4 w-4" />
                {submitting ? 'Submitting…' : 'Add to inbox'}
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                <Upload className="h-4 w-4" />
                Import bookmarks (HTML)…
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".html,.htm,text/html"
                className="hidden"
                onChange={(e) => void onBookmarksFile(e)}
              />
            </div>
            <p className="mt-2 text-xs text-gray-400">
              Paste anything — a clean list, a messy note, or a dump of open tabs. We pull the links
              out for you. Have a browser bookmarks file? Use “Bookmarks → Export as HTML” and
              import it here.
            </p>
          </form>

          <RecentImports batches={recentBatches} />
        </>
      )}
    </div>
  );
}

// The verdict split + failed + reading time for a batch, derived from its docs.
interface BatchStats {
  byState: Record<RecommendationState, number>;
  degraded: number;
  readingMinutes: number;
  total: number;
}

// One small status chip for a stat during analysis.
function StatChip({
  label,
  value,
  tone = 'gray',
  icon,
}: {
  label: string;
  value: number;
  tone?: 'gray' | 'muted' | 'indigo' | 'emerald' | 'rose';
  icon?: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    gray: 'bg-gray-100 text-gray-600',
    muted: 'bg-gray-100 text-gray-500',
    indigo: 'bg-indigo-50 text-indigo-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    rose: 'bg-rose-50 text-rose-600',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${tones[tone]}`}
    >
      {icon}
      {label} {value}
    </span>
  );
}

// STATE 2 — a batch is analyzing: live progress bar, compact stat chips, and a
// preview of results trickling in (most valuable first). Reuses BatchResultRow.
function AnalyzingCard({
  total,
  done,
  progressPct,
  batch,
  createResult,
  batchDocs,
}: {
  total: number;
  done: number;
  progressPct: number;
  batch: Batch | null;
  createResult: ImportResult;
  batchDocs: KnowledgeDocument[] | null;
}) {
  const preview = batchDocs ? sortBatchDocs(batchDocs).slice(0, 5) : [];
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-indigo-500" />
          </span>
          <h2 className="text-sm font-semibold text-gray-900">Analyzing your batch</h2>
        </div>
        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
          In progress
        </span>
      </div>

      {total > 0 && (
        <>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-gray-500">
            {done} of {total} analyzed…
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <StatChip label="Total" value={total} />
            <StatChip
              label="Processing"
              value={batch?.processing ?? 0}
              tone="indigo"
              icon={<Clock className="h-3 w-3" />}
            />
            <StatChip label="Pending" value={batch?.pending ?? createResult.pending} tone="muted" />
            <StatChip
              label="Done"
              value={batch?.completed ?? 0}
              tone="emerald"
              icon={<Check className="h-3 w-3" />}
            />
            <StatChip label="Failed" value={batch?.failed ?? 0} tone="rose" />
          </div>
        </>
      )}

      <p className="mt-3 text-xs text-gray-400">
        You can leave this page — your library fills in on its own.
      </p>

      {preview.length > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Latest results
          </p>
          <ul className="space-y-1.5">
            {preview.map((d) => (
              <li key={d.documentId}>
                <BatchResultRow doc={d} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// STATE 3 — a batch finished: a success summary with the "shape" of the batch
// (verdict split + reading time + attention saved) plus the ranked results.
function FinishedCard({
  completed,
  failed,
  total,
  batchStats,
  batchDocs,
  batchId,
}: {
  completed: number;
  failed: number;
  total: number;
  batchStats: BatchStats | null;
  batchDocs: KnowledgeDocument[] | null;
  batchId?: string;
}) {
  // "Attention saved" = links the app judged not fully worth reading (SKIM+SKIP),
  // the product's headline metric. Fall back to failed-only when stats are late.
  const saved = batchStats ? batchStats.byState.SKIM + batchStats.byState.SKIP : 0;
  const analyzedLabel = completed > 0 ? completed : total;

  return (
    <>
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <h2 className="text-sm font-semibold text-emerald-900">
              Batch complete — {analyzedLabel} link{analyzedLabel === 1 ? '' : 's'} analyzed
            </h2>
          </div>
          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
            Finished
          </span>
        </div>

        {batchStats && (
          <div className="flex flex-wrap items-center gap-2">
            {(['READ', 'SKIM', 'SKIP'] as const).map((s) =>
              batchStats.byState[s] > 0 ? (
                <span
                  key={s}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${BATCH_STATE_STYLES[s]}`}
                >
                  {batchStats.byState[s]} {RECOMMENDATION_LABEL[s]}
                </span>
              ) : null
            )}
            {batchStats.degraded > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-700">
                {batchStats.degraded} couldn’t analyze
              </span>
            )}
            {batchStats.readingMinutes > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-gray-200">
                <Clock className="h-3 w-3" /> {batchStats.readingMinutes} min of reading triaged
              </span>
            )}
          </div>
        )}

        {saved > 0 && (
          <p className="mt-3 text-sm text-emerald-800">
            We saved you from {saved} link{saved === 1 ? '' : 's'} that weren’t fully worth it. Here
            are the top picks from this batch.
          </p>
        )}
      </div>

      {batchDocs && batchDocs.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="mb-3 text-sm font-semibold text-gray-800">This batch, best first</p>
          <ul className="space-y-1.5">
            {sortBatchDocs(batchDocs).map((d) => (
              <li key={d.documentId}>
                <BatchResultRow doc={d} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {failed > 0 && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          {failed} {failed === 1 ? 'link' : 'links'} couldn’t be analyzed (the page may be
          unreachable, blocked, or not readable). You can retry {failed === 1 ? 'it' : 'them'} from
          your library.
        </div>
      )}

      {completed === 0 && failed === 0 && (
        <div className="rounded-md bg-gray-50 p-3 text-sm text-gray-600">
          Nothing was analyzed. Check the rejected lines below.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Link
          to={batchId ? `/app/library?batch=${encodeURIComponent(batchId)}` : '/app/library'}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          See these in your library <ArrowRight className="h-4 w-4" />
        </Link>
        <Link
          to="/app/add"
          reloadDocument
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <Plus className="h-4 w-4" /> Add more links
        </Link>
      </div>
    </>
  );
}

// Relative "time ago" for the recent-imports list.
function timeAgo(iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// STATE 1 — recent imports list on the idle screen. New feature: it reads the
// user's batches (GET /imports, newest first) so Add content isn't an empty box.
function RecentImports({ batches }: { batches: Batch[] | null }) {
  if (batches === null) {
    // Loading: a couple of skeleton rows that keep the layout stable.
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <p className="mb-3 text-sm font-semibold text-gray-800">Recent imports</p>
        <div className="space-y-2">
          <div className="h-5 w-full animate-pulse rounded bg-gray-100" />
          <div className="h-5 w-2/3 animate-pulse rounded bg-gray-100" />
        </div>
      </div>
    );
  }
  if (batches.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-white p-5 text-center text-sm text-gray-500">
        No imports yet. Paste some links above and they’ll show up here.
      </div>
    );
  }

  const recent = batches.slice(0, 6);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-800">Recent imports</p>
        <Link to="/app/library" className="text-xs font-medium text-indigo-600 hover:underline">
          View library
        </Link>
      </div>
      <ul className="divide-y divide-gray-100 text-sm">
        {recent.map((b) => {
          const running = b.status !== 'finished' && b.pending + b.processing > 0;
          const failed = b.failed ?? 0;
          // Rejected lines (invalid URLs) are a separate, batch-level outcome
          // from pipeline failures; surface both so "Done" never hides a problem.
          const rejected = b.rejected?.length ?? 0;
          const count = b.total;
          return (
            <li key={b.batchId}>
              <Link
                to={`/app/library?batch=${encodeURIComponent(b.batchId)}`}
                className="-mx-2 flex items-center justify-between rounded-md px-2 py-2.5 hover:bg-gray-50"
              >
                <span className="flex items-center gap-2 text-gray-700">
                  <Clock className="h-3.5 w-3.5 text-gray-400" />
                  {timeAgo(b.createdAt)} · {count} link{count === 1 ? '' : 's'}
                  {!running && rejected > 0 && (
                    <span className="text-xs text-gray-400">({rejected} rejected)</span>
                  )}
                </span>
                {running ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                    <Clock className="h-3 w-3" /> Analyzing
                  </span>
                ) : failed > 0 ? (
                  // Finished but some documents couldn't be analyzed. Amber chip
                  // with the count, so a partial failure never reads as a clean
                  // "Done". Newer batches carry this; older ones legitimately
                  // show failed=0 because it wasn't tracked back then.
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                    <AlertTriangle className="h-3 w-3" />
                    {failed} of {count} failed
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                    <Check className="h-3 w-3" /> Done
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Verdict badge colors — mirror the library (READ=green, SKIM=amber, SKIP=slate)
// so the signal reads the same everywhere.
const BATCH_STATE_STYLES: Record<RecommendationState, string> = {
  READ: 'bg-emerald-100 text-emerald-800',
  SKIM: 'bg-amber-100 text-amber-800',
  SKIP: 'bg-slate-200 text-slate-600',
};

const BATCH_ROW_ACCENT: Record<RecommendationState, string> = {
  READ: 'border-l-emerald-500',
  SKIM: 'border-l-amber-500',
  SKIP: 'border-l-slate-400',
};

// Rank the batch results the same way the library does: by MKV desc, with
// documents that couldn't be analyzed sinking to the bottom.
function sortBatchDocs(docs: KnowledgeDocument[]): KnowledgeDocument[] {
  return [...docs].sort((a, b) => {
    const aFailed = Boolean(a.degraded);
    const bFailed = Boolean(b.degraded);
    if (aFailed !== bFailed) return aFailed ? 1 : -1;
    const am = typeof a.scores?.mkv === 'number' ? a.scores.mkv : -1;
    const bm = typeof b.scores?.mkv === 'number' ? b.scores.mkv : -1;
    return bm - am;
  });
}

// One compact result row for a document in the just-finished batch: verdict,
// title, site, reading time and MKV. Links to the full detail page.
function BatchResultRow({ doc }: { doc: KnowledgeDocument }) {
  const failed = Boolean(doc.degraded);
  const state = failed ? null : doc.recommendationState;
  const title = doc.metadata?.title?.trim() || doc.canonicalUrl || doc.rawUrl;
  const domain = doc.metadata?.sourceDomain ?? '';
  const minutes = typeof doc.readingMinutes === 'number' ? doc.readingMinutes : null;
  const mkv = !failed && typeof doc.scores?.mkv === 'number' ? doc.scores.mkv : null;
  const accent = failed
    ? 'border-l-rose-300'
    : state
      ? BATCH_ROW_ACCENT[state]
      : 'border-l-gray-200';

  return (
    <Link
      to={`/app/library/${doc.documentId}`}
      className={`block rounded-md border border-l-4 border-gray-200 bg-white px-3 py-2 transition-colors hover:border-indigo-300 hover:bg-indigo-50/30 ${accent}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-1 text-sm font-medium text-gray-900">{title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-gray-400">
            {domain && <span className="truncate">{domain}</span>}
            {minutes !== null && (
              <span className="inline-flex items-center gap-0.5">
                · <Clock className="h-3 w-3" /> {minutes} min
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {mkv !== null && (
            <span
              className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[0.65rem] font-semibold text-gray-600"
              title="Marginal knowledge value (0–100)"
            >
              {mkv}
            </span>
          )}
          {state ? (
            <span
              className={`rounded-md px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide ${BATCH_STATE_STYLES[state]}`}
            >
              {RECOMMENDATION_LABEL[state]}
            </span>
          ) : (
            <span className="rounded-md bg-rose-100 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-rose-700">
              Failed
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
