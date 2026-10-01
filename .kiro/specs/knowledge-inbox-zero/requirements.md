# Requirements Document

## Introduction

**Knowledge Inbox Zero** is a tool that aggressively reduces a user's knowledge/reading backlog. It is **not** a read-it-later app, **not** a bookmark manager, and **not** another place to store content. Given a messy backlog of URLs and a persistent personal knowledge profile, the app identifies the small subset of documents that genuinely deserve the user's attention and explains, in plain language, **what is materially new** and **why it matters to this specific user right now**.

The product optimizes for **attention saved**, not content stored. Its central idea is **Marginal Knowledge Value**: a document's worth is not its objective quality but the additional value it provides _to this user_, given what they already know, what they are researching, and what they have already processed. A well-written, high-quality article can have near-zero marginal value to a user who already knows its content.

This spec is built on top of a reused serverless-monorepo-aws-starter (npm workspaces: `shared/`, `frontend/`, `backend/`, `infra/cdk`) and inherits its conventions intentionally: Cognito invite-only auth with ADMIN/USER roles and per-user ownership, one DynamoDB table per entity (PAY_PER_REQUEST + GSIs), one Lambda handler per domain (Node 22 ARM64 ESM, AWS SDK v3, Zod validation, `aws-jwt-verify`), API Gateway HTTP API v2, S3+CloudFront frontend, and vertical-slice development that keeps `npm run build` and `npm run validate` green at every task. The example `Item` entity is replaced by this domain.

---

## Critical Analysis of the Product Description

The workflow explicitly requested a critical read of the product idea before committing to scope. The findings below drive the three-tier scope separation and the open decision points.

### Ambiguities identified

1. **Recommendation taxonomy is too granular.** Six states (READ, SKIM, REFERENCE, REDUNDANT, OUTDATED, DISCARD) overlap semantically. REDUNDANT, OUTDATED, and DISCARD all resolve to "do not spend attention here"; REFERENCE and SKIM both mean "partial attention." A user glancing at a library needs an obvious next action, not a taxonomy quiz. **Recommendation: ship a smaller core taxonomy in V1 and treat the distinctions as explanatory tags.** Tracked as Open Decision Point OD-1.
2. **"Novelty vs previously analyzed docs" implies cross-document similarity, which pulls toward embeddings/vectors.** The description also says avoid a vector database in V1. These are in tension. **Recommendation: define novelty deterministically over extracted concepts/topics for V1**, and treat embeddings as OPTIONAL stretch. Tracked as OD-2.
3. **"Retrieve readable content" is unbounded.** Arbitrary URLs include paywalls, JS-only pages, PDFs, dead links, login walls, and huge pages. Treating full extraction as REQUIRED risks an unpolished V1. **Recommendation: require graceful degradation** — the app must produce a recommendation from whatever it obtained (even metadata-only) and must never hang the batch on one bad URL.
4. **Async mechanism is presented as a design choice but leaks into requirements.** Step Functions vs SQS is a design decision. Requirements should only mandate the observable behavior: no long-open request, asynchronous progress, resilience. Tracked as OD-3.
5. **"Embeddings only where useful" and "model selection configurable where practical" are escape clauses.** Rewritten into testable, bounded requirements below.

### Unnecessary complexity to defer

- Client-side bookmark HTML parsing (nice, but not needed to prove the hypothesis) → OPTIONAL.
- Section-level "read this / skip that" guidance → OPTIONAL (depends on reliable structural extraction).
- Cross-document redundancy clustering → OPTIONAL; V1 can compare a document against the user's _known_ profile and previously analyzed concepts without vector search.

### Minimum end-to-end workflow that proves the hypothesis

> _Given a messy backlog of links and a personal knowledge profile, can the app identify the small subset that deserves the user's attention and clearly explain what is new and why it matters to them?_

The minimum path is:

