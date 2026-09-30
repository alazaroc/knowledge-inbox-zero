# Serverless Monorepo AWS Starter

A production-ready skeleton for a full-stack serverless web app on AWS. Clone it, replace two placeholders, deploy, and spend your time on the **product** — not on the plumbing.

## Why use this instead of starting from scratch?

Wiring up the scaffolding of a serverless app (auth with MFA, IaC, CI/CD, deploys, PWA, conventions) takes **days or weeks** before you write a single line of your actual product. Here it's already done and verified green. What you get for free:

- **Real authentication**: Cognito with mandatory TOTP MFA, roles, and a complete login flow (change password, reset, TOTP setup). Not a _hello world_.
- **Infrastructure as code**: 4 CDK stacks (DynamoDB, Cognito, API Gateway HTTP API + ARM64 Lambdas, CloudFront + private S3 with OAC and security headers), reproducible across `test` and `prod`.
- **CI/CD**: GitHub Actions pipeline with OIDC (no secrets), `lint → test → build → deploy` automatically per branch.
- **Incremental deploys**: only redeploys what changed (hash-based fingerprint).
- **PWA frontend**: React + Vite + Tailwind, installable, with a controlled update prompt and iOS safe-area support.
- **Conventions and quality**: monorepo with shared types, ESLint/Prettier, husky, tests, and a domain pattern (ownership + sharing) ready to copy.

**The philosophy:** the skeleton is _commodity_ — it should be boring, stable, and rarely touched. The value lives in the idea/product you build on top. And because all your apps share the same structure, jumping between them and maintaining them is trivial.

## Stack

- **Frontend**: React 18 + Vite 8 + TypeScript + Tailwind 3.4, PWA via `vite-plugin-pwa` (`registerType: "prompt"`), AWS Amplify (Cognito) auth, `react-router-dom` v6, iOS safe-area.
- **Backend**: Lambda (Node.js 22, ARM64) in TypeScript ESM, AWS SDK v3, validation with `zod`, JWT verification with `aws-jwt-verify`. One handler per domain.
- **Infra**: AWS CDK (`aws-cdk-lib` ^2.258) — `storage` (DynamoDB), `auth` (Cognito + TOTP MFA), `api` (API Gateway HTTP API + Lambdas), `frontend` (private S3 + CloudFront with OAC and security headers).
- **Shared**: `@app/shared` workspace with types, constants, and zod schemas shared between front and back.
- **Tooling**: unified Makefile, hash-based incremental deploy, GitHub Actions pipeline (OIDC), husky, ESLint 9, Prettier.

Default region targets `eu-south-2` (configurable). Environments: `test` and `prod`.

## Structure

```
.
├── shared/             # @app/shared — types, constants, zod schemas
├── frontend/           # React SPA (Vite + Tailwind + PWA + Amplify)
├── backend/            # Lambda handlers per domain (items, shares, users)
├── infra/cdk/          # CDK: storage + auth + api + frontend stacks
├── scripts/            # deploy.sh, create-user.sh, set-password.sh, dev-frontend.sh
├── .github/workflows/  # pipeline.yml (lint → test → build → deploy)
├── Makefile            # unified command interface
└── tsconfig.base.json  # shared TypeScript config
```

The `Item` entity (+ `shares`, `users` management) is a **generic example**: it demonstrates per-user ownership, read/write sharing, CRUD, and validation. Replace it with your real domain.

## Getting started

1. **Create your repo from this template.** On GitHub: mark this repo as a _Template repository_, then use **"Use this template" → Create a new repository** (clean repo, no history). Alternative: `git clone`, delete `.git`, `git init`.

2. **Replace the placeholders.** There are only two tokens in the whole repo:
   - `{{PROJECT_NAME}}` — your project name (lowercase slug, e.g. `my-app`). Used in AWS resource names, so it must be valid: lowercase letters, digits, and hyphens.
   - `{{AWS_REGION}}` — your AWS region (e.g. `eu-south-2`).

   Replace them across the tree:

   ```bash
   # macOS
   grep -rl '{{PROJECT_NAME}}' . --exclude-dir=node_modules --exclude-dir=.git \
     | xargs sed -i '' 's/{{PROJECT_NAME}}/my-app/g'
   grep -rl '{{AWS_REGION}}' . --exclude-dir=node_modules --exclude-dir=.git \
     | xargs sed -i '' 's/{{AWS_REGION}}/eu-south-2/g'
   ```

   > Internal package names use the fixed `@app/*` scope and do **not** need renaming.

That's it. The rest of the flow (install, deploy, first user, develop) is the checklist below.

## Next steps (checklist)

Once cloned and with placeholders replaced:

- [ ] `npm install && npm run build` is green.
- [ ] `cdk bootstrap aws://<account>/<region>` in your account (once).
- [ ] `make deploy ENV=test` — first deploy (creates Cognito, DynamoDB, API, CloudFront).
- [ ] `make create-admin EMAIL=you@email.com PASSWORD='Temp.123!' ENV=test` — your first user.
- [ ] `make dev-env && make dev` — run the frontend locally against the real backend.
- [ ] Log in, change the password, set up TOTP MFA. You'll see the `Item` CRUD working.
- [ ] (Optional, CI/CD) create the `AWS_ROLE_FOR_GITHUB_DEPLOYMENTS` variable and the `test`/`prod` environments in your repo.
- [ ] **Start building your product** → next section.

