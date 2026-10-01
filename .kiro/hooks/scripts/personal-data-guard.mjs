#!/usr/bin/env node
// Personal Data Pre-Commit Guard (NFR-3.2)
//
// Blocks a `git commit` when a staged file matches a personal-data pattern.
// Design reference: Kiro Capability Opportunities (hooks #2).
//
// Invocation contexts:
//   1. Kiro PreToolUse command hook: receives JSON on stdin describing the
//      pending tool call. If the pending command is not a `git commit`, the
//      guard is a no-op (exit 0). Exit 2 blocks the tool call; stderr is
//      surfaced as the reason.
//   2. Direct / husky pre-commit: no usable command on stdin, so it falls
//      back to scanning the currently staged files unconditionally.
//
// Exit codes: 0 = allow, 2 = block (personal data staged).

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Patterns that indicate REAL personal data (NFR-3.2). Demo/example data is
// explicitly allowed via ALLOW below.
const BLOCK_PATTERNS = [
  /(^|\/)personal-data\//i,
  /(^|\/)profile-data\//i,
  /(^|\/)private\//i,
  /\.personal\.[^/]+$/i,
  /\.private\.[^/]+$/i,
  /(^|\/)(profile|url)-history[^/]*$/i,
  /(^|\/)real-(profile|urls?)[^/]*$/i,
];

// Clearly-marked demo/example data is safe to commit.
const ALLOW_PATTERNS = [
  /(^|\/)examples?\//i,
  /\.sample\.[^/]+$/i,
  /\.example\.[^/]+$/i,
  /(^|\/)sample-/i,
];

// Read the tool-call JSON from fd 0 if present. Kiro pipes it in; husky does not.
let payload = '';
try {
  payload = readFileSync(0, 'utf8');
} catch {
  payload = '';
}

// Extract the pending command string from the PreToolUse payload, if any.
function extractCommand(raw) {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    const candidates = [
      obj?.command,
      obj?.input?.command,
      obj?.toolInput?.command,
      obj?.tool_input?.command,
      obj?.arguments?.command,
    ];
    for (const c of candidates) if (typeof c === 'string') return c;
    // Fallback: stringify and search.
    return JSON.stringify(obj);
  } catch {
    return raw;
  }
}

const command = extractCommand(payload);

// If we have a command and it is clearly NOT a git commit, allow and exit.
// If we have no command at all (husky/direct), treat it as a commit attempt.
const looksLikeCommit = command == null ? true : /\bgit\b[\s\S]*\bcommit\b/i.test(command);

if (!looksLikeCommit) {
  process.exit(0);
}

function stagedFiles() {
  try {
    const out = execSync('git diff --cached --name-only --diff-filter=ACMR', {
      encoding: 'utf8',
    });
    return out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    // No git / no staged files -> nothing to guard.
    return [];
  }
}

const files = stagedFiles();
const offenders = files.filter((f) => {
  if (ALLOW_PATTERNS.some((p) => p.test(f))) return false;
  return BLOCK_PATTERNS.some((p) => p.test(f));
});

if (offenders.length > 0) {
  process.stderr.write(
    'Personal Data Pre-Commit Guard (NFR-3.2): refusing to commit real personal data.\n' +
      'The following staged files match personal-data patterns:\n' +
      offenders.map((f) => '  - ' + f).join('\n') +
      '\n\nMove real personal data outside the repo, or mark demo data clearly ' +
      '(examples/, *.sample.*, *.example.*). Then unstage the offending files and retry.\n'
  );
  process.exit(2);
}

process.exit(0);
