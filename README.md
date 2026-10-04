<div align="center">

# Knowledge Inbox Zero

**Inbox zero, for your reading list.** Paste the links you keep meaning to read — get back the small subset that actually deserves your attention, and _why_.

It optimizes for **attention saved**, not content stored.

🌐 [Live app](https://inbox.playingaws.com) · 📦 [Install / self-host](INSTALL.md) · 🔌 [MCP & agents](docs/mcp.md)

[![CI/CD Pipeline](https://github.com/alazaroc/knowledge-inbox-zero/actions/workflows/pipeline.yml/badge.svg)](https://github.com/alazaroc/knowledge-inbox-zero/actions/workflows/pipeline.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen)
![AWS Serverless](https://img.shields.io/badge/AWS-serverless-FF9900?logo=amazonaws&logoColor=white)
![Built with Kiro](https://img.shields.io/badge/built%20with-Kiro-5A3FFF)

</div>

> **Not** a bookmark manager, **not** a read-it-later app, **not** an RSS reader. It doesn't help you save more — it helps you read less, on purpose.

## Why

- **Saves attention, not links.** The headline metric is how much reading you can safely skip, not how much you hoarded.
- **Marginal value, per user.** A great article you already understand scores near zero. Worth is relative to _what you already know_.
- **Explained, never a black box.** Every document gets a written reason — the score is supporting detail, not the verdict.
- **Cheap by design.** Deterministic-first and fully serverless: the LLM runs only where it must, and there is no idle cost when nobody is using it.
- **Private.** Every read and write is scoped to the signed-in user.

## Contents

- [The idea: Marginal Knowledge Value](#the-idea-marginal-knowledge-value)
- [How it works](#how-it-works)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Everyday commands](#everyday-commands)
- [Configuration](#configuration)
- [Integrations (MCP & Kiro Power)](#integrations-mcp--kiro-power)
- [Scope](#scope)
- [Community](#community)
- [License](#license)

## The idea: Marginal Knowledge Value

A document's worth is not its objective quality — it's the **additional** value it gives _you_, given what you already know, what you're researching, and what you've already processed. A great article about something you already understand has near-zero marginal value.

Every analyzed document gets:

- A single **recommendation** — shown in the app as **Worth it**, **Maybe**, or **Skip** (internally `READ` / `SKIM` / `SKIP`). A document that couldn't be fetched or extracted is surfaced separately as **Couldn't analyze**.
- A numeric **MKV score** (0–100) built from relevance, novelty, redundancy, and freshness.
- Advisory **tags** — `REDUNDANT`, `OUTDATED`, `REFERENCE`, `FRESH`.
- A written **explanation** (the primary output; scores are supporting detail).

## How it works

1. **Profile** — You describe your knowledge: high/medium interests, what you're currently researching, what you already know, content types to avoid, and optional free-text context.
2. **Add content** — Paste newline-separated URLs (up to 500) as one persistent **batch**. The request returns in under 3 seconds; nothing blocks while URLs are analyzed.
3. **Async analysis** — Each URL is canonicalized, de-duplicated, fetched best-effort, and run through the pipeline. A bad or unreachable URL never fails the batch; it still produces a recommendation from whatever was obtained.
4. **Library** — Documents are grouped by recommendation with per-state counts, and **attention saved** is surfaced as the headline metric. Open any document for its full explanation.

## Screenshots

<!--
  VIDEO: GitHub renders an inline player when you paste a video URL on its own line.
  Easiest way: open a GitHub issue (or a release), drag the .mp4 into the comment box,
  copy the resulting https://user-images.githubusercontent.com/... (or /assets/...) URL,
  and paste it below replacing this comment. Keep it on its own line.
  A ~30–60s clip (add links → batch finishes → open the Library → read one explanation)
  works best. Alternatively, record a GIF into docs/images/demo.gif and reference it with
  the image syntax used below.
-->

> **Demo video coming soon.** _(paste the video URL on its own line here)_

The **Library**, newest and most valuable first, with the headline _attention saved_ metric and per-state counts (Worth it / Maybe / Skip):

![Library — documents grouped by recommendation, with attention saved](docs/images/screenshot-library.png)

<details>
<summary><strong>Document detail — the explanation</strong></summary>

> Each document opens to a written **"why this recommendation"**, in your profile's language, with the recommendation state, actions (to-read, archive, re-analyze), and a quick helpful/not-helpful control.

![Document detail with the written recommendation](docs/images/screenshot-document-detail.png)

</details>

<details>
<summary><strong>Add content — paste URLs, watch the batch</strong></summary>

> Paste newline-separated URLs (or a messy dump — links are pulled out), press **Add to inbox**, and the batch is analyzed in the background. You can keep adding while it runs.

![Add content — paste URLs](docs/images/screenshot-add-content.png)
![Add content — batch progress](docs/images/screenshot-add-content-progress.png)

</details>

<details>
<summary><strong>Knowledge profile — how it decides</strong></summary>

> Your knowledge profile and data sources: type it directly, bring your own file from a repo, or paste a bio/CV to generate a draft. Set the language each explanation is written in.

![Knowledge profile settings](docs/images/screenshot-profile.png)

</details>

## Architecture

Serverless-first on AWS, deterministic-first by design. The LLM is invoked **only** for structured extraction and the written explanation — everything else (canonicalization, dedup, metadata, all MKV math) is pure deterministic code, property-tested once in `@app/shared` and reused by both the API and the worker.

![Knowledge Inbox Zero AWS architecture](docs/assets/architecture.webp)

- **Sync handlers** (256 MB, 10 s): `profile`, `imports`, `documents`, `users`. Deterministic — only `profile` touches Bedrock, and only to draft/sync a profile from imported text.
- **`analysis-worker`** (1024 MB, 120 s, reserved concurrency 5): SQS-triggered, the full per-document pipeline — fetch → [Mozilla Readability](https://github.com/mozilla/readability) extraction → Bedrock structured extraction → MKV scoring → Bedrock explanation → persist → atomic DynamoDB counter updates. The only component that writes extracted content to S3.
- **Storage**: DynamoDB (PAY_PER_REQUEST, one table per entity — `profiles`, `batches`, `documents`, `users`) + a private S3 bucket for extracted content over 300 KB. Private-repo profile tokens live in Secrets Manager (one JSON map, `userSub → PAT`).
- **AI**: Amazon Bedrock, single configurable model via `BEDROCK_MODEL_ID` (default `global.amazon.nova-2-lite-v1:0`, Amazon Nova 2 Lite via the GLOBAL inference profile). No vector DB in V1 — novelty/redundancy are computed deterministically from extracted concepts.

## Tech stack

- **Frontend**: React 18 + Vite 8 + TypeScript + Tailwind 3.4, PWA (`vite-plugin-pwa`, `registerType: "prompt"`), AWS Amplify (Cognito) auth, `react-router-dom` v6. Shared API client with retry + exponential backoff.
- **Backend**: AWS Lambda (Node 22, ARM64) in TypeScript ESM, AWS SDK v3 (DynamoDB, SQS, S3, Bedrock Runtime, Cognito), `zod` validation, `aws-jwt-verify`, `@mozilla/readability` + `jsdom`. One handler per domain.
- **Shared** (`@app/shared`): types, constants, zod schemas, and all pure deterministic MKV logic.
- **Infra** (`infra/cdk`): AWS CDK (`aws-cdk-lib` ^2.258) — `storage` (DynamoDB + content bucket), `auth` (Cognito + TOTP MFA), `api` (HTTP API v2 + Lambdas + SQS/DLQ + Bedrock IAM), `frontend` (private S3 + CloudFront with OAC and security headers).
- **Quality**: ESLint 9, Prettier, Stylelint, husky + lint-staged, Jest (backend, with `fast-check` property tests), Vitest (frontend). CI via GitHub Actions + OIDC.

Default region `eu-south-2` (configurable).

```
.
├── shared/             # @app/shared — types, schemas, pure MKV logic (build first)
├── frontend/           # React SPA — pages: Profile, Add Content, Library, Document Detail
├── backend/            # Lambda handlers: profile, imports, documents, analysis-worker, users
├── infra/cdk/          # CDK stacks: storage, auth, api, frontend
├── mcp-server/         # MCP server (stdio) — thin client of the API
├── power/              # Kiro Power — connect any agent to the hosted app
├── browser-extension/  # Optional MV3 extension — one-click "save this tab" (not deployed)
└── Makefile            # unified command interface
```

## Getting started

> **New here?** [INSTALL.md](INSTALL.md) covers both ways to use the app — the hosted web app (zero setup) or self-hosting on your own AWS account. This is the quick reference.

Prerequisites: Node.js ≥ 22, an AWS account, the AWS CLI configured, the AWS CDK bootstrapped, and Amazon Bedrock model access enabled for the configured model.

```bash
make install                         # npm ci — clean, reproducible install
make build                           # build shared + backend + frontend
```

### Deploy and create your first user

```bash
cdk bootstrap aws://<account>/<region>              # once per account/region
make deploy ENV=prod                                # storage + auth + api + frontend
make create-admin EMAIL=you@email.com PASSWORD='Temp.123!' ENV=prod
```

On first login Cognito requires changing the password and setting up TOTP MFA. User creation is invite-only.

### Run the frontend locally

```bash
make dev-env     # populate frontend/.env from SSM (needs AWS creds; run once after deploy)
make dev         # Vite dev server against the deployed backend
```

## Everyday commands

Run from the repo root — `make help` lists everything.

```bash
make validate                        # build shared + lint + css + typecheck + format + tests
make test                            # backend (Jest) + frontend (Vitest)
make fix                             # auto-fix lint + css + formatting

make deploy ENV=prod                 # infra + frontend (skips unchanged components)
make deploy-backend ENV=prod         # CDK only
make deploy-frontend ENV=prod        # build + S3 sync + CloudFront invalidation

make logs-lambdas ENV=prod TYPE=errors   # tail Lambda logs (MINS=30 default)
make create-user EMAIL=x@email.com PASSWORD='Temp.123!' ROLE=USER ENV=prod
```

`scripts/deploy.sh` fingerprints version-controlled files and skips components that haven't changed (override with `FORCE_DEPLOY=true`).

## Configuration

- `BEDROCK_MODEL_ID` — the Bedrock foundation model (set at deploy time; a redeploy switches models without code changes).
- `EMBEDDINGS_ENABLED` — Tier B semantic novelty via embeddings; defaults to `false`. V1 uses the deterministic concept-based path.

CI runs `lint → test → build` (including `cdk synth`) on every push and deploys to `prod` on `main` via OIDC — no stored secrets. See [INSTALL.md](INSTALL.md) for region/model choices and the `AWS_ROLE_FOR_GITHUB_DEPLOYMENTS` setup.

## Integrations (MCP & Kiro Power)

Knowledge Inbox Zero is usable from any MCP-capable agent — ask it "what should I read?" and it submits your links and reads back the recommendations.

- **MCP server** (`mcp-server/`) — a stdio server that is a **thin client** of the deployed API (it does no scoring itself). Three tools, one endpoint each:

  | Tool                   | Endpoint                  | Purpose                                      |
  | ---------------------- | ------------------------- | -------------------------------------------- |
  | `submit_urls`          | `POST /imports`           | Send URLs for asynchronous analysis.         |
  | `list_recommendations` | `GET /documents[?state=]` | List READ/SKIM/SKIP docs with score + title. |
  | `explain_document`     | `GET /documents/{id}`     | Fetch one doc's explanation, scores, state.  |

  Config is environment-only (`KIZ_API_URL` + a Cognito id token, or email/password). Full reference: [docs/mcp.md](docs/mcp.md).

- **Kiro Power** (`power/`) — packages the above as an installable [Agent Plugin](https://agent-plugins.org/) so any Kiro agent can connect to a hosted instance with no access to this repo.

## Scope

- **V1 (built)**: profile, paste-URL import, async analysis, MKV scoring, recommendation + explanation, persistent library, web UI, per-user privacy.
- **Behind flags (stretch)**: client-side bookmark-HTML import, embeddings-based semantic novelty, section-level guidance, user-selectable Bedrock model.
- **Optional component**: a Manifest V3 [browser extension](browser-extension/README.md) to add links faster — one click saves the current tab to your inbox instead of copy-pasting URLs. Not required to use the app and not deployed with it.
- **Out of scope for V1**: full bookmark manager, reader/highlights/annotations, RSS/newsletter ingestion, mobile apps, collaborative libraries, generic chatbot over the library, knowledge graphs, large-scale vector infrastructure.

## Community

This is a community project, and it's meant to be used — not just looked at.

- **Use it.** Try the [hosted app](https://inbox.playingaws.com), free.
- **Run your own.** It's built to be copied: [self-host it](INSTALL.md#option-b--self-host-on-your-own-aws-account) on your own AWS account in about 20 minutes. Your data stays in your account, and you tune the limits.
- **Make it yours.** Fork it, rebrand it, point the browser extension and MCP server at your instance, swap the Bedrock model — it's all configurable without touching the core.
- **Build it with me.** Ideas, bug reports, and pull requests are genuinely welcome. Open an [issue](https://github.com/alazaroc/knowledge-inbox-zero/issues) or a PR — see [CONTRIBUTING.md](CONTRIBUTING.md). If you ship something on top of it, I'd love to hear about it.

The one rule for new ideas: they should sharpen the core question — _what deserves this user's attention, and why?_ — rather than turn it into a general bookmark manager.

---

Built with [Kiro](https://kiro.dev) — spec-driven, with steering, hooks, MCP, a custom review agent, and property-based tests. See [docs/built-with-kiro.md](docs/built-with-kiro.md) for the full map.

## License

MIT — see [LICENSE](LICENSE).
