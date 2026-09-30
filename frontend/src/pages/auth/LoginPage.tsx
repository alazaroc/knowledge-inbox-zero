import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  signIn,
  signOut,
  confirmSignIn,
  resetPassword,
  confirmResetPassword,
  type SignInOutput,
} from 'aws-amplify/auth';
import { useAuth } from '../../context/AuthContext';

type Step = 'CREDENTIALS' | 'NEW_PASSWORD' | 'RESET_PASSWORD' | 'TOTP_SETUP' | 'TOTP_CODE';

interface TotpDetails {
  sharedSecret: string;
  setupUri: string;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [step, setStep] = useState<Step>('CREDENTIALS');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetDestination, setResetDestination] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [totp, setTotp] = useState<TotpDetails | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const advance = async (result: SignInOutput) => {
    const next = result.nextStep?.signInStep;
    switch (next) {
      case 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED':
        setStep('NEW_PASSWORD');
        return;
      case 'RESET_PASSWORD': {
        const out = await resetPassword({ username: email });
        if (out.nextStep.resetPasswordStep === 'CONFIRM_RESET_PASSWORD_WITH_CODE') {
          setResetDestination(out.nextStep.codeDeliveryDetails.destination ?? '');
        }
        setStep('RESET_PASSWORD');
        return;
      }
      case 'CONTINUE_SIGN_IN_WITH_TOTP_SETUP': {
        const details = (
          result.nextStep as unknown as {
            totpSetupDetails: {
              sharedSecret: string;
              getSetupUri: (appName: string, account?: string) => URL;
            };
          }
        ).totpSetupDetails;
        const uri = details.getSetupUri('{{PROJECT_NAME}}', email).toString();
        setTotp({ sharedSecret: details.sharedSecret, setupUri: uri });
        setStep('TOTP_SETUP');
        return;
      }
      case 'CONFIRM_SIGN_IN_WITH_TOTP_CODE':
        setStep('TOTP_CODE');
        return;
      case 'DONE':
        await refresh();
        navigate('/app');
        return;
      default:
        setError(`Unsupported login step: ${next}`);
    }
  };

  const onCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // signOut before signIn: avoids UserAlreadyAuthenticatedException if a session lingered.
      try {
        await signOut();
      } catch {
        /* no previous session */
      }
      const result = await signIn({ username: email, password });
      await advance(result);
    } catch (err) {
      setError((err as Error).message || 'Sign-in error');
    } finally {
      setLoading(false);
    }
  };

  const onNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await confirmSignIn({ challengeResponse: newPassword });
      await advance(result);
    } catch (err) {
      setError((err as Error).message || 'Error changing the password');
    } finally {
      setLoading(false);
    }
  };

  const onResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await confirmResetPassword({ username: email, confirmationCode: resetCode, newPassword });
      const result = await signIn({ username: email, password: newPassword });
      await advance(result);
    } catch (err) {
      setError((err as Error).message || 'Error resetting the password');
    } finally {
      setLoading(false);
    }
  };

  const onConfirmTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await confirmSignIn({ challengeResponse: totpCode });
      await advance(result);
    } catch (err) {
      setError((err as Error).message || 'Invalid code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50 px-4 py-8 safe-pt safe-pb">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-1 flex items-center gap-3">
          <img src="/logo.svg" alt="" className="h-10 w-10" />
          <h1 className="text-2xl font-semibold text-gray-900">{'{{PROJECT_NAME}}'}</h1>
        </div>
        <p className="mb-6 text-sm text-gray-500">Private access</p>

        {step === 'CREDENTIALS' && (
          <form onSubmit={onCredentials} className="space-y-4">
            <Field label="Email">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                required
                autoComplete="email"
                autoFocus
              />
            </Field>
            <Field label="Password">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                required
                autoComplete="current-password"
              />
            </Field>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <SubmitBtn loading={loading}>Sign in</SubmitBtn>
          </form>
        )}

        {step === 'NEW_PASSWORD' && (
          <form onSubmit={onNewPassword} className="space-y-4">
            <p className="text-sm text-gray-600">
              Set a new password (at least 12 characters, with uppercase, lowercase, digits and
              symbols).
            </p>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="input"
              placeholder="New password"
              required
              autoComplete="new-password"
              autoFocus
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <SubmitBtn loading={loading}>Change password</SubmitBtn>
          </form>
        )}

        {step === 'RESET_PASSWORD' && (
          <form onSubmit={onResetPassword} className="space-y-4">
            <p className="text-sm text-gray-600">
              Enter the code sent{resetDestination ? ` to ${resetDestination}` : ' to your email'}{' '}
              and your new password.
            </p>
            <Field label="Verification code">
              <input
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value.replace(/\s/g, ''))}
                className="input text-center text-lg tracking-widest"
                inputMode="numeric"
                required
                autoFocus
              />
            </Field>
            <Field label="New password">
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="input"
                required
                autoComplete="new-password"
              />
            </Field>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <SubmitBtn loading={loading}>Reset and sign in</SubmitBtn>
          </form>
        )}

        {step === 'TOTP_SETUP' && totp && (
          <form onSubmit={onConfirmTotp} className="space-y-4">
            <h2 className="text-base font-semibold">Set up your authenticator</h2>
            <p className="text-sm text-gray-600">
              Add the account to your TOTP app (Google Authenticator, 1Password, Authy…).
            </p>
            <p className="text-sm text-gray-700">
              Secret:{' '}
              <code className="break-all rounded bg-gray-100 px-2 py-1 text-xs">
                {totp.sharedSecret}
              </code>
            </p>
            <a
              href={totp.setupUri}
              target="_blank"
              rel="noreferrer"
              className="block break-all text-sm text-indigo-600 underline"
            >
              Open the setup link
            </a>
            <Field label="6-digit code">
              <input
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\s/g, ''))}
                className="input text-center text-lg tracking-widest"
                maxLength={6}
                inputMode="numeric"
                pattern="\d{6}"
                required
                autoFocus
              />
            </Field>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <SubmitBtn loading={loading}>Confirm and sign in</SubmitBtn>
          </form>
        )}

        {step === 'TOTP_CODE' && (
          <form onSubmit={onConfirmTotp} className="space-y-4">
            <p className="text-sm text-gray-600">Enter the 6-digit code from your authenticator.</p>
            <input
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\s/g, ''))}
              className="input text-center text-lg tracking-widest"
              maxLength={6}
              inputMode="numeric"
              pattern="\d{6}"
              required
              autoFocus
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <SubmitBtn loading={loading}>Sign in</SubmitBtn>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      {children}
    </label>
  );
}

function SubmitBtn({ loading, children }: { loading: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full rounded bg-indigo-600 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
    >
      {loading ? 'Working…' : children}
    </button>
  );
}
