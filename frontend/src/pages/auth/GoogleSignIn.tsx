import { signInWithRedirect } from 'aws-amplify/auth';
import { isGoogleSsoEnabled } from '../../lib/amplify';

/**
 * "Continue with Google" button + divider. Renders nothing when Google SSO is
 * not configured (no Hosted UI domain), so the email/password form stands alone
 * on a clone with no Google credentials.
 *
 * `position` controls where the divider sits relative to the button:
 * - 'below' (default): divider on top, button under it — use when the component
 *   renders UNDER the email/password form.
 * - 'above': button on top, divider under it — use when Google is the primary,
 *   first action ABOVE the form (best for conversion from a cold click).
 */
export default function GoogleSignIn({
  label,
  position = 'below',
}: {
  label: string;
  position?: 'above' | 'below';
}) {
  if (!isGoogleSsoEnabled) return null;

  const divider = (
    <div className="my-5 flex items-center gap-3 text-xs text-gray-400">
      <span className="h-px flex-1 bg-gray-200" />
      or
      <span className="h-px flex-1 bg-gray-200" />
    </div>
  );

  return (
    <>
      {position === 'below' && divider}
      <button
        type="button"
        onClick={() => void signInWithRedirect({ provider: 'Google' })}
        className="flex w-full cursor-pointer items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
          />
        </svg>
        {label}
      </button>
      {position === 'above' && divider}
    </>
  );
}
