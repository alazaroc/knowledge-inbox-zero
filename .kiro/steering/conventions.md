# Conventions & Cost Guardrails

Convenciones ganadas con dolor. Mantén cada slice con `make build` + `make validate` verdes.

## Backend handlers (patrón obligatorio, un fichero por dominio)

- Un handler por dominio en `backend/src/handlers/<dominio>.ts`, exportando un único `handler`. NO partir un dominio en varias Lambdas. El dispatch es interno por `event.httpMethod` + path params.
- `authenticate(event)` de `lib/handler-utils`; corta con `'error' in auth`. `ctx.sub` = owner id. V1 sin sharing: autorización = ownership por usuario (solo el owner lee/escribe lo suyo).
- Cuerpos con `parseBody(event, <zodSchema>)`; corta con `'error' in body`.
- Respuestas SOLO con `lib/response` (`ok`, `created`, `noContent`, `badRequest`, `notFound`, `forbidden`, `serverError`). Cuerpo en `try/catch` → `serverError(err)`.
- DynamoDB vía el `ddb` compartido de `lib/dynamo`. Nombres de tabla vía `TABLE_NAMES` de `@app/shared` — nunca hardcodear. Ids/timestamps con `newId()`/`now()` de `lib/ids`.
- Ownership (`ownerId` = Cognito `sub`) en CADA acceso a datos.

## Runtime & módulos

- Node 22, ARM64, ESM. Imports `.ts` locales usan extensión `.js` (`../lib/dynamo.js`). AWS SDK v3; Zod en límites externos.

## Placement (invariante clave)

- Lógica determinista pura (canonicalización, dedup, MKV scoring, state mapping) vive en `@app/shared` → property-tested una vez, reusada por API y worker. No duplicar en handlers.

## Cost guardrails (deterministic-first) — V1

- Bedrock para extracción estructurada, scoring semántico (relevance/novelty/redundancy contra el perfil) y explicación escrita (+ draft de perfil). El resto determinista (freshness, cálculo MKV, ajuste por feedback); prefiere el camino determinista si evita una llamada LLM sin perder output, y mantén el scorer determinista de `@app/shared` como fallback.
- Sin infra always-on ni coste en reposo: nada de ECS/EKS, RDS, OpenSearch Serverless en V1.
- Sin vector DB / embeddings en V1: es Tier B tras el flag `EMBEDDINGS_ENABLED` (default off); el camino por conceptos deterministas es el default.
- DynamoDB PAY_PER_REQUEST, Lambda ARM64, SQS para trabajo multi-doc async. Dimensionado para decenas-cientos de docs por usuario, no millones.
