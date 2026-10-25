#!/usr/bin/env node
/**
 * `kiz-login` — one-time interactive sign-in that mints a Cognito REFRESH token
 * for the MCP server, so you never put your password in the MCP config.
 *
 * It asks for your email and password ONCE (the password is read without echo),
 * performs a single Cognito `USER_PASSWORD_AUTH` exchange, and prints the
 * refresh token plus a ready-to-paste `mcpServers` block. Nothing is written to
 * disk by default — you copy the refresh token into your MCP config (or an env
 * var / secret manager). The password is never stored and never leaves this
 * process.
 *
 * Usage:
 *   KIZ_COGNITO_CLIENT_ID=<app-client-id> \
 *   KIZ_API_URL=https://<api-id>.execute-api.<region>.amazonaws.com \
 *   node mcp-server/dist/login.js
 *
 * Optional env: KIZ_COGNITO_REGION (default eu-south-2), KIZ_EMAIL (skips the
 * email prompt).
 */

import { createInterface } from 'node:readline';
import { stdin, stdout, stderr, env, exit } from 'node:process';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';

function fail(message: string): never {
  stderr.write(`kiz-login: ${message}\n`);
  exit(1);
}

/** Prompt for a line on stdout, reading the answer from stdin. */
function ask(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Prompt for a secret WITHOUT echoing it to the terminal. */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    stdout.write(question);
    const onData = (char: Buffer) => {
      const s = char.toString('utf8');
      // Enter / return ends input.
      if (s === '\n' || s === '\r' || s === '\u0004') {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        stdout.write('\n');
        resolve(buffer);
        return;
      }
      // Ctrl-C aborts.
      if (s === '\u0003') {
        stdout.write('\n');
        exit(130);
      }
      // Backspace.
      if (s === '\u007f' || s === '\b') {
        buffer = buffer.slice(0, -1);
        return;
      }
      buffer += s;
    };
    let buffer = '';
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  const clientId = env.KIZ_COGNITO_CLIENT_ID?.trim();
  if (!clientId) {
    fail(
      'KIZ_COGNITO_CLIENT_ID is required (the Cognito app client id, from SSM ' +
        '`<prefix>/user-pool-client-id` or the auth-stack output UserPoolClientId).'
    );
  }
  const region = env.KIZ_COGNITO_REGION?.trim() || env.AWS_REGION?.trim() || 'eu-south-2';
  const apiUrl = env.KIZ_API_URL?.trim();

  const email = env.KIZ_EMAIL?.trim() || (await ask('Email: '));
  if (!email) fail('An email is required.');
  const password = await askHidden('Password (hidden): ');
  if (!password) fail('A password is required.');

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
    fail(`Cognito sign-in failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const refreshToken = response.AuthenticationResult?.RefreshToken;
  if (!refreshToken) {
    const challenge = response.ChallengeName ? ` (challenge: ${response.ChallengeName})` : '';
    fail(
      `Cognito returned no refresh token${challenge}. The account may need a password change ` +
        'or MFA; complete it in the app first, then run kiz-login again.'
    );
  }

  // Success: the refresh token goes to STDOUT so it can be piped/captured; the
  // human-readable guidance goes to STDERR so it does not pollute a pipe.
  stderr.write('\n✅ Signed in. Your password was NOT stored.\n\n');
  stderr.write('Paste this into your MCP client config (no password on disk):\n\n');
  stderr.write(
    JSON.stringify(
      {
        mcpServers: {
          'read-worthy': {
            command: 'node',
            args: ['/absolute/path/to/mcp-server/dist/index.js'],
            env: {
              KIZ_API_URL: apiUrl ?? 'https://<api-id>.execute-api.<region>.amazonaws.com',
              KIZ_COGNITO_CLIENT_ID: clientId,
              KIZ_REFRESH_TOKEN: refreshToken,
            },
          },
        },
      },
      null,
      2
    )
  );
  stderr.write(
    '\n\nThe refresh token lasts 30 days and is revocable from Cognito (it is NOT your ' +
      'password). The server exchanges it for fresh id tokens automatically.\n'
  );
  // Raw token on stdout for scripting (e.g. store it in a secret manager).
  stdout.write(`${refreshToken}\n`);
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
