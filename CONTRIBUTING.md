# Contributing

Thanks for your interest in Knowledge Inbox Zero! Contributions are welcome.

## Try the app first

Before contributing, [try the hosted app](https://inbox.playingaws.com) — it's the quickest way to understand what the product does and what it deliberately leaves out. It optimizes for _attention saved_, so the one question every change should sharpen is: _what deserves this user's attention, and why?_

## Not sure where to start?

- **An idea, question, or something to discuss?** Open a [GitHub Discussion](https://github.com/alazaroc/knowledge-inbox-zero/discussions) — good for anything that isn't yet a concrete bug or feature.
- **A concrete bug or feature?** Open an [issue](https://github.com/alazaroc/knowledge-inbox-zero/issues) (see below).
- **Code ready to go?** Open a pull request.

## Code of Conduct

This project adheres to a [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold it.

## Reporting bugs

Open a GitHub issue with:

- A clear description of the problem
- Steps to reproduce
- Expected vs. actual behavior
- Your environment (OS, Node version)

## Suggesting features

Open an issue describing the feature, the use case, and why it fits the product — remember the one question the product answers: _what deserves this user's attention, and why?_ Changes that turn it into a bookmark manager, read-it-later app, or RSS reader are out of scope (see the [README](README.md#scope)).

## Development setup

Requires Node.js ≥ 22. See [INSTALL.md](INSTALL.md) for the full AWS setup.

```bash
git clone https://github.com/alazaroc/knowledge-inbox-zero.git
cd knowledge-inbox-zero

make install        # npm ci — clean, reproducible
make build          # build shared + backend + frontend
make validate       # build shared + lint + css + typecheck + format + tests
```

`make help` lists every target.

## Pull requests

1. Fork and branch from `main`.
2. Make your change, following the conventions below.
3. Add or update tests for new behavior.
4. Keep `make validate` green (build, lint, typecheck, format, tests).
5. Open a PR with a clear description of what changed and why.

A pre-commit hook (husky + lint-staged) auto-fixes lint and formatting on staged files, so most style issues are handled for you.

## Project structure

```
shared/      # @app/shared — types, zod schemas, pure deterministic MKV logic (build first)
frontend/    # React SPA (Vite + Tailwind + PWA + Amplify)
backend/     # Lambda handlers — backend/src/handlers/<domain>.ts, shared code in backend/src/lib/
infra/cdk/   # CDK stacks: storage, auth, api, frontend
```

Backend convention: **one handler file per domain** in `backend/src/handlers/`, exporting a single `handler` that routes by HTTP method and path. Reusable logic lives in `backend/src/lib/`. Pure deterministic logic (canonicalization, dedup, MKV scoring) lives in `@app/shared` so it is property-tested once and reused by both the API and the worker.

## Coding standards

- **TypeScript** everywhere (ESM; local `.ts` imports use `.js` extensions).
- **Zod** at external boundaries (request bodies, env).
- **Deterministic-first**: invoke Bedrock only for structured extraction and the written explanation; everything else stays pure.
- **Tests**: Jest (backend) and Vitest (frontend). Use `fast-check` property tests for the deterministic logic in `@app/shared`.
- Reuse existing repo patterns; avoid adding dependencies without justification.

## Commit messages

Conventional commits are appreciated: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.

## License

By contributing, you agree your contributions are licensed under the [MIT License](LICENSE).
