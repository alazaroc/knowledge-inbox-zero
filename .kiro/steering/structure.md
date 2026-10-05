# Project Structure

```
.
├── shared/             # @app/shared — types, constants, zod schemas, pure MKV logic (build first)
│   └── src/            # constants.ts, index.ts, schemas.ts, types.ts
├── frontend/           # React SPA (Vite + Tailwind + PWA + Amplify)
│   └── src/
│       ├── components/ # reusable UI (ProtectedRoute, ReloadPrompt, ui/)
│       ├── context/    # AuthContext.tsx — session state
│       ├── lib/        # amplify.ts (Cognito), api.ts (backend client with retry/backoff)
│       ├── pages/
│       │   ├── app/    # AppLayout, ProfilePage, AddContentPage, LibraryPage, DocumentDetailPage
│       │   └── auth/   # LoginPage
│       └── App.tsx     # routes (/login, /app → library/add/library/:documentId/profile)
├── backend/            # Lambda handlers per domain
│   └── src/
│       ├── handlers/   # profile.ts, imports.ts, documents.ts, analysis-worker.ts, users.ts
│       ├── lib/        # auth, dynamo, handler-utils, ids, response, zod-errors, bedrock, retrieve
│       └── __tests__/  # *.test.ts (Jest) incl. property tests (fast-check)
├── infra/cdk/          # CDK app
│   ├── bin/app.ts      # entrypoint wiring the stacks
│   └── lib/            # storage-stack, auth-stack, api-stack, frontend-stack, naming.ts
├── scripts/            # deploy.sh, create-user.sh, set-password.sh, dev-frontend.sh
├── .github/workflows/  # pipeline.yml (lint → test → build → deploy)
├── Makefile            # unified command interface
└── tsconfig.base.json  # shared TypeScript config
```

## Domains (one Lambda handler each)

- **`profile`** (`/profile`): CRUD for the single per-user `Profile`. Deterministic, except `POST /profile/import`, which makes one Bedrock call to draft a profile from pasted text/CV (nothing is persisted; the draft only prefills the form).
- **`imports`** (`/imports`, `/imports/{batchId}`): create batches from pasted URLs, canonicalize + dedup, enqueue analysis to SQS, serve batch progress. Deterministic. Never calls Bedrock.
- **`documents`** (`/documents`, `/documents/{documentId}`): the library (grouped + per-state counts + pagination) and document detail. Read-only. Deterministic. Never calls Bedrock.
- **`analysis-worker`**: SQS-triggered (not an API route). The full per-document pipeline — fetch → readability extract → Bedrock structured extraction → deterministic MKV scoring → Bedrock explanation → persist → atomic counter updates. **The only component that writes to the content S3 bucket, and the only one that invokes Bedrock in the analysis pipeline** (the `profile` handler also calls Bedrock, but only to draft a profile — see above).
- **`users`** (`/users`, `/users/me`, `/users/{username}`): Cognito user management (ADMIN-only except `/users/me`).

## Where things go

- **Shared types/schemas/constants + pure logic** → `shared/src`. Anything used by both frontend and backend (entity types, zod schemas, table names) and all pure deterministic logic (URL canonicalization, dedup keys, concept-set math, MKV scoring, state mapping) lives here so it is property-tested once and reused by the API handlers and the worker.
- **API logic** → `backend/src/handlers/<domain>.ts`. One handler file per domain, exporting a single `handler` that routes by HTTP method + path params.
- **Reusable backend helpers** → `backend/src/lib/` — `auth`, `dynamo` (shared `ddb` doc client), `handler-utils` (authenticate/parseBody), `response` builders, `ids` (newId/now), `zod-errors`, `bedrock` (extraction + explanation), `retrieve` (fetch + Mozilla Readability). Do not inline these concerns in handlers.
- **Infrastructure** → declare tables + the content bucket in `storage-stack.ts`; routes, Lambdas, SQS queue/DLQ, IAM grants, GSIs, and the Bedrock policy in `api-stack.ts`.
- **Frontend pages** → `frontend/src/pages/`; call the backend through `lib/api.ts` and read session from `context/AuthContext.tsx`; register routes in `App.tsx`.

## Data model (DynamoDB, one table per entity, PAY_PER_REQUEST)

- **`profiles`** — one item per user. PK `userId` (Cognito `sub`). No SK, no GSI.
- **`batches`** — one item per import batch. PK `batchId`. GSI `byOwner` (PK `ownerId`, SK `createdAt`) lists newest-first. Rejected lines stored on the item as a bounded array.
- **`documents`** — one item per canonical URL per owner. PK `documentId` = `sha256(ownerId#canonicalUrl)` → re-import is an idempotent upsert. GSIs: `byOwner` (library page + cursor), `byOwnerState` (filter by recommendation state), `byBatch` (worker + progress lookups). Per-owner **counts aggregate** item (`documentId = "COUNTS#<ownerId>"`) updated with atomic `ADD` so library counts are O(1) and pagination-independent.
- **`users`** — app user profiles (auth lives in Cognito). PK `userId`, GSI `byEmail`.
- **Content S3 bucket** (`{project}-content-{env}`, private, SSE-S3, Block Public Access, RETAIN): offloaded extracted content when raw/readable content exceeds 300 KB. Object key `{ownerId}/{documentId}.txt`; the document row stores `s3ContentRef`.

## Backend handler conventions

- Wrap the handler body in `try/catch` and return `serverError(err)` on failure.
- Route on `event.httpMethod` and path parameters.
- Authenticate with `authenticate(event)` from `lib/handler-utils`; short-circuit on `'error' in auth`. `ctx.sub` is the owner id on every query.
- Validate request bodies with `parseBody(event, <zodSchema>)` from `@app/shared`; short-circuit on `'error' in body`.
- Build responses with `lib/response` (`ok`, `created`, `noContent`, `badRequest`, `notFound`, `serverError`).
- Access DynamoDB through the shared `ddb` document client from `lib/dynamo`; reference table names via `TABLE_NAMES` from `@app/shared` — never hardcode.
- Enforce per-user ownership (`ownerId` = Cognito `sub`) on every data access.

## Naming

- AWS resources: `{project}-{domain}-{env}` (e.g. Lambda `myapp-imports-test`, queue `myapp-analysis-test`, bucket `myapp-content-test`).
- Internal packages use the fixed `@app/*` scope (`@app/shared`, `@app/frontend`, `@app/backend`, `@app/infra`).
- ESM imports of local `.ts` files use `.js` extensions (e.g. `../lib/dynamo.js`).
