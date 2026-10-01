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