1. User creates a knowledge profile (interests, currently-researching, already-known, avoid).
2. User pastes a list of URLs → one persistent **batch**.
3. Each URL is canonicalized, de-duplicated, fetched (best-effort), and analyzed into structured info.
4. Each document is scored for Marginal Knowledge Value against the profile + previously analyzed concepts.
5. Each document receives a recommendation, a score, and a written explanation (why it matters / what is new / what can be skipped).
6. The library view shows the subset worth reading with per-recommendation counts; the detail view shows the explanation.

Everything outside this path is OPTIONAL or POST-CHALLENGE.

---

## Three-Tier Scope Separation

### Tier A — REQUIRED for V1 (proves the hypothesis)

- A1. Persistent, editable personal knowledge profile (interests by priority, currently-researching, already-known, content types to avoid, optional free-text context).
- A2. Backlog import by pasting many URLs (one per line) into a persistent batch with live counts (total/pending/processing/completed/failed).
- A3. Asynchronous processing that never holds an API request open while URLs analyze; the UI stays usable during processing.
- A4. Per-document processing: URL canonicalization, duplicate detection, best-effort content retrieval, metadata extraction, structured extraction (topics, concepts, claims, difficulty, summary).
- A5. Marginal Knowledge Value scoring against profile + previously analyzed concepts (relevance, novelty, redundancy, freshness).
- A6. A recommendation state + numeric score + written explanation per document.
- A7. Persistent library (profile, batches, documents, analysis, processing state) in DynamoDB, with extracted raw content offloaded to S3 when it exceeds DynamoDB item limits.
- A8. Web UI: Profile, Add Content, Library (grouped/filterable by recommendation with per-state counts), Document Detail.
- A9. Per-user privacy and isolation (Cognito ownership pattern); no personal data committed to the repo.

### Tier B — OPTIONAL stretch (V1 if time allows)

- B1. Import a standard browser bookmarks HTML file, extracting URLs **client-side**.
- B2. Embeddings + semantic novelty/redundancy across the analyzed library.
- B3. Section-level "read this / skip that" guidance when structural extraction is reliable.
- B4. Configurable Bedrock model selection surfaced to the user.

### Tier C — POST-CHALLENGE (explicit non-goals for V1)

Full bookmark manager, read-it-later reader, highlights, annotations, RSS/newsletter ingestion, mobile apps, browser extensions, social/sharing/collaborative libraries, generic chatbot over the library, complex knowledge graphs, and large-scale vector infrastructure are all **out of scope for V1**.

---

## Glossary

- **Marginal Knowledge Value (MKV)**: The additional knowledge a Document provides to a specific User, given the User's Profile and the concepts present in the User's previously analyzed Documents. Distinct from general content quality.
- **Canonicalization**: The deterministic transformation of a raw URL into a single normalized form (lowercased scheme/host, removed default ports, sorted/stripped tracking query parameters, removed fragments, normalized trailing slash) used for duplicate detection.
- **Canonical_URL**: The output of Canonicalization for a given raw URL.
- **Import** / **Batch**: A persistent set of URLs submitted together for analysis, carrying aggregate progress counts (total, pending, processing, completed, failed).
- **Document**: A single canonicalized URL owned by a User, together with its extracted content, metadata, analysis results, and processing state.
- **Profile**: The User's persistent, editable knowledge profile (high/medium interests, currently-researching topics, already-known topics, content types to avoid, optional free-text context).
- **Relevance**: A score expressing how well a Document's topics/concepts align with the User's interests and currently-researching topics.
- **Novelty**: A score expressing how much of a Document's content is NOT already covered by the User's already-known topics and the concepts of the User's previously analyzed Documents.
- **Redundancy**: A score expressing how much of a Document's content is already covered by the User's known topics and previously analyzed Documents. Conceptually the complement of Novelty.
- **Freshness**: A score derived from a Document's publication date and topic volatility; recency increases Freshness, age alone never increases it.
- **Recommendation_State**: The discrete decision assigned to a Document (see OD-1 for the V1 taxonomy).
- **Attention_Saved**: The count/proportion of Documents the app determined do NOT deserve the User's attention, surfaced in the UI as the primary success metric.
- **Analysis_System**: The backend component that performs canonicalization, extraction, and MKV scoring.
- **Import_System**: The backend component that accepts URL lists and manages Batches.
- **Profile_System**: The backend component that stores and serves the User's Profile.
- **Library_System**: The backend component that serves persisted Documents, batches, and counts.
- **Web_App**: The frontend web application.

