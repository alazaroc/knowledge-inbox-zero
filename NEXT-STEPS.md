# Next Steps — Deploy & Run Knowledge Inbox Zero

The application code is complete (53/60 spec tasks; the rest are optional Tier B stretch items). This guide takes you from a **fresh clone on a new machine** to a **running app in your AWS account** plus a **local dev loop**.

Run every command from the repository root unless noted otherwise.

---

## 0. Prerequisites on the new machine

Install these first:

- **Node.js >= 22** (Lambdas run on Node 22; the toolchain assumes it).
- **Git**.
- **AWS CLI v2**, configured with credentials for your target account (`aws configure`, or export `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`).
- **A Bash shell for the `make` targets.** The Makefile helpers are shell scripts. On Windows use **Git Bash** or **WSL**. If you cannot use `make`, the underlying `npm run` scripts still work directly (noted below).
- **Docker Desktop (running).** CDK bundles the Lambdas with esbuild via a Docker image during `cdk synth`/deploy. It must be running for a deploy.

AWS-side, one-time per account/region:

- **Enable Amazon Bedrock model access** in the AWS console: Bedrock -> _Model access_ -> enable the Claude model the worker uses: `anthropic.claude-3-5-sonnet-20240620-v1:0`. This must be in the **same region** you deploy to, or the analysis worker will fail at the extraction step.

---

## 1. Clone and install

```bash
git clone <your-repo-url> knowledge-inbox-zero
cd knowledge-inbox-zero
npm ci          # clean, reproducible install from the lockfile (NOT npm install)
```

> Use `npm ci` (or `make install`), not `npm install`. `npm ci` rebuilds `node_modules` from the lockfile, avoiding half-extracted dependencies that surface as puzzling TypeScript errors. Use `npm install` only when deliberately adding/upgrading a dependency.

---

## 2. Replace the two template placeholders

The repo ships with two tokens that become **AWS resource names**, so they must be replaced before anything deploys correctly:

- `{{PROJECT_NAME}}` -> a lowercase slug (letters, digits, hyphens), e.g. `knowledge-inbox-zero`.
- `{{AWS_REGION}}` -> your region, e.g. `eu-south-2`. **Must be a region where you enabled Bedrock access (step 0).**

> Internal package names use the fixed `@app/*` scope and do **not** need renaming.

**On Windows (PowerShell):**

```powershell
Get-ChildItem -Recurse -File |
  Where-Object { $_.FullName -notmatch '\\(node_modules|\.git|dist|cdk\.out)\\' } |
  ForEach-Object {
    (Get-Content $_.FullName -Raw) `
      -replace '\{\{PROJECT_NAME\}\}','knowledge-inbox-zero' `
      -replace '\{\{AWS_REGION\}\}','eu-south-2' |
      Set-Content $_.FullName
  }
```

**On macOS / Linux (Bash):**

```bash
grep -rl '{{PROJECT_NAME}}' . --exclude-dir=node_modules --exclude-dir=.git \
  | xargs sed -i 's/{{PROJECT_NAME}}/knowledge-inbox-zero/g'
grep -rl '{{AWS_REGION}}' . --exclude-dir=node_modules --exclude-dir=.git \
  | xargs sed -i 's/{{AWS_REGION}}/eu-south-2/g'
```

> On macOS the BSD `sed` needs an empty backup arg: `sed -i '' 's/.../.../g'`.

Sanity-check that no tokens remain:

```bash
grep -rn '{{PROJECT_NAME}}\|{{AWS_REGION}}' . --exclude-dir=node_modules --exclude-dir=.git
```

(No output = good.)

> **Optional — switch the Bedrock model.** If you want a different model than the Claude default, edit the `BEDROCK_MODEL_ID` constant in `infra/cdk/lib/api-stack.ts` (it is env-overridable: `process.env.BEDROCK_MODEL_ID ?? '...'`). Make sure that model is enabled in your region.

---

## 3. Validate the build is green

```bash
make validate            # build shared + lint + css + typecheck + format check + tests
npm test -w @app/infra   # CDK Template.fromStack assertions
```

Direct equivalent without `make`: `npm run validate`.

Everything should pass (104 backend tests, 4 frontend tests, 9 infra assertions). Fix anything red before deploying.

---

## 4. One-time AWS bootstrap

CDK needs a bootstrap stack in your account/region (once per account+region):

```bash
npx cdk bootstrap aws://<ACCOUNT_ID>/eu-south-2
```

If you use temporary credentials from environment variables, you can push them into the default profile with:

```bash
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_SESSION_TOKEN="..."
make aws-credentials
```

---

## 5. Deploy to AWS

```bash
make deploy ENV=test       # deploys all 4 stacks (storage -> auth -> api -> frontend) + syncs frontend
```

What this creates:

