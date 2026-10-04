import { useState } from 'react';
import { sendUserAttributeVerificationCode, confirmUserAttribute } from 'aws-amplify/auth';
import { MailWarning, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

// Non-blocking "verify your email" banner. Users sign up and enter the app
// immediately (the pre-signup trigger auto-confirms the account), so their
// email is NOT verified yet. This banner lets them verify in place — send a
// code, enter it — without ever gating access to the app.
export default function VerifyEmailBanner() {
  const { user, refresh } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'sent'>('idle');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Nothing to do when there is no user, the email is already verified, or the
  // user dismissed the banner for this session.
  if (!user || user.emailVerified || dismissed) return null;

  const sendCode = async () => {
    setError('');
    setLoading(true);
    try {
      await sendUserAttributeVerificationCode({ userAttributeKey: 'email' });
      setPhase('sent');
    } catch (err) {
      setError((err as Error).message || 'Could not send the code. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await confirmUserAttribute({ userAttributeKey: 'email', confirmationCode: code.trim() });
      // Refresh the session so the new email_verified claim lands and the
      // banner disappears on its own.
      await refresh();
    } catch (err) {
      setError((err as Error).message || 'That code did not work. Request a new one.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border-b border-amber-200 bg-amber-50">
      <div className="app-shell-width flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-sm text-amber-900 sm:px-6">
        <span className="inline-flex items-center gap-2 font-medium">
          <MailWarning className="h-4 w-4 shrink-0" />
          Verify your email to secure your account.
        </span>

        {phase === 'idle' ? (
          <button
            type="button"
            onClick={() => void sendCode()}
            disabled={loading}
            className="rounded border border-amber-300 bg-white px-3 py-1 font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
          >
            {loading ? 'Sending…' : 'Send verification code'}
          </button>
        ) : (
          <form onSubmit={confirm} className="flex flex-wrap items-center gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\s/g, ''))}
              placeholder="Code from email"
              inputMode="numeric"
              required
              className="w-36 rounded border border-amber-300 bg-white px-2 py-1 text-sm tracking-widest text-gray-900 focus:border-amber-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded bg-amber-600 px-3 py-1 font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {loading ? 'Verifying…' : 'Verify'}
            </button>
            <button
              type="button"
              onClick={() => void sendCode()}
              disabled={loading}
              className="text-xs font-medium text-amber-700 underline hover:text-amber-900 disabled:opacity-50"
            >
              Resend
            </button>
          </form>
        )}

        {error && <span className="text-xs text-red-700">{error}</span>}

        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="ml-auto rounded p-1 text-amber-600 hover:bg-amber-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