---

## Requirements

### Requirement 1: Personal Knowledge Profile (Tier A)

**User Story:** As a knowledge worker, I want a persistent, editable knowledge profile, so that recommendations are personalized to what I already know and care about.

#### Acceptance Criteria

1. WHEN an authenticated User saves a Profile, THE Profile_System SHALL persist high-priority interests, medium-priority interests, currently-researching topics, already-known topics, and content types to avoid, each as a list of at most 100 entries where each entry is a non-empty string of at most 200 characters after trimming leading and trailing whitespace, together with an optional free-text context field.
2. WHEN an authenticated User requests their Profile, THE Profile_System SHALL return the most recently saved Profile for that User.
3. WHEN an authenticated User updates their Profile, THE Profile_System SHALL replace all stored Profile fields with the submitted values and record a server-generated last-updated timestamp expressed in UTC.
4. IF a User has no saved Profile, THEN THE Profile_System SHALL return a Profile in which every list field is empty, the context field is empty, and a not-yet-configured indicator is set to true.
5. IF a Profile submission contains a free-text context field longer than 5000 characters after trimming leading and trailing whitespace, THEN THE Profile_System SHALL reject the entire submission without persisting any change and return a validation error identifying the context field.
6. THE Profile_System SHALL restrict every Profile read and write to the Profile of the authenticated User making the request.
7. WHEN an authenticated User saves a Profile, THE Profile_System SHALL trim leading and trailing whitespace from every list entry and discard any entry that is empty after trimming.
8. IF a Profile submission contains any list field exceeding 100 entries, or any list entry exceeding 200 characters after trimming, THEN THE Profile_System SHALL reject the entire submission without persisting any change and return a validation error identifying the offending field.
9. WHEN two updates to the same User's Profile are received concurrently or with indistinguishable client timestamps, THE Profile_System SHALL resolve the conflict using server-side arrival order (the request-received timestamp or a monotonic sequence assigned on the server) as the sole tie-breaker, SHALL retain the values from the update the server processes last, and SHALL reflect those values in subsequent reads.

### Requirement 2: Backlog Import by Pasted URLs (Tier A)

**User Story:** As a user with a messy backlog, I want to paste many URLs at once, so that I can submit my whole backlog as one batch.

#### Acceptance Criteria

1. WHEN an authenticated User submits a newline-separated list of URLs, THE Import_System SHALL normalize each line by removing leading and trailing whitespace, discarding blank lines and lines containing only whitespace, and SHALL create one persistent Batch owned by that User from the remaining lines.
2. WHEN a Batch is created, THE Import_System SHALL initialize the aggregate counts total, pending, processing, completed, and failed for that Batch, where total equals the number of accepted entries plus rejected entries, pending equals the number of accepted entries, and processing, completed, and failed each equal 0.
3. IF a submission contains zero non-blank lines after normalization, THEN THE Import_System SHALL reject the submission without creating a Batch and SHALL return an error indicating that no URLs were provided.
4. IF a normalized line is not a syntactically valid URL, THEN THE Import_System SHALL exclude that line from the Batch and SHALL record it as a rejected entry with a rejection reason indicating an invalid URL, while continuing to process all remaining lines in the same submission.
5. WHEN a normalized line lacks a URL scheme but is otherwise a syntactically valid host-and-path, THE Import_System SHALL prepend the https scheme before deriving the Canonical_URL.
6. WHEN two or more accepted entries within one submission resolve to the same Canonical_URL, THE Import_System SHALL create a single Document for that Canonical_URL and SHALL count the duplicate entries as accepted without creating additional Documents.
7. IF a submission contains more than 500 URLs after normalization, THEN THE Import_System SHALL reject the submission without creating a Batch and SHALL return an error stating that the per-batch limit of 500 URLs was exceeded.
8. WHERE the User has previously imported a URL with the same Canonical_URL, THE Import_System SHALL reuse the existing Document rather than creating a duplicate.

