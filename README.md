<div align="center">

# Knowledge Inbox Zero

**Inbox zero, for your reading list.** Paste the links you keep meaning to read — get back the few that actually deserve your attention, and _why_.

It optimizes for **attention saved**, not content stored.

🌐 [Live app](https://inbox.playingaws.com) · 📦 [Self-host](INSTALL.md) · 🔌 [MCP & agents](docs/mcp.md)

[![CI/CD Pipeline](https://github.com/alazaroc/knowledge-inbox-zero/actions/workflows/pipeline.yml/badge.svg)](https://github.com/alazaroc/knowledge-inbox-zero/actions/workflows/pipeline.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen)
![AWS Serverless](https://img.shields.io/badge/AWS-serverless-FF9900?logo=amazonaws&logoColor=white)
![Built with Kiro](https://img.shields.io/badge/built%20with-Kiro-5A3FFF)

</div>

> **Not** a bookmark manager, **not** a read-it-later app, **not** an RSS reader. It doesn't help you save more — it helps you read less, on purpose.

## Try it

No install, no setup. **[Open the app](https://inbox.playingaws.com)**, sign up with your email, and paste a few links.

## What makes it different

Most apps judge a link on its own merits. This one judges it against **you**. You describe once what you already know, what you're learning, and what you care about — and from then on every link is scored by what it actually adds _to you_. A great article about something you already understand adds nothing new, so it gets skipped.

Each analyzed link comes back with:

- a verdict — **Worth it**, **Maybe**, or **Skip**;
- a **Marginal Knowledge Value** score (0–100), from relevance, novelty, redundancy, and freshness;
- a short written **reason** — never an opaque score.

## How it works

1. **Describe what you know** — interests, what you're researching, what you already master.
2. **Paste your links** — up to 500 at once; they're analyzed in the background, nothing blocks.
3. **Read only what counts** — your library, newest and most valuable first, with _attention saved_ as the headline metric.

## See it

▶️ **[Watch the 3-minute demo](https://youtu.be/w5zU5v465N4)** — profile, import, library, browser extension, and an agent driving it over MCP.

![The library: links scored and sorted most valuable first, each with a verdict, a reason, and an MKV score](docs/images/screenshot-library.png)

## Built on AWS, fully serverless

Deterministic-first by design: the LLM is used **only** for extraction and the written explanation — all the scoring is pure, reproducible code. No idle cost when nobody's using it.

![Knowledge Inbox Zero AWS architecture](docs/assets/architecture.webp)

- **Frontend** — React + Vite + Tailwind PWA, Cognito auth, on S3 + CloudFront.
- **Backend** — TypeScript Lambdas (Node 22, ARM64), API Gateway HTTP API, SQS + a worker for async analysis, DynamoDB, S3, Amazon Bedrock.
- **Infra** — all of it as AWS CDK, one command to deploy.

## Use it from an agent (MCP)

Knowledge Inbox Zero speaks [MCP](docs/mcp.md), so any agent (Kiro, Claude Desktop…) can use it: _"add these links to my inbox"_, _"what should I read?"_, _"why is this one a skip?"_. A custom MCP server exposes three tools (`submit_urls`, `list_recommendations`, `explain_document`), and a [Kiro Power](power/) packages it so an agent can connect with no access to this repo.

## Save a page while you browse

An optional [browser extension](browser-extension/README.md) adds a one-click button that sends the page you're reading straight to your inbox — no copy-pasting URLs. Manifest V3, works in Chrome, Brave, Edge, and Firefox.

## Run it yourself

It's open source and built to be copied — self-host it on your own AWS account in about 20 minutes. See **[INSTALL.md](INSTALL.md)** to deploy and **[CONTRIBUTING.md](CONTRIBUTING.md)** to hack on it. Issues and PRs are welcome.

---

Built with [Kiro](https://kiro.dev) — spec-driven, with steering, hooks, MCP, a custom review agent, and property-based tests. · MIT License.
