# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability, please report it privately — **do not
open a public issue**.

Use GitHub's [private vulnerability reporting](https://github.com/alazaroc/knowledge-inbox-zero/security/advisories/new)
(Security → Report a vulnerability), or contact the maintainer directly.

Please include:

- A description of the issue and its impact.
- Steps to reproduce or a proof of concept.
- Affected component (frontend, backend handler, infra, MCP server).

You can expect an initial response within a few days. Once the issue is
confirmed and fixed, coordinated disclosure is welcome.

## Scope

This is a personal open-source project. There is no bug-bounty program, but
responsibly reported issues are genuinely appreciated and will be credited if
you'd like.

## Good to know

- Every API read and write is scoped to the authenticated Cognito user (`sub`).
- Secrets (private-repo tokens) are stored in AWS Secrets Manager, never in the repo.
- The pre-commit guard blocks committing files matching personal-data patterns
  (see `.gitignore` and `.kiro/hooks/personal-data-precommit-guard.json`).