- **storage** — DynamoDB tables (`profiles`, `batches`, `documents`) + a private content S3 bucket.
- **auth** — Cognito User Pool with mandatory TOTP MFA.
- **api** — API Gateway HTTP API + ARM64 Node 22 Lambdas (`profile`, `imports`, `documents`, `analysis-worker`, `users`) + the SQS analysis queue and DLQ.
- **frontend** — private S3 bucket + CloudFront distribution.

Useful variants:

```bash
make deploy ENV=prod                     # prod environment
make deploy-backend ENV=test             # CDK only (no frontend sync)
make deploy-frontend ENV=test            # frontend only (build + S3 sync + CloudFront invalidation)
FORCE_DEPLOY=true make deploy ENV=test   # ignore the incremental hash cache
```

> `scripts/deploy.sh` fingerprints git-tracked files and **skips components that have not changed** since the last successful deploy. Use `FORCE_DEPLOY=true` to override.

---

## 6. Create your first user (invite-only Cognito)

```bash
make create-admin EMAIL=you@email.com PASSWORD='Temp.123!' ENV=test
```

Other user commands:

```bash
make create-user  EMAIL=x@email.com PASSWORD='Temp.123!' ROLE=USER ENV=test
make set-password EMAIL=x@email.com PASSWORD='New.Secure123!' ENV=test
```

On first login, Cognito forces a password change and TOTP MFA setup.

---

## 7. Run and test locally

The frontend runs locally against the **real deployed backend** (there is no local Lambda HTTP server in this stack).

```bash
make dev-env ENV=test    # once after deploy: writes frontend/.env from SSM (API URL + Cognito IDs). Needs AWS creds.
make dev                 # Vite dev server with hot reload
```

Open the localhost URL Vite prints, log in with the admin user, finish the password change + MFA, and you are exercising the live stack.

Direct equivalents without `make`: `make dev` is `npm run dev -w frontend`; `make dev-env` runs `scripts/dev-frontend.sh`.

### End-to-end smoke test

1. **Profile** -> fill in interests -> Save.
2. **Add content** -> paste a few URLs (see `examples/sample-urls.txt`) -> Submit. The batch progress polls pending -> processing -> completed and stops when finished.
3. In another terminal, watch the async worker:
   ```bash
   make logs-lambdas ENV=test              # tail all Lambda logs (last 30 min)
   make logs-lambdas ENV=test TYPE=errors  # only errors
   ```
   You should see fetch -> Bedrock extraction -> scoring -> explanation.
4. **Library** -> documents grouped by READ / SKIM / SKIP with the "attention saved" metric; each links to a detail page showing the written explanation (primary) and the numeric scores (secondary).

---

## 8. Backend-only testing (no AWS)

The pure logic and handlers are covered by tests you can run anytime offline:

```bash
make test                  # backend + frontend tests
npm test -w backend        # 104 Jest tests (handlers, scoring, canonicalization, worker)
npm test -w frontend       # 4 Vitest component tests
```

The deterministic core (`@app/shared`: URL canonicalization, MKV scoring) is property-tested with fast-check. The async worker batch-counter conservation, degradation, truncation, and S3 offload are covered by unit/property/integration tests. The analysis worker itself only runs in AWS (it is SQS-triggered), so use `make logs-lambdas` to observe it live.

---

## 9. (Optional) CI/CD via GitHub Actions

`.github/workflows/pipeline.yml` runs `lint -> test -> build` (incl. `cdk synth`) on every push, and deploys to `test` on non-`main` branches and `prod` on `main`, via OIDC (no secrets).

To enable deploys, in your GitHub repo settings create:

- A repository variable `AWS_ROLE_FOR_GITHUB_DEPLOYMENTS` = an IAM role ARN with an OIDC trust to GitHub.
- `test` and `prod` environments.

Until that variable is set, the deploy jobs are **skipped** (not failed), so CI stays green on a fresh clone.

---

## Quick command reference

```bash
make help                               # list every target
make install                            # npm ci
make validate                           # build + lint + typecheck + format + tests
make deploy ENV=test                    # deploy infra + frontend
make create-admin EMAIL=.. PASSWORD=..  # first user
make dev-env ENV=test                   # populate frontend/.env from SSM
make dev                                # run frontend locally
make logs-lambdas ENV=test TYPE=errors  # tail Lambda logs
make clean                              # remove build artifacts
```

---

## Troubleshooting

- **`cdk synth`/deploy fails about Docker** -> Docker Desktop is not running. Start it and retry.
- **Analysis worker fails at extraction** -> Bedrock model access not enabled in the deploy region, or the model id does not exist there. Enable it in Bedrock -> Model access, or change `BEDROCK_MODEL_ID` in `api-stack.ts`.
- **Resource names look like `app-starter-*`** -> the `{{PROJECT_NAME}}` placeholder was not replaced (step 2). `bin/app.ts` falls back to `app-starter` when it sees an unreplaced token.
- **TypeScript errors right after cloning** -> you ran `npm install` instead of `npm ci`; run `make clean && npm ci`.
- **`make: command not found` on Windows** -> use Git Bash or WSL, or run the underlying `npm run ...` scripts directly.