### Requirement 3: Asynchronous Processing and Progress (Tier A)

**User Story:** As a user importing dozens of links, I want analysis to run in the background, so that the app stays responsive and I can watch progress.

#### Acceptance Criteria

1. WHEN a User submits a Batch, THE Import_System SHALL return a response acknowledging the Batch within 3 seconds without waiting for any Document analysis to complete.
2. IF a Batch submission contains zero accepted entries, THEN THE Import_System SHALL reject it without starting asynchronous processing.
3. WHILE a Batch is processing, THE Analysis_System SHALL update the Batch counts within 5 seconds of each Document transitioning between pending, processing, completed, and failed.
4. WHILE a Batch is processing, THE Web_App SHALL remain interactive and SHALL allow the User to view already-completed Documents.
5. WHILE a Batch has not reached a terminal state, THE Web_App SHALL poll Batch progress at an interval of 5 seconds or less.
6. IF analysis of one Document fails, THEN THE Analysis_System SHALL mark that Document failed with a recorded failure reason and SHALL continue processing the remaining Documents in the Batch.
7. WHERE a Document analysis fails from a transient error, THE Analysis_System SHALL retry the Document up to 3 times before marking it failed.
8. WHEN every Document in a Batch has reached completed or failed, THE Analysis_System SHALL mark the Batch finished within 5 seconds.
9. IF a Document remains in processing beyond a configured timeout of 120 seconds, THEN THE Analysis_System SHALL mark that Document failed with a timeout reason.
10. WHEN every Document in a Batch has failed, THE Analysis_System SHALL still mark the Batch finished and SHALL reflect a failed count equal to total.

### Requirement 4: Per-Document Analysis (Tier A)

**User Story:** As a user, I want each link analyzed for what it actually contains, so that recommendations rest on real content, not guesses.

#### Acceptance Criteria

1. WHEN a Document is processed, THE Analysis_System SHALL compute the Document's Canonical_URL by lowercasing the scheme and host, removing default ports, removing tracking query parameters, removing URL fragments, and removing a trailing slash from the path, before any retrieval or scoring.
2. WHEN readable content is retrieved for a Document, THE Analysis_System SHALL extract a title, and SHALL extract author, source domain, and publication date for each of those fields that is present in the retrieved content, and SHALL leave any field absent from the content unset without failing the analysis.
3. WHEN readable content is available, THE Analysis_System SHALL invoke the Bedrock LLM to extract structured information consisting of topics, concepts, important claims, a difficulty/depth level selected from a fixed enumerated set, and a summary of at most 500 characters.
4. WHEN the Analysis_System retrieves content for a Document, THE Analysis_System SHALL abort retrieval if no response is received within 15 seconds and SHALL treat the abort as a retrieval failure.
5. IF content retrieval fails, times out, returns a non-HTML or non-text content type that cannot be parsed to readable text, returns a dead or unreachable link, or yields no readable text after parsing, THEN THE Analysis_System SHALL record the specific failure reason, SHALL mark the analysis with a Degraded state indicator, and SHALL still produce a recommendation using available metadata.
6. WHERE the retrieved readable text exceeds 200,000 characters, THE Analysis_System SHALL truncate the text to 200,000 characters before invoking the LLM and SHALL record that truncation occurred.
7. WHERE extracted raw or readable content exceeds 300 KB, THE Analysis_System SHALL store that content in S3 and SHALL persist only its S3 reference and the analysis results in DynamoDB.
8. THE Analysis_System SHALL perform canonicalization, duplicate detection, and metadata extraction using deterministic processing only, and SHALL invoke the Bedrock LLM only for structured extraction and MKV explanation.

