/**
 * Obtain (and renew) a Cognito id token for the MCP server to call the API.
 *
 * Cognito id tokens are short-lived (this pool issues 1-hour tokens), so a
 * long-running MCP session must be able to get a FRESH token, not just one
 * minted at startup. This module exposes a {@link TokenProvider} that the API
 * client calls on demand:
 *
 * - `password` mode: every renew performs a Cognito `USER_PASSWORD_AUTH`
 *   exchange, so the client can recover from an expired token transparently.
 * - `id-token` mode: the token was supplied out of band; it cannot be renewed,
 *   so renew returns the same token and the client surfaces a clear error when
 *   it expires.
 */

import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import type { KizConfig } from './config.js';
import { ConfigError } from './config.js';

/**
 * Supplies a Cognito id token to the API client.
 *
 * - `get()` returns the currently cached token (never a network call).
 * - `renew()` obtains a fresh token when possible and caches it. In `id-token`
 *   mode it cannot renew and reports `renewable: false`, so the caller can tell
 *   "the token expired and I can do nothing about it" from "I just refreshed it".
 */
export interface TokenProvider {
  /** The token currently cached. Pure, no network. */
  get(): string;
  /**
   * Obtain a fresh token if this provider can. Returns whether a renewal was
   * actually possible; when `false` the cached token is unchanged.
   */
  renew(): Promise<{ renewed: boolean; renewable: boolean }>;
}

/**
 * Perform a single Cognito `USER_PASSWORD_AUTH` exchange and return the id
 * token. Throws {@link ConfigError} with an actionable message on failure.
 */
async function signIn(auth: {
  email: string;
  password: string;
  clientId: string;
  region: string;
}): Promise<string> {
  const { email, password, clientId, region } = auth;
  const client = new CognitoIdentityProviderClient({ region });

  let response;
  try {
    response = await client.send(
      new InitiateAuthCommand({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: clientId,
        AuthParameters: { USERNAME: email, PASSWORD: password },
      })
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new ConfigError(
      `Cognito USER_PASSWORD_AUTH failed for ${email}: ${detail}. ` +
        'Check KIZ_EMAIL/KIZ_PASSWORD/KIZ_COGNITO_CLIENT_ID and that the app client ' +
        'enables USER_PASSWORD_AUTH. If the user is in FORCE_CHANGE_PASSWORD or MFA is ' +
        'required, obtain an id token out of band and pass it via KIZ_ID_TOKEN instead.'
    );
  }

  const idToken = response.AuthenticationResult?.IdToken;
  if (!idToken) {
    // A challenge (NEW_PASSWORD_REQUIRED, MFA, …) returns no AuthenticationResult.
    const challenge = response.ChallengeName ? ` (challenge: ${response.ChallengeName})` : '';
    throw new ConfigError(
      `Cognito did not return an id token${challenge}. The account likely requires an ` +
        'additional step (password change or MFA). Complete it, then pass the resulting ' +
        'id token via KIZ_ID_TOKEN.'
    );
  }
  return idToken;
}

/**
 * Exchange a Cognito REFRESH token for a fresh id token (`REFRESH_TOKEN_AUTH`).
 * No password is involved — this is how the recommended mode renews. Throws
 * {@link ConfigError} when the refresh token is expired/revoked.
 */
async function refresh(auth: {
  refreshToken: string;
  clientId: string;
  region: string;
}): Promise<string> {
  const { refreshToken, clientId, region } = auth;
  const client = new CognitoIdentityProviderClient({ region });

  let response;
  try {
    response = await client.send(
      new InitiateAuthCommand({
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        ClientId: clientId,
        AuthParameters: { REFRESH_TOKEN: refreshToken },
      })
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new ConfigError(
      `Cognito REFRESH_TOKEN_AUTH failed: ${detail}. The refresh token is likely expired ` +
        '(30-day lifetime) or revoked. Run `kiz-login` again to mint a new one.'
    );
  }

  const idToken = response.AuthenticationResult?.IdToken;
  if (!idToken) {
    throw new ConfigError(
      'Cognito did not return an id token from the refresh token. Run `kiz-login` again.'
    );
  }
  return idToken;
}

/**
 * Build a {@link TokenProvider} from config and mint the first token up front,
 * so misconfiguration fails fast and loudly before any tool call.
 *
 * In `refresh-token` and `password` modes the provider can renew on demand; in
 * `id-token` mode it holds the supplied token and reports itself non-renewable.
 */
export async function createTokenProvider(config: KizConfig): Promise<TokenProvider> {
  if (config.auth.kind === 'id-token') {
    const token = config.auth.idToken;
    return {
      get: () => token,
      renew: async () => ({ renewed: false, renewable: false }),
    };
  }

  if (config.auth.kind === 'refresh-token') {
    const credentials = config.auth;
    let cached = await refresh(credentials); // fail fast at startup
    return {
      get: () => cached,
      renew: async () => {
        cached = await refresh(credentials);
        return { renewed: true, renewable: true };
      },
    };
  }

  const credentials = config.auth;
  let cached = await signIn(credentials); // fail fast at startup

  return {
    get: () => cached,
    renew: async () => {
      cached = await signIn(credentials);
      return { renewed: true, renewable: true };
    },
  };
}

/**
 * Backwards-compatible helper: resolve a single id token from config (no
 * renewal). Kept so existing callers/tests keep working; new code should use
 * {@link createTokenProvider}.
 */
export async function resolveIdToken(config: KizConfig): Promise<string> {
  const provider = await createTokenProvider(config);
  return provider.get();
}
