# Product

**Read Worthy** reduce agresivamente el backlog de lectura. Dado un montón de URLs y un perfil de conocimiento persistente, identifica el pequeño subconjunto que merece atención y explica, por documento, **qué es materialmente nuevo** y **por qué le importa a ESTE usuario ahora**.

Optimiza **atención ahorrada**, no contenido almacenado. Idea central: **Marginal Knowledge Value (MKV)** — el valor de un doc no es su calidad objetiva sino lo que añade _a este usuario_ dado lo que ya sabe, investiga y ha procesado. Un artículo excelente puede tener MKV casi nulo para quien ya conoce su contenido.

## What it is not

- Not a bookmark manager
- Not a read-it-later app
- Not an RSS reader
- Not a general knowledge base

Every product decision answers one question: **"What deserves this user's attention and why?"**

## Core workflow (V1)

1. The user creates a **knowledge profile**: high/medium interests, currently-researching topics, already-known topics, content types to avoid, and optional free-text context.
2. The user pastes a list of URLs (one per line) into a persistent **batch**. El límite real es una **cuota diaria de 100 URLs nuevas por rol USER** (`DAILY_IMPORT_LIMIT_USER`; ADMIN ilimitado). El exceso NO se descarta en silencio: hard-block que devuelve las URLs sin procesar para reintentar al día siguiente. Duplicados / ya poseídas / rechazadas no consumen cuota.
3. Each URL is canonicalized, de-duplicated, fetched best-effort, and analyzed into structured info (topics, concepts, claims, difficulty, summary).
4. Each document is scored for **Marginal Knowledge Value** against the profile and previously analyzed concepts (relevance, novelty, redundancy, freshness).
5. Each document gets exactly one **recommendation state** (`READ` / `SKIM` / `SKIP`), a numeric MKV score, advisory **tags** (`REDUNDANT`, `OUTDATED`, `REFERENCE`, `FRESH`), and a written **explanation**.
6. The **library** groups documents by recommendation with per-state counts and surfaces **attention saved** as the primary metric; the **detail** view shows the explanation.

## Recommendation taxonomy

- **States** (exactly one per document): `READ`, `SKIM`, `SKIP`.
- **Tags** (orthogonal, advisory, zero or more): `REDUNDANT`, `OUTDATED`, `REFERENCE`, `FRESH`.

## Scope tiers

- **Tier A (V1, built):** profile, paste-URL import, async analysis, per-document MKV scoring, recommendation + explanation, persistent library, web UI (Profile / Add Content / Library / Detail), per-user privacy.
- **Tier B (optional stretch, behind flags):** client-side bookmark-HTML import, embeddings-based semantic novelty (`EMBEDDINGS_ENABLED`, defaults off), section-level read/skip guidance, user-selectable Bedrock model.
- **Tier C (out of scope for V1):** full bookmark manager, reader/highlights/annotations, RSS/newsletter ingestion, mobile apps, browser extensions, social/collaborative libraries, generic chatbot over the library, knowledge graphs, large-scale vector infrastructure.

## Key behaviors to preserve

- **Deterministic-first for cost, hybrid scoring.** Canonicalization, dedup, metadata, freshness, the final MKV calculation and the feedback adjustment are deterministic. Bedrock is invoked for structured extraction, the semantic scoring of relevance/novelty/redundancy against the profile, and the written explanation. A deterministic scorer (`@app/shared`) stays as the fallback when LLM scoring fails or the doc is degraded.
- **Never hold a request open.** Import returns within 3 seconds; all multi-document analysis runs asynchronously via SQS + a worker Lambda. The UI polls batch progress.
- **Graceful degradation.** A bad URL never fails the batch; the system still produces a recommendation from whatever it obtained (even metadata-only).
- **Per-user privacy.** Every read/write is scoped to the authenticated Cognito `sub`.

## Environments & regions

- Environment: `prod` (the `test` environment is retired for now).
- Default region: `eu-south-2` (configurable via the `eu-south-2` placeholder).
- Two template placeholders remain repo-wide: `read-worthy` and `eu-south-2`. Internal package names use the fixed `@app/*` scope and are not renamed.