### Requirement 5: Marginal Knowledge Value Scoring (Tier A)

**User Story:** As a user, I want each document scored by how much it adds to what I already know, so that I spend attention only where it pays off.

#### Acceptance Criteria

1. WHEN a Document is analyzed, THE Analysis_System SHALL compute a Relevance score, a Novelty score, a Redundancy score, and a Freshness score, each as an integer within the inclusive range 0 to 100.
2. WHEN scoring a Document, THE Analysis_System SHALL evaluate the Document against the User's current Profile and the set of concepts extracted from the User's previously analyzed Documents, using deterministic scoring such that re-scoring the identical Document against the identical Profile and identical previously analyzed concept set produces identical scores.
3. IF a Document's concepts are all present in the User's already-known concept set, THEN THE Analysis_System SHALL assign a Redundancy score of at least 80.
4. IF a Document's Canonical_URL exactly matches a previously analyzed Document, THEN THE Analysis_System SHALL assign a Redundancy score of at least 90.
5. THE Analysis_System SHALL compute an overall MKV priority score as an integer within the inclusive range 0 to 100 that is non-decreasing as Relevance increases, non-decreasing as Novelty increases, and non-increasing as Redundancy increases, with all other score inputs held constant.
6. THE Analysis_System SHALL compute Novelty and Redundancy such that, with all other inputs held constant, any change that increases Redundancy does not increase Novelty and any change that increases Novelty does not increase Redundancy.
7. WHEN one or more previously-unknown concepts are added to the User's already-known concept set and the Document is re-scored, THE Analysis_System SHALL assign a Novelty score that is less than or equal to the Novelty score computed before those concepts were added, with all other inputs held constant.
8. THE Analysis_System SHALL compute Freshness such that, for two Documents identical in all scoring inputs except publication date, the Document with the older publication date receives a Freshness score less than or equal to that of the newer Document.
9. IF a publication date is unavailable for a Document, THEN THE Analysis_System SHALL assign a Freshness score of 50 and SHALL record a flag indicating that Freshness was estimated.

### Requirement 6: Recommendation and Explanation (Tier A)

**User Story:** As a user, I want a clear recommendation and a written explanation per document, so that I trust the app's judgment without re-reading everything.

#### Acceptance Criteria

1. WHEN a Document's scores are computed, THE Analysis_System SHALL assign exactly one Recommendation_State from the V1 taxonomy (see OD-1).
2. WHEN a Recommendation_State is assigned, THE Analysis_System SHALL produce a written explanation of between 50 and 1500 characters that contains all three of the following elements: (a) why the Document matters to this User, (b) what is genuinely new to this User, and (c) the reason the assigned Recommendation_State was chosen.
3. WHERE a Document is assigned a Recommendation_State indicating it should be read or skimmed and the Document exposes identifiable section or heading structure, THE Analysis_System SHALL list at least one section or concept that deserves attention and, where any exist, at least one section or concept that can be skipped.
4. IF a Document is assigned a Recommendation_State indicating it should be read or skimmed but the Document exposes no identifiable section or heading structure, THEN THE Analysis_System SHALL state in the explanation that section-level attention guidance is not available.
5. WHERE a Document is assigned a Recommendation_State indicating it is redundant or should be discarded, THE Analysis_System SHALL state explicitly in the explanation that no materially new content was detected relative to the User's prior Documents.
6. IF explanation generation fails or produces content shorter than 50 characters, THEN THE Analysis_System SHALL retain and persist the Recommendation_State and scores computed before the failure alongside a placeholder explanation indicating that the written explanation is unavailable, SHALL keep those retained scores and Recommendation_State retrievable rather than discarding the analysis result pending retry, and SHALL surface an indication to the User that the explanation could not be generated.
7. THE Analysis_System SHALL persist the written explanation alongside the Recommendation_State and scores so that it is retrievable without re-analysis.
8. THE Analysis_System SHALL present the written explanation as the primary output and the numeric scores as secondary supporting detail.

