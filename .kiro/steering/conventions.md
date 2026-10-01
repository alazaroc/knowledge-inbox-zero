# Conventions & Cost Guardrails

Hard-won conventions for Knowledge Inbox Zero. Follow these so new work stays aligned with the existing foundation (NFR-4) and the serverless/cost posture (NFR-1). Keep every vertical slice `npm run build` and `npm run validate` green.

## Backend handlers

- One handler per domain in `backend/src/handlers/<domain>.ts`, exporting a single `handler`.
- Dispatch inside the handler on `event.httpMethod` + path parameters. Do not split a domain across multiple Lambdas.
- Authenticate with `authenticate(event)` from `lib/handler-utils`; short-circuit on `'error' in auth`. Use `ctx.sub` as the owner id. V1 has no cross-user sharing — authorization is plain per-user ownership (owner-only reads and writes).
- Validate request bodies with `parseBody(event, <zodSchema>)`; short-circuit on `'error' in body`.
- Build responses only with `lib/response` helpers: `ok`, `created`, `noContent`, `badRequest`, `notFound`, `serverError`. Wrap the body in `try/catch` and return `serverError(err)` on failure.
- Access DynamoDB through the shared `ddb` document client from `lib/dynamo`. Reference table names via `TABLE_NAMES` from `@app/shared` — never hardcode.
- Generate ids/timestamps with `newId()` / `now()` from `lib/ids`.
- Enforce per-user ownership (`ownerId`) on every data access.

## Runtime & modules

- Node 22, ARM64, ESM (`"type": "module"`).
- Local `.ts` imports use `.js` extensions (e.g. `../lib/dynamo.js`).
- AWS SDK v3; Zod at external boundaries.

## Placement

- Shared types, constants, and Zod schemas live in `@app/shared` (built before backend/frontend).
- Pure deterministic logic (canonicalization, dedup keys, MKV scoring) lives in `@app/shared` so it is property-tested once and reused by both the API and the async worker.

## Cost guardrails (deterministic-first)

- Invoke Amazon Bedrock ONLY for structured extraction and the written explanation. Everything else — canonicalization, dedup, metadata, MKV scoring — is deterministic. Prefer the deterministic path whenever it avoids an LLM call without losing required output.
- No always-on infrastructure and no meaningful idle cost: no ECS/EKS, RDS, or OpenSearch Serverless in V1.
- No vector DB / embeddings store in V1. Embeddings are a Tier B capability behind the `EMBEDDINGS_ENABLED` flag (defaults off); the deterministic concept-based path is the default.
- Prefer PAY_PER_REQUEST DynamoDB, ARM64 Lambda, and SQS for asynchronous multi-document work. Sized for tens-to-hundreds of documents per user, not millions.
- Bedrock is the single AI platform; no multi-provider abstraction in V1. AI outputs use structured schemas; recommendations must be explainable, never an opaque score alone.
