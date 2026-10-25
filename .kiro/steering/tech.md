# Tech Stack

## Build system

- **npm workspaces** monorepo. Workspaces (root `package.json`): `shared`, `frontend`, `backend`, `infra/cdk`, `mcp-server`. `browser-extension` se empaqueta aparte (no es workspace).
- **Node.js >= 22** (Lambdas run on Node 22, ARM64).
- **TypeScript 5.4** everywhere, ESM modules (`"type": "module"`). Shared `tsconfig.base.json`.
- A unified **Makefile** wraps the npm scripts and `scripts/` helpers. Prefer `make` targets for common flows.

## Stack by workspace (lo no obvio; versiones exactas → package.json)

- **`shared` (`@app/shared`)**: tipos, constantes, zod y TODA la lógica determinista pura (canonicalización URL, dedup keys, concept-set math, scoring MKV, state mapping), property-tested una vez. Build ANTES que backend/frontend.
- **`frontend` (`@app/frontend`)**: React 18 + Vite **8** + Tailwind 3.4, PWA vía `vite-plugin-pwa` (`registerType: "prompt"`), Amplify (Cognito), **`react-router-dom` v7**. Cliente API (`lib/api.ts`) con retry + backoff exponencial. Tests Vitest + Testing Library + jsdom.
- **`backend` (`@app/backend`)**: Lambda TS ESM, AWS SDK v3, `zod`, `aws-jwt-verify`. Extracción de contenido con `@mozilla/readability` + `jsdom` (NO headless browser). Tests Jest + ts-jest; property tests `fast-check`.
- **`infra/cdk` (`@app/infra`)**: AWS CDK, `NodejsFunction`/esbuild para bundling. Stacks: `storage` (4 tablas DynamoDB + bucket S3 privado), `auth` (Cognito, **sign-up público** `selfSignUpEnabled: true`, trigger pre-signup auto-confirma, **MFA OFF**), `api` (HTTP API v2 + Lambdas + SQS queue/DLQ + Secret profile-tokens + IAM Bedrock), `frontend` (S3 + CloudFront).

## Runtime architecture

- **API**: API Gateway **HTTP API v2** with a Cognito JWT authorizer. Synchronous handlers run at 256 MB / 10 s timeout.
- **Async analysis**: `imports` enqueues one **SQS** message per new document; the **`analysis-worker`** Lambda (1024 MB, 120 s timeout, reserved concurrency 5, partial-batch-failure reporting) consumes them. Queue visibility timeout 720 s (≥6× worker timeout); DLQ after `maxReceiveCount = 3`.
- **AI**: Amazon **Bedrock**, modelo único configurable vía `BEDROCK_MODEL_ID` (default `global.amazon.nova-2-lite-v1:0`, Nova 2 Lite vía inference profile GLOBAL — NO on-demand, ver `architecture-principles.md`). Lo invocan `analysis-worker` (extracción + explicación) y `profile` (draft de perfil); el resto de handlers son deterministas. `EMBEDDINGS_ENABLED` default `false` (Tier B).
- **Storage**: DynamoDB PAY_PER_REQUEST (one table per entity, GSIs for owner/state/batch, atomic `ADD` counters), private S3 content bucket for large extracted text.

## Tooling & quality

- **ESLint 9** (flat config, `typescript-eslint`), **Prettier**, **Stylelint** for CSS.
- **husky** + **lint-staged** on pre-commit, preceded by **git secrets** (anti-secret scan): eslint --fix + prettier on staged files.
- CI: `.github/workflows/pipeline.yml` runs `lint → test → build` (incl. `cdk synth`); deploys to `prod` on `main` via OIDC. The `test` deploy job is commented out (test environment retired for now).

## Common commands

Run from the repo root. `make help` lists all targets.

### Install & develop

```bash
make install         # npm ci (clean, reproducible install from the lockfile)
make dev             # run frontend locally (Vite, no AWS creds)
make dev-env         # populate frontend/.env from SSM (needs creds, run once after deploy)
```

### Build

```bash
make build           # build shared + backend + frontend
make build-shared    # build only shared (required before the rest)
```

### Quality (run these after changes; keep them green)

```bash
make validate        # build shared + lint + css + typecheck + format check + tests
make quality-check   # same as validate but without tests
make test            # backend (Jest) + frontend (Vitest) tests
make lint            # lint all workspaces
make fix             # auto-fix lint + css + formatting
make typecheck       # type-check all workspaces
```

### Deploy (deploy.sh skips unchanged components unless FORCE_DEPLOY=true)

```bash
make deploy ENV=prod              # infra + frontend
make deploy-backend ENV=prod      # CDK only
make deploy-frontend ENV=prod     # frontend only (build + S3 sync + invalidation)
make deploy ENV=prod FORCE_DEPLOY=true
```

### Users (Cognito)

Sign-up es **público** (`selfSignUpEnabled: true`, auto-confirmado por el trigger pre-signup). Estos scripts son para altas admin/manuales (rol ADMIN gestiona `/users`). Usar `ENV=prod` — el entorno `test` está retirado.

```bash
make create-admin EMAIL=you@email.com PASSWORD='Temp.123!' ENV=prod
make create-user  EMAIL=x@email.com PASSWORD='Temp.123!' ROLE=USER ENV=prod
make set-password EMAIL=x@email.com PASSWORD='New.Secure123!' ENV=prod
```

### Ops

```bash
make logs-lambdas ENV=prod TYPE=errors   # tail Lambda logs (profile, imports, documents, analysis-worker, users; MINS=30 default)
make clean                                # remove build artifacts
```

## Kiro tooling (MCP + agents)

- **MCP — `aws-docs`** (`.kiro/settings/mcp.json`): the AWS Documentation MCP server
  (`awslabs.aws-documentation-mcp-server` via `uvx`). Use it to check current AWS
  guidance while implementing serverless/Bedrock code instead of relying only on
  model memory — e.g. confirm the recommended Bedrock Runtime API (Converse vs
  `InvokeModel`) before changing `backend/src/lib/bedrock.ts`, or verify DynamoDB
  GSI / SQS / CDK construct options. Requires `uv`/`uvx` on the PATH.
- **Agent — `serverless-reviewer`** (`.kiro/agents/serverless-reviewer.md`): a
  read-only reviewer that checks a change against the approved spec, the steering
  architecture principles, AWS cost posture, and repo conventions. Invoke it after
  a vertical slice, e.g. "Switch to serverless-reviewer and review the imports
  handler change." It reports findings by severity; it does not implement.

## Rules

- Tras cambios, mantén `make build` y `make validate` verdes (principios y guardas de coste → `architecture-principles.md` / `conventions.md`).
- En Windows los helpers del Makefile son shell scripts; si no hay `make`/bash, los `npm run` subyacentes funcionan directo.