### Requirement 7: Persistent Library (Tier A)

**User Story:** As a user, I want my profile, imports, and analyses saved, so that my library persists across sessions.

#### Acceptance Criteria

1. THE Library_System SHALL persist Profiles, Batches, Documents, analysis results, and processing state in DynamoDB using the one-table-per-entity convention such that all persisted entities remain retrievable in subsequent sessions after the originating session ends.
2. WHEN a User requests their library, THE Library_System SHALL return the User's Documents grouped by Recommendation_State, including a count per Recommendation_State and a total analyzed count computed over the entire owned Document set regardless of pagination, and SHALL return a zero count for every defined Recommendation_State that contains no Documents.
3. IF a User requests their library and the User owns zero Documents, THEN THE Library_System SHALL return an empty Document collection with a total analyzed count of 0 and a count of 0 for every defined Recommendation_State.
4. WHEN a User filters the library by a Recommendation_State, THE Library_System SHALL return only Documents owned by that User that are in the specified Recommendation_State, and SHALL return an empty collection when no owned Documents match that state.
5. IF a User filters the library by a value that is not a defined Recommendation_State, THEN THE Library_System SHALL reject the request and return an error indicating the requested state is invalid, without returning any Documents.
6. THE Library_System SHALL restrict every read of Documents, Batches, and Profiles to those owned by the authenticated User, and SHALL exclude from every response any entity owned by a different User.
7. WHEN a User requests their library and the number of owned Documents exceeds 100, THE Library_System SHALL limit only the returned page of Documents to at most 100 per response and SHALL include a continuation token that retrieves the next set of results, while the per-Recommendation_State counts and grouping from criterion 2 SHALL continue to reflect the entire owned Document set regardless of pagination.
8. WHEN a User requests a Document's detail, THE Library_System SHALL return its metadata, summary, scores, Recommendation_State, and explanation.
9. IF a User requests the detail of a Document that does not exist or is not owned by the authenticated User, THEN THE Library_System SHALL reject the request and return an error indicating the Document is not accessible, without returning any Document data.

### Requirement 8: Web UI Views (Tier A)

**User Story:** As a user, I want a simple web UI that shows me what to read and how much attention I saved, so that I reach inbox zero.

#### Acceptance Criteria

1. THE Web_App SHALL provide a Profile view to create and edit the Profile.
2. WHEN the User opens the Profile view and no Profile exists, THE Web_App SHALL display an empty state prompting the User to create a Profile and SHALL present the Profile creation controls.
3. THE Web_App SHALL provide an Add Content view that accepts pasted, newline-separated URLs and submits them as one Batch.
4. IF the submitted Add Content input contains no valid URL, THEN THE Web_App SHALL reject the submission, retain the entered text, and display an error message indicating that at least one valid URL is required.
5. THE Web_App SHALL provide a Library view that lists analyzed Documents grouped and filterable by Recommendation_State with a per-state summary count.
6. WHEN the User opens the Library view and no analyzed Documents exist, THE Web_App SHALL display an empty state indicating no Documents are available, and SHALL NOT display any per-state Document list.
7. WHILE the Library view is retrieving Documents from the backend API, THE Web_App SHALL display a loading indicator.
8. IF the Library view request to the backend API fails after all retry attempts are exhausted, THEN THE Web_App SHALL display an error message indicating the load failed and SHALL provide a control to retry the request.
9. THE Web_App SHALL provide a Document Detail view showing what the content says, what is relevant to the User, what is new to the User, the reason for the recommendation, and what can be ignored.
10. THE Web_App SHALL surface Attention_Saved as a prominent summary rather than emphasizing total content stored.
11. WHILE a Batch is processing, THE Web_App SHALL display live Batch progress counts and SHALL refresh those counts at an interval of 5 seconds or less, and WHEN the Batch reaches a terminal state THE Web_App SHALL stop refreshing and polling the progress counts entirely rather than continuing to poll at the same interval.
12. WHEN the Web_App calls the backend API, THE Web_App SHALL use the shared API client with retry and backoff.

