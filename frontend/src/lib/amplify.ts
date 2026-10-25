import { Amplify } from 'aws-amplify';

// Google SSO is available only when a Hosted UI domain is configured
// (VITE_COGNITO_DOMAIN). Without it the app runs email+password only, so a
// clone with no Google credentials still works.
const cognitoDomain = import.meta.env.VITE_COGNITO_DOMAIN as string | undefined;
export const isGoogleSsoEnabled = Boolean(cognitoDomain);

export function configureAmplify() {
  // The OAuth redirect targets the current origin (works for localhost and prod
  // alike without hardcoding a domain).
  const redirectUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/` : 'http://localhost:5173/';

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: import.meta.env.VITE_USER_POOL_ID,
        userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID,
        ...(isGoogleSsoEnabled
          ? {
              loginWith: {
                oauth: {
                  domain: cognitoDomain!,
                  scopes: ['openid', 'email', 'profile'],
                  redirectSignIn: [redirectUrl],
                  redirectSignOut: [redirectUrl],
                  responseType: 'code' as const,
                },
              },
            }
          : {}),
      },
    },
  });
}
