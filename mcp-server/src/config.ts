/**
 * Configuration for the Read Worthy MCP server.
 *
 * Everything comes from the environment — no flags and no hardcoded
 * URLs/tokens/credentials. Auth has THREE modes, in order of how a serious
 * integration should connect:
 *
 *   1. refresh-token (RECOMMENDED):  KIZ_REFRESH_TOKEN (+ KIZ_COGNITO_CLIENT_ID)
 *      A long-lived Cognito refresh token (NOT your password; revocable, 30-day
 *      lifetime) that the server exchanges for a fresh id token and silently
 *      renews. Mint it once with `kiz-login` (see src/login.ts) — your password
 *      is typed once and never stored. This is how OAuth-style MCP servers work.
 *   2. password:                     KIZ_EMAIL + KIZ_PASSWORD (+ KIZ_COGNITO_CLIENT_ID)
 *      USER_PASSWORD_AUTH at startup, renewed on demand. Convenient but keeps
 *      your password in the environment/config — avoid for anything shared.
 *   3. id-token:                     KIZ_ID_TOKEN
 *      A ready-made id token for a quick test. It cannot be renewed (expires in
 *      ~1h).
 *
 * `KIZ_API_URL` (the deployed HTTP API base URL) is always required.
 */

export interface KizConfig {
  apiUrl: string;
  // Exactly one auth strategy is resolved from the environment.
  auth:
    | { kind: 'refresh-token'; refreshToken: string; clientId: string; region: string }
    | { kind: 'password'; email: string; password: string; clientId: string; region: string }
    | { kind: 'id-token'; idToken: string };
}

/** Thrown when required environment configuration is missing or inconsistent. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Read a trimmed env var, treating empty/whitespace as absent. */
function env(name: string, source: NodeJS.ProcessEnv): string | undefined {
  const v = source[name];
  if (v === undefined) return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** The Cognito region, shared by the refresh-token and password modes. */
function resolveRegion(source: NodeJS.ProcessEnv): string {
  return env('KIZ_COGNITO_REGION', source) ?? env('AWS_REGION', source) ?? 'eu-south-2';
}

/**
 * Resolve the server configuration from an environment map (defaults to
 * `process.env`). Pure and side-effect free so tests can pass a fake env.
 *
 * Throws {@link ConfigError} with an actionable message when configuration is
 * missing or ambiguous.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): KizConfig {
  const apiUrl = env('KIZ_API_URL', source);
  if (!apiUrl) {
    throw new ConfigError(
      'KIZ_API_URL is required (the deployed Read Worthy API base URL, e.g. ' +
        'https://abc123.execute-api.eu-south-2.amazonaws.com). Read it from the stack ' +
        'output `ApiUrl` or the SSM parameter created by the api-stack.'
    );
  }
  if (!/^https?:\/\//.test(apiUrl)) {
    throw new ConfigError(`KIZ_API_URL must be an http(s) URL, got: ${apiUrl}`);
  }

  // ── 1. refresh-token mode (recommended — no password on disk) ──────────────
  const refreshToken = env('KIZ_REFRESH_TOKEN', source);
  if (refreshToken) {
    const clientId = env('KIZ_COGNITO_CLIENT_ID', source);
    if (!clientId) {
      throw new ConfigError(
        'KIZ_REFRESH_TOKEN requires KIZ_COGNITO_CLIENT_ID (the Cognito app client id the ' +
          'refresh token was issued for). Run `kiz-login` to mint both.'
      );
    }
    return {
      apiUrl: stripTrailingSlash(apiUrl),
      auth: { kind: 'refresh-token', refreshToken, clientId, region: resolveRegion(source) },
    };
  }

  // ── 2. id-token mode (quick test; not renewable) ───────────────────────────
  const idToken = env('KIZ_ID_TOKEN', source);
  if (idToken) {
    return { apiUrl: stripTrailingSlash(apiUrl), auth: { kind: 'id-token', idToken } };
  }

  // ── 3. password mode (convenient; keeps a password in the environment) ─────
  const email = env('KIZ_EMAIL', source);
  const password = env('KIZ_PASSWORD', source);
  const clientId = env('KIZ_COGNITO_CLIENT_ID', source);

  if (email && password) {
    if (!clientId) {
      throw new ConfigError(
        'KIZ_EMAIL + KIZ_PASSWORD require KIZ_COGNITO_CLIENT_ID (the Cognito user-pool ' +
          'app client id used for USER_PASSWORD_AUTH).'
      );
    }
    return {
      apiUrl: stripTrailingSlash(apiUrl),
      auth: { kind: 'password', email, password, clientId, region: resolveRegion(source) },
    };
  }

  throw new ConfigError(
    'No authentication configured. Provide ONE of: ' +
      'KIZ_REFRESH_TOKEN + KIZ_COGNITO_CLIENT_ID (recommended — run `kiz-login` first, no ' +
      'password stored); OR KIZ_EMAIL + KIZ_PASSWORD + KIZ_COGNITO_CLIENT_ID; OR ' +
      'KIZ_ID_TOKEN (quick test, expires in ~1h).'
  );
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
