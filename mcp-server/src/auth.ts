/**
 * Obtain a Cognito id token for the MCP server to call the deployed API.
 *
 * - `id-token` mode: the token is supplied directly via env; return it as-is.
 * - `password` mode: perform a Cognito USER_PASSWORD_AUTH exchange once at
 *   startup to mint an id token.
 */

import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import type { KizConfig } from './config.js';
import { ConfigError } from './config.js';

/**
 * Resolve a Cognito id token from the given config. In `password` mode this
 * performs a single network call to Cognito; in `id-token` mode it is pure.
 *
 * Throws {@link ConfigError} with a readable message when the Cognito exchange
 * fails or returns no id token.
 */
export async function resolveIdToken(config: KizConfig): Promise<string> {
  if (config.auth.kind === 'id-token') {
    return config.auth.idToken;
  }

  const { email, password, clientId, region } = config.auth;
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
