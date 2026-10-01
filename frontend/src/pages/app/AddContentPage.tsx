import { useEffect, useRef, useState } from 'react';
import type { Batch, RejectedEntry } from '@app/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';

// Response shape of POST /imports (the create acknowledgement, not the full batch).
interface ImportCreateResponse {
  batchId: string;
  total: number;
  pending: number;
  rejected: RejectedEntry[];
}

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
  useAuth();

  const [urls, setUrls] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [batch, setBatch] = useState<Batch | null>(null);
  const [createResult, setCreateResult] = useState<ImportCreateResponse | null>(null);

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

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    // Reset any previous run; keep the entered text until we know it was accepted.
    stopPolling();
    setBatch(null);
    setCreateResult(null);

    try {
      const res = await api.post<ImportCreateResponse>('/imports', { urls });

      // Req 8.4: a submission with no valid URL is rejected. The backend may
      // 400 outright, or accept the request but create nothing (everything
      // rejected, nothing pending). In both cases keep the text and explain.
      if (res.pending === 0) {
        setError('At least one valid URL is required.');
        setSubmitting(false);
        return;
      }

      setCreateResult(res);
      // Submission accepted: now safe to clear the textarea.
      setUrls('');
      startPolling(res.batchId);
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
        if (isTerminal(b)) stopPolling();
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

  const processing = batch !== null && !isTerminal(batch);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Add content</h1>
        <p className="text-sm text-gray-500">
          Paste the URLs you want analyzed, one per line. We canonicalize and dedupe them, then work
          through them in the background.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
        <div className="space-y-1">
          <label htmlFor="urls" className="block text-sm font-medium text-gray-700">
            URLs
          </label>
          <p className="text-xs text-gray-500">One URL per line. Blank lines are ignored.</p>
          <textarea
            id="urls"
            className="input min-h-40 font-mono"
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            placeholder={'https://example.com/article\nhttps://example.com/another'}
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : 'Add to inbox'}
        </button>
      </form>

      {createResult && (
        <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Batch progress</h2>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                processing ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'
              }`}
            >
              {processing ? 'Processing…' : 'Finished'}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <ProgressStat label="Total" value={batch?.total ?? createResult.total} />
            <ProgressStat label="Pending" value={batch?.pending ?? createResult.pending} />
            <ProgressStat label="Processing" value={batch?.processing ?? 0} />
            <ProgressStat label="Completed" value={batch?.completed ?? 0} />
            <ProgressStat label="Failed" value={batch?.failed ?? 0} />
          </dl>

          {createResult.rejected.length > 0 && (
            <div className="space-y-1">
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
        </div>
      )}
    </div>
  );
}

function ProgressStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-gray-100 bg-gray-50 px-3 py-2 text-center">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-lg font-semibold text-gray-900">{value}</dd>
    </div>
  );
}