### Requirement 9: Bookmark HTML Import (Tier B — Optional)

**User Story:** As a user with browser bookmarks, I want to import a bookmarks HTML file, so that I do not have to paste URLs manually.

#### Acceptance Criteria

1. WHERE the User uploads a standard browser bookmarks HTML file, THE Web_App SHALL extract the URLs client-side and SHALL NOT upload the file to the backend.
2. WHEN URLs are extracted from a bookmarks HTML file, THE Web_App SHALL submit them through the same Batch mechanism used for pasted URLs.
3. IF the uploaded file is not a recognized bookmarks HTML format, THEN THE Web_App SHALL reject it with a message stating the expected format.

### Requirement 10: Semantic Novelty via Embeddings (Tier B — Optional)

**User Story:** As a user, I want novelty judged by meaning rather than keywords, so that near-duplicate content is detected even when worded differently.

#### Acceptance Criteria

1. WHERE embeddings are enabled, THE Analysis_System SHALL compute an embedding for each analyzed Document and SHALL use it to refine Novelty and Redundancy against previously analyzed Documents.
2. WHERE embeddings are disabled, THE Analysis_System SHALL compute Novelty and Redundancy deterministically from extracted concepts without any vector store.
3. IF embedding computation fails for a Document, THEN THE Analysis_System SHALL fall back to concept-based scoring and SHALL record that embeddings were unavailable.

---

## Correctness Properties (for Property-Based Testing)

These invariants MUST hold for all valid inputs and are strong candidates for property-based tests. The deterministic ones (canonicalization, duplicate detection, score bounds, monotonicity) are especially suitable.

- **CP-1 — Score bounds:** For every analyzed Document, Relevance, Novelty, Redundancy, Freshness, and the overall MKV score each remain within the inclusive range 0 to 100.
- **CP-2 — Idempotent canonicalization:** For any raw URL `u`, `canonicalize(canonicalize(u)) == canonicalize(u)`, and canonicalizing the same input always yields the same output.
- **CP-3 — No duplicate documents:** Importing the same Canonical_URL for the same User, whether within one Batch or across Batches, never creates more than one Document for that Canonical_URL.
- **CP-4 — Exact duplicates are not low-redundancy:** A Document whose Canonical_URL exactly matches a previously analyzed Document cannot receive a Redundancy score below a defined high threshold (≥ 90).
- **CP-5 — Redundant implies not maximally novel:** A Document marked fully redundant cannot simultaneously carry maximum Novelty unless an explicit, documented override reason is recorded.
- **CP-6 — Age never improves freshness:** For two Documents identical in all inputs except publication date, the older Document's Freshness score is never higher than the newer one's.
- **CP-7 — Knowing more never increases novelty:** Adding concepts to a User's already-known topics, with all other inputs unchanged, never increases a Document's Novelty score (Novelty is monotonically non-increasing in known concepts).
- **CP-8 — Novelty/redundancy complementarity:** For any Document, Novelty and Redundancy move in opposite directions; increasing detected overlap never increases Novelty.
- **CP-9 — Single recommendation state:** Every analyzed Document has exactly one Recommendation_State at any time.
- **CP-10 — Batch count conservation:** For any Batch, pending + processing + completed + failed always equals total, and total never changes after Batch creation.
- **CP-11 — Round-trip persistence:** Analysis results written to and read back from storage produce an equivalent object (no field loss for scores, state, or explanation).

