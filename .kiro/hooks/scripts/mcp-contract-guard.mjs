#!/usr/bin/env node
// MCP Contract Guard
//
// Asserts the Knowledge Inbox Zero MCP server still exposes EXACTLY the three
// expected tools, each with a valid (object) input schema. Run on PostFileSave
// of the mcp-server source as a contract-regression guard (hook #4).
//
// It compiles the mcp-server (tsc) then imports the built TOOL_DEFINITIONS and
// checks names + schemas. No network, no API calls.
//
// Exit codes: 0 = contract intact, 1 = contract broken / build failed.

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const EXPECTED = ['explain_document', 'list_recommendations', 'submit_urls'];

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const mcpDir = resolve(repoRoot, 'mcp-server');

function fail(msg) {
  process.stderr.write(`MCP contract guard FAILED: ${msg}\n`);
  process.exit(1);
}

if (!existsSync(mcpDir)) fail(`mcp-server not found at ${mcpDir}`);

// Build the server so we check the compiled contract, not stale output.
try {
  execSync('npm run build', { cwd: mcpDir, stdio: 'pipe' });
} catch (err) {
  fail(`mcp-server build failed:\n${err.stdout?.toString() ?? ''}${err.stderr?.toString() ?? ''}`);
}

const toolsUrl = pathToFileURL(resolve(mcpDir, 'dist', 'tools.js')).href;
let mod;
try {
  mod = await import(toolsUrl);
} catch (err) {
  fail(`could not import built tools.js: ${err?.message ?? err}`);
}

const defs = mod.TOOL_DEFINITIONS;
if (!Array.isArray(defs)) fail('TOOL_DEFINITIONS is not an array');

const names = defs.map((d) => d.name).sort();
if (JSON.stringify(names) !== JSON.stringify(EXPECTED)) {
  fail(`expected tools ${JSON.stringify(EXPECTED)} but found ${JSON.stringify(names)}`);
}

for (const def of defs) {
  if (!def.inputSchema || typeof def.inputSchema !== 'object') {
    fail(`tool "${def.name}" has no object inputSchema`);
  }
  if (!def.schema || typeof def.schema.safeParse !== 'function') {
    fail(`tool "${def.name}" has no zod schema`);
  }
  if (typeof def.description !== 'string' || def.description.length < 10) {
    fail(`tool "${def.name}" has no usable description`);
  }
}

process.stdout.write(`MCP contract guard OK: ${names.join(', ')}\n`);
process.exit(0);
