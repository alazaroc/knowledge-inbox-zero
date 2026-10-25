import { useState } from 'react';
import { Link } from 'react-router-dom';
import { updatePassword } from 'aws-amplify/auth';
import { KeyRound, SlidersHorizontal, Bell } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

// Google "G" mark (official colors), used to show a federated account at a glance.
function GoogleMark({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

// "My account": identity + password. The knowledge profile and data sources
// live on their own page (Settings) so account management is not mixed with
// configuration.
export default function ProfilePage() {
  const { user } = useAuth();
  const isFederated = user?.isFederated ?? false;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">My account</h1>
        <p className="text-sm text-gray-500">Your identity and sign-in.</p>
      </div>

      <dl className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
        <div className="flex items-center justify-between py-1.5">
          <dt className="text-gray-500">Email</dt>
          <dd className="font-medium text-gray-900">{user?.email}</dd>
        </div>
        <div className="flex items-center justify-between py-1.5">
          <dt className="text-gray-500">Role</dt>
          <dd className="text-gray-900">{user?.role}</dd>
        </div>
        <div className="flex items-center justify-between py-1.5">
          <dt className="text-gray-500">Sign-in</dt>
          <dd>
            {isFederated ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700">
                <GoogleMark className="h-3.5 w-3.5" />
                Google account
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700">
                <KeyRound className="h-3.5 w-3.5 text-gray-500" />
                Email &amp; password
              </span>
            )}
          </dd>
        </div>
      </dl>

      {/* Federated (Google) accounts have no app password — managing it happens
          at Google, so we show a note instead of the change-password form. */}
      {isFederated ? (
        <section className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
          <GoogleMark className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            You sign in with Google, so there’s no password to manage here. Change your password or
            security settings from your{' '}
            <a
              href="https://myaccount.google.com/security"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-indigo-600 hover:text-indigo-700"
            >
              Google account
            </a>
            .
          </span>
        </section>
      ) : (
        <ChangePasswordSection />
      )}

      {/* Quick links to the other account-related pages. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Link
          to="/app/notifications"
          className="inline-flex items-center gap-2 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <Bell className="h-4 w-4 text-indigo-600" />
          Email notifications
        </Link>
        <Link
          to="/app/settings"
          className="inline-flex items-center gap-2 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <SlidersHorizontal className="h-4 w-4 text-indigo-600" />
          Knowledge profile &amp; data sources
        </Link>
      </div>
    </div>
  );
}

// Password rules mirrored from the Cognito pool policy (≥12, upper/lower/digit/symbol).
function validatePassword(pw: string): string | null {
  if (pw.length < 12) return 'Use at least 12 characters.';
  if (!/[A-Z]/.test(pw)) return 'Include an uppercase letter.';
  if (!/[a-z]/.test(pw)) return 'Include a lowercase letter.';
  if (!/\d/.test(pw)) return 'Include a digit.';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Include a symbol.';
  return null;
}

// "Change password" for the signed-in user, backed by Amplify updatePassword
// (requires the current password). Only rendered for NATIVE (email/password)
// accounts — federated (Google) users are shown a note and this is not mounted.
function ChangePasswordSection() {
  const [open, setOpen] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const reset = () => {
    setOldPassword('');
    setNewPassword('');
    setConfirm('');
    setError('');
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (newPassword !== confirm) {
      setError('The new password and its confirmation do not match.');
      return;
    }
    const ruleError = validatePassword(newPassword);
    if (ruleError) {
      setError(ruleError);
      return;
    }
    if (newPassword === oldPassword) {
      setError('The new password must be different from the current one.');
      return;
    }
    setSaving(true);
    try {
      await updatePassword({ oldPassword, newPassword });
      setSuccess('Password updated.');
      reset();
      setOpen(false);
    } catch (err) {
      setError((err as Error).message || 'Could not update your password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-800">Change password</h2>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => {
              reset();
              setSuccess('');
              setOpen(true);
            }}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Change
          </button>
        )}
      </div>

      {success && !open && <p className="mt-2 text-sm text-green-600">{success}</p>}

      {open && (
        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Current password</span>
            <input
              type="password"
              className="input w-full"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">New password</span>
            <input
              type="password"
              className="input w-full"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">
              Confirm new password
            </span>
            <input
              type="password"
              className="input w-full"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
            />
          </label>
          <p className="text-xs text-gray-400">
            At least 12 characters, with uppercase, lowercase, a digit and a symbol.
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Updating…' : 'Update password'}
            </button>
            <button
              type="button"
              onClick={() => {
                reset();
                setOpen(false);
              }}
              className="rounded px-3 py-2 text-sm font-medium text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