## Build your product with AI

The architecture is already solved. From here you only define your **business domain** and let the AI (Kiro, etc.) generate code following the existing patterns. The key: `Item` + `shares` + `users` is a **reference template** — the AI must imitate that pattern, not invent a new one.

### Recommended flow

1. Open the personalized repo with your AI agent.
2. Give it the prompt below, filling in your idea and entities.
3. Have it **propose the data model + API routes first**, and review before it writes code.
4. After each batch of changes, require `npm run build` and `npm run validate` to stay green.

### Starter prompt (copy it and fill in the `<...>`)

```text
You are working on the serverless-monorepo-aws-starter. Do NOT change the architecture
or tooling; imitate the existing patterns. Mandatory reference: the example entity `Item`
(+ `shares` + `users` management).

Architecture:
- shared/  (@app/shared): shared types, constants, and zod schemas.
- backend/ (Lambda TS ESM, AWS SDK v3, zod, aws-jwt-verify): one handler per domain in
  src/handlers/, utilities in src/lib/ (ownership + shares auth, response, dynamo).
- infra/cdk/: storage-stack (DynamoDB), auth-stack (Cognito MFA), api-stack (HTTP API + ARM64
  Node22 Lambdas), frontend-stack (S3 + CloudFront). Naming: {project}-{domain}-{env}.
- frontend/ (React 18 + Vite + Tailwind + Amplify): pages in src/pages/, client in src/lib/api.ts,
  session in src/context/AuthContext.tsx.

MY PRODUCT: <describe in 2-3 sentences what your web app does>.
DOMAIN ENTITIES: <list your entities and fields, e.g. "Project{name,status,date}, Task{...}">.
RELATIONSHIPS / OWNERSHIP: <who owns what, what is shared, what is public>.
ROLES: <e.g. ADMIN / USER, or your own>.

Tasks (in this order, asking me for OK between step 1 and 2):
1. Propose the data model (DynamoDB tables, PK/SK, GSIs) and the API routes. Wait for my approval.
2. In shared/: replace `Item` with my entities (types + constants + zod schemas).
3. In backend/src/handlers/: create the CRUD handlers following the items.ts and shares.ts pattern
   (zod validation, ownership/shares authorization, responses from lib/response).
4. In infra/cdk/: declare the tables in storage-stack.ts and the routes/Lambdas in api-stack.ts
   (with their IAM grants and GSIs, as in the example).
5. In frontend/src/pages/: create the pages using lib/api.ts and AuthContext; add routes in App.tsx.
6. Remove the `Item` example once it's no longer used.

Rules:
- Keep `npm run build` and `npm run validate` green after each batch.
- Do not add new libraries without justifying them.
- Respect the existing code style and file structure.
```

> Tip: start with ONE entity and its full-stack CRUD (shared → backend → infra → frontend),
> deploy it, confirm it works, and only then add the next one. Iterating vertically avoids
> ending up with half a backend and no UI.

## Deployment

Requirements: AWS CLI configured and `cdk bootstrap` run in your account/region.

```bash
make deploy ENV=test               # deploy infra + frontend to test
make deploy ENV=prod               # to prod
make deploy-backend ENV=test       # CDK only
make deploy-frontend ENV=test      # frontend only (build + S3 sync + CloudFront invalidation)
FORCE_DEPLOY=true make deploy       # ignore the incremental hash cache
```

`scripts/deploy.sh` fingerprints the version-controlled files and skips any component that hasn't changed.

### Users (Cognito, invite-only)

```bash
make create-admin EMAIL=you@email.com PASSWORD='Temp.123!' ENV=test
make create-user  EMAIL=x@email.com   PASSWORD='Temp.123!' ROLE=USER ENV=test
make set-password EMAIL=x@email.com   PASSWORD='New.Secure123!' ENV=test
```

On first login Cognito requires changing the password and setting up TOTP MFA.

## CI/CD

`.github/workflows/pipeline.yml`: on every push it runs `lint → test → build` (including a `cdk synth` validation). It deploys to `test` on non-`main` branches and to `prod` on `main`, via OIDC.

In your repo, configure the `AWS_ROLE_FOR_GITHUB_DEPLOYMENTS` variable (an IAM role with an OIDC trust to GitHub) and the `test` and `prod` environments. Until that variable is set, the deploy jobs are **skipped** (not failed), so CI stays green on a fresh clone.

## Useful commands

```bash
make help              # list all targets
make build             # build shared + backend + frontend
make validate          # quality:check (lint + css + typecheck + format) + tests
make fix               # auto-fix lint + css + formatting
make logs-lambdas ENV=test TYPE=errors
make aws-credentials   # dump AWS_ACCESS_KEY_ID/SECRET/TOKEN from the env into the default profile
make clean             # remove build artifacts
```

## License

MIT — see [LICENSE](LICENSE).
