/**
 * Configuration for the Knowledge Inbox Zero MCP server.
 *
 * Everything comes from the environment — no flags, no files, no hardcoded
 * URLs/tokens/credentials. Two auth modes are supported:
 *
 *   1. A ready-made Cognito id token:        KIZ_ID_TOKEN
 *   2. Email + password (USER_PASSWORD_AUTH): KIZ_EMAIL + KIZ_PASSWORD
 *                                             (+ KIZ_COGNITO_CLIENT_ID)
 *
 * `KIZ_API_URL` (the deployed HTTP API base URL) is always required.
 */

export interface KizConfig {
  apiUrl: string;
  // Exactly one auth strategy is resolved from the environment.
  auth:
    | { kind: 'id-token'; idToken: string }
    | { kind: 'password'; email: string; password: string; clientId: string; region: string };
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
      'KIZ_API_URL is required (the deployed Knowledge Inbox Zero API base URL, e.g. ' +
        'https://abc123.execute-api.eu-south-2.amazonaws.com). Read it from the stack ' +
        'output `ApiUrl` or the SSM parameter created by the api-stack.'
    );
  }
  if (!/^https?:\/\//.test(apiUrl)) {
    throw new ConfigError(`KIZ_API_URL must be an http(s) URL, got: ${apiUrl}`);
  }

  const idToken = env('KIZ_ID_TOKEN', source);
  if (idToken) {
    return { apiUrl: stripTrailingSlash(apiUrl), auth: { kind: 'id-token', idToken } };
  }

  const email = env('KIZ_EMAIL', source);
  const password = env('KIZ_PASSWORD', source);
  const clientId = env('KIZ_COGNITO_CLIENT_ID', source);
  // Default region matches the project default (eu-south-2); overridable.
  const region = env('KIZ_COGNITO_REGION', source) ?? env('AWS_REGION', source) ?? 'eu-south-2';

  if (email && password) {
    if (!clientId) {
      throw new ConfigError(
        'KIZ_EMAIL + KIZ_PASSWORD require KIZ_COGNITO_CLIENT_ID (the Cognito user-pool ' +
          'app client id used for USER_PASSWORD_AUTH).'
      );
    }
    return {
      apiUrl: stripTrailingSlash(apiUrl),
      auth: { kind: 'password', email, password, clientId, region },
    };
  }

  throw new ConfigError(
    'No authentication configured. Provide KIZ_ID_TOKEN (a Cognito id token), OR ' +
      'KIZ_EMAIL + KIZ_PASSWORD + KIZ_COGNITO_CLIENT_ID to sign in via Cognito ' +
      'USER_PASSWORD_AUTH at startup.'
  );
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
