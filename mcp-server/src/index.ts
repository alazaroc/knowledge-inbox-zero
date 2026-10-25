#!/usr/bin/env node
/**
 * Knowledge Inbox Zero MCP server (stdio transport).
 *
 * A thin client of the deployed Knowledge Inbox Zero API. On startup it reads
 * its configuration from the environment, resolves a Cognito id token, and
 * exposes three tools over stdio: submit_urls, list_recommendations,
 * explain_document.
 *
 * Env (see src/config.ts): KIZ_API_URL + (KIZ_ID_TOKEN | KIZ_EMAIL+KIZ_PASSWORD
 * +KIZ_COGNITO_CLIENT_ID).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, ConfigError } from './config.js';
import { createTokenProvider } from './auth.js';
import { KizApiClient } from './api.js';
import { registerTools } from './tools.js';

async function main(): Promise<void> {
  const config = loadConfig();

  // Resolve a token provider up front so misconfiguration fails fast and
  // loudly, before any tool call. In password mode it mints the first token
  // now and can renew on demand; in id-token mode it holds the supplied token.
  const tokens = await createTokenProvider(config);

  const client = new KizApiClient({
    baseUrl: config.apiUrl,
    getIdToken: () => tokens.get(),
    renewToken: () => tokens.renew(),
  });

  const server = new McpServer({
    name: 'knowledge-inbox-zero',
    version: '1.0.1',
  });

  registerTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stderr only — stdout is the MCP channel.
  process.stderr.write('knowledge-inbox-zero MCP server ready on stdio\n');
}

main().catch((err: unknown) => {
  const message =
    err instanceof ConfigError ? err.message : err instanceof Error ? err.stack : String(err);
  process.stderr.write(`Failed to start knowledge-inbox-zero MCP server:\n${message}\n`);
  process.exit(1);
});
