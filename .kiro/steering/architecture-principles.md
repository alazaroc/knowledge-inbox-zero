# Architecture Principles

## Product

Knowledge Inbox Zero optimizes for attention saved, not content accumulated.

It is not:

- a bookmark manager
- a read-it-later app
- an RSS reader
- a general knowledge base

Every product decision should support:
"What deserves this user's attention and why?"

## AWS Architecture

- Serverless-first.
- Prefer existing architecture from the repository.
- Prefer Lambda, DynamoDB, S3, API Gateway, CloudFront and Bedrock.
- Avoid infrastructure with meaningful idle cost.
- Do not introduce RDS, ECS, EKS or OpenSearch without explicit justification.
- Prefer asynchronous processing for multi-document imports.
- Keep infrastructure reproducible through CDK.

## Engineering

- TypeScript strict typing.
- Zod at external boundaries.
- Reuse existing repository patterns.
- Keep npm run validate green.
- Avoid unnecessary dependencies.
- Build vertically rather than implementing all backend layers first.

## AI

- Amazon Bedrock is the default AI platform.
- AI outputs must use structured schemas.
- Deterministic logic should be preferred where appropriate.
- Recommendations must be explainable.
- Do not rely solely on an opaque LLM score.

## Bedrock in eu-south-2 (gotchas that caused real bugs)

- In **eu-south-2** Nova/Claude are **not** invokable on-demand directly: they
  require an **inference profile** (`eu.amazon.*` / `eu.anthropic.*`). Verify with
  `aws bedrock list-foundation-models` (inferenceTypesSupported) +
  `list-inference-profiles` before fixing a `BEDROCK_MODEL_ID`.
- An **EU inference profile routes inference to ANY of its regions** for load
  balancing (e.g. `nova-2-lite` routes to eu-south-2, eu-south-1, eu-west-1,
  eu-west-3, eu-central-1, eu-north-1). The invoking role's IAM policy **MUST**
  include the `foundation-model` ARN of **all** those regions, or it fails with
  intermittent `AccessDenied` depending on where it routes that day. **Fix:** use
  a region wildcard scoped to the model —
  `arn:aws:bedrock:eu-*::foundation-model/<foundationModelId>` (safe; the `::` is
  owner-account-only). Diagnose with
  `get-inference-profile --query models[].modelArn` to see the real regions.
- A silently-degraded worker (fetch OK, extraction OK with admin creds, but the
  Lambda degrades the same input) usually means the **Lambda execution role**,
  not the code. Add structured logging at the failure points and persist the real
  `failureReason` rather than diagnosing blind from outside.