---

## Non-Functional Requirements

### NFR-1 — Serverless and Cost

1. THE system SHALL use only serverless, on-demand AWS services (Lambda, DynamoDB PAY_PER_REQUEST, S3, API Gateway HTTP API v2, CloudFront, and asynchronous orchestration) and SHALL avoid always-on compute, ECS/EKS, RDS, and OpenSearch Serverless in V1.
2. THE Analysis_System SHALL use Amazon Bedrock on-demand as the default AI platform and SHALL NOT implement multi-provider abstraction in V1.
3. WHERE an LLM call can be avoided by deterministic processing without loss of required output, THE Analysis_System SHALL use the deterministic path to limit cost.
4. THE system SHALL be sized for tens to hundreds of Documents per User, not millions.

### NFR-2 — Asynchronous Boundary

1. THE API SHALL NOT hold a synchronous request open while multiple Documents are analyzed; all multi-Document analysis SHALL run asynchronously.

### NFR-3 — Privacy and Data Handling

1. THE system SHALL treat Profiles, imported URLs, extracted content, and analysis results as private per-User data isolated by the Cognito ownership pattern.
2. THE repository SHALL NOT contain any real personal Profile, URL list, analysis history, or extracted content; example/demo data SHALL be provided separately and clearly marked.
3. THE system SHALL restrict every data access to the authenticated owning User, consistent with the existing per-user ownership convention.

### NFR-4 — Consistency with Existing Foundation

1. THE backend SHALL follow the one-Lambda-handler-per-domain, Node 22 ARM64 ESM, AWS SDK v3, and Zod-validation conventions already in the repo.
2. THE shared types, constants, and Zod schemas SHALL live in `@app/shared`.
3. Each implementation increment SHALL keep `npm run build` and `npm run validate` green and remain deployable (vertical-slice development).

### NFR-5 — Resilience

1. IF an external URL is unreachable, paywalled, or non-HTML, THEN THE Analysis_System SHALL degrade gracefully and SHALL NOT fail the enclosing Batch.

---

## Open Decision Points

These are deliberately deferred to the design phase and flagged for a decision.

- **OD-1 — Recommendation taxonomy naming.** The description proposes six states (READ, SKIM, REFERENCE, REDUNDANT, OUTDATED, DISCARD). Analysis suggests a simpler core may serve users better (e.g., READ / SKIM / SKIP, with REDUNDANT/OUTDATED/REFERENCE expressed as explanatory tags on SKIP). **Decision needed:** adopt the six-state taxonomy or a reduced core taxonomy. Requirements are written to be taxonomy-agnostic (exactly one state per Document).
- **OD-2 — Embeddings necessity.** Whether Novelty/Redundancy need embeddings (Tier B) or whether deterministic concept-overlap scoring is sufficient for V1 scale (tens to hundreds of Documents). Default hypothesis: deterministic is sufficient; embeddings are optional.
- **OD-3 — Async orchestration mechanism.** Step Functions (Express vs Standard) vs SQS vs another mechanism for fan-out per-Document analysis. Requirements mandate only the observable async behavior; the mechanism is a design decision.
- **OD-4 — Per-batch URL limit.** A limit of 500 URLs per Batch is assumed for cost/latency bounding; confirm or adjust during design.
- **OD-5 — Content retrieval strategy.** How aggressively to fetch JS-heavy or PDF content (headless rendering vs simple fetch + readability). Default hypothesis: simple fetch + readability extraction, degrade gracefully otherwise. (The content-retrieval numeric defaults introduced in Requirement 4 — the 15s retrieval timeout, 200,000-character LLM input cap, and 300 KB S3 offload threshold — are design-confirmable defaults.)
