# MCP server

The `mcp-server/` workspace is a **Model Context Protocol** server that lets any
MCP-capable agent use Knowledge Inbox Zero over `stdio`. It is a **thin client**
of the deployed HTTP API — it performs no scoring, extraction, or
classification locally; every tool call maps to one API endpoint.

- Transport: `stdio`
- SDK: [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk)
- Language: TypeScript, Node 22 ESM
- Entry: `mcp-server/dist/index.js` (built from `mcp-server/src/index.ts`)

## Configuration (environment only)

No URL, token, email, or password is ever hardcoded. The server reads:

| Variable                | Required | Purpose                                                                |
| ----------------------- | -------- | ---------------------------------------------------------------------- |
| `KIZ_API_URL`           | yes      | Deployed API base URL (stack output `ApiUrl` / SSM `api-url`).         |
| `KIZ_ID_TOKEN`          | one-of   | A Cognito **id token** (preferred; works with MFA).                    |
| `KIZ_EMAIL`             | one-of   | With `KIZ_PASSWORD` + `KIZ_COGNITO_CLIENT_ID`, signs in at startup.    |
| `KIZ_PASSWORD`          | one-of   | Password for `USER_PASSWORD_AUTH`.                                     |
| `KIZ_COGNITO_CLIENT_ID` | one-of   | Cognito app client id for `USER_PASSWORD_AUTH`.                        |
| `KIZ_COGNITO_REGION`    | no       | Cognito region (defaults to `eu-south-2`, falls back to `AWS_REGION`). |

Provide **either** `KIZ_ID_TOKEN` **or** the `KIZ_EMAIL` + `KIZ_PASSWORD` +
`KIZ_COGNITO_CLIENT_ID` trio. The server fails fast with a precise stderr
message when configuration is missing or a Cognito challenge (password change,
MFA) blocks `USER_PASSWORD_AUTH`.

## Tools

### `submit_urls` → `POST /imports`

Submit one or more URLs for asynchronous analysis.

- **Input**

  ```json
  { "urls": ["https://example.com/a", "https://example.com/b"] }
  ```

  `urls`: array of valid URL strings (1–500). The server joins them with
  newlines into the API's `{ "urls": "<newline-separated>" }` body.

- **Output** — the created batch summary:

  ```json
  {
    "batchId": "b_01H...",
    "total": 2,
    "pending": 2,
    "duplicates": 0,
    "blocked": [],
    "rejected": []
  }
  ```

### `list_recommendations` → `GET /documents[?state=]`

List analyzed documents with their recommendation, score, and title/url.

- **Input**

  ```json
  { "state": "READ" }
  ```

  `state`: optional, one of `READ` | `SKIM` | `SKIP`. Omit for all documents.

- **Output**

  ```json
  {
    "counts": { "READ": 1, "SKIM": 0, "SKIP": 0, "total": 1 },
    "documents": [
      {
        "documentId": "d1",
        "state": "READ",
        "mkv": 72,
        "title": "Great article",
        "url": "https://example.com/a/",
        "status": "completed"
      }
    ],
    "nextCursor": null
  }
  ```

### `explain_document` → `GET /documents/{documentId}`

Fetch one document's full recommendation: the written explanation, the scores,
and the state.

- **Input**

  ```json
  { "documentId": "d1" }
  ```

- **Output**

  ```json
  {
    "documentId": "d1",
    "state": "SKIM",
    "scores": {
      "relevance": 50,
      "novelty": 40,
      "redundancy": 30,
      "freshness": 20,
      "mkv": 41
    },
    "explanation": "Mostly things you already know; skim the last section.",
    "title": "Known topic",
    "url": "https://example.com/a/",
    "status": "completed"
  }
  ```

## Tool → endpoint map

| Tool                   | Endpoint                  |
| ---------------------- | ------------------------- |
| `submit_urls`          | `POST /imports`           |
| `list_recommendations` | `GET /documents[?state=]` |
| `explain_document`     | `GET /documents/{id}`     |

## Run it locally

```bash
npm install
npm run build -w mcp-server

# id-token mode
KIZ_API_URL="$(aws ssm get-parameter --name <api-url-param> --query Parameter.Value --output text)" \
KIZ_ID_TOKEN="<cognito-id-token>" \
node mcp-server/dist/index.js

# email/password mode
KIZ_API_URL="https://<api-id>.execute-api.<region>.amazonaws.com" \
KIZ_EMAIL="you@example.com" \
KIZ_PASSWORD="•••••••" \
KIZ_COGNITO_CLIENT_ID="<app-client-id>" \
node mcp-server/dist/index.js
```

The server prints `knowledge-inbox-zero MCP server ready on stdio` to **stderr**
(stdout is the MCP channel) and then speaks MCP over stdio.

### Wire it into an MCP client

Add it to any MCP client config (Kiro `.kiro/settings/mcp.json`, Claude Desktop,
etc.):

```json
{
  "mcpServers": {
    "knowledge-inbox-zero": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/dist/index.js"],
      "env": {
        "KIZ_API_URL": "https://<api-id>.execute-api.<region>.amazonaws.com",
        "KIZ_ID_TOKEN": "<cognito-id-token>"
      }
    }
  }
}
```

## Run it from a Kiro cloud session

In a Kiro cloud session you do not need the repo — install the **Kiro Power**
(`power/`), which wires this same server from any agent. Set the `KIZ_*`
environment the Power's `mcp.json` expects (API URL + an id token, or the
email/password trio), then just talk to the agent: "add these links to my
Knowledge Inbox Zero", "what should I read?", "why is this one a SKIP?". See
[`power/skills/connect-to-inbox-zero/SKILL.md`](../power/skills/connect-to-inbox-zero/SKILL.md).

## Testing

A no-network test (`mcp-server/test/server.test.ts`, run with `node --test`)
asserts the three tool names and input schemas, validates each schema's
accept/reject behavior, and exercises every handler against a stubbed `fetch`:

```bash
npm test -w mcp-server
```

A PostFileSave hook (`.kiro/hooks/mcp-contract-on-save.json`) runs a contract
guard on every edit of the server source, rebuilding and asserting the three
tools and their schemas are still present.

## Install into each client

The server speaks MCP over `stdio`, so any MCP-capable client runs it the same
way: it launches `node .../mcp-server/dist/index.js` as a child process and sets
the `KIZ_*` environment. Build once first:

```bash
npm install
npm run build -w mcp-server
```

### Kiro (recommended — this is the evaluated product)

Add it to `.kiro/settings/mcp.json` (project) or your user-level MCP config:

```json
{
  "mcpServers": {
    "knowledge-inbox-zero": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/dist/index.js"],
      "env": {
        "KIZ_API_URL": "https://<api-id>.execute-api.<region>.amazonaws.com",
        "KIZ_ID_TOKEN": "<cognito-id-token>"
      }
    }
  }
}
```

Then just talk to Kiro: _"add these 5 links to my Knowledge Inbox Zero"_, _"what
should I read?"_, _"why is this one a SKIP?"_. Kiro picks the tool from its
description and shows you the result.

### Claude Desktop

Same shape, in `claude_desktop_config.json` (macOS:
`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "knowledge-inbox-zero": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/dist/index.js"],
      "env": {
        "KIZ_API_URL": "https://<api-id>.execute-api.<region>.amazonaws.com",
        "KIZ_ID_TOKEN": "<cognito-id-token>"
      }
    }
  }
}
```

Restart Claude Desktop; the three tools appear under the 🔌 connector menu.

### ChatGPT

ChatGPT supports MCP connectors (Developer mode / "Connectors" — availability
depends on your plan). Because the server is **local stdio**, point ChatGPT at it
the way its connector UI expects (a local MCP command, or via a bridge such as
`npx mcp-remote` if you expose it over HTTP). The tools, inputs and outputs are
identical to the Kiro case above — that is the whole point of MCP: **one server,
every client, no rewrite**. For the challenge demo, prefer Kiro (the evaluated
product); mention ChatGPT only as "works with any MCP client".

> Any client gets the **same three tools**. The server is the integration; the
> client is interchangeable.

## MCP vs A2A vs OpenAPI — which standard, and why MCP here

There is no single "agent endpoint standard"; there are three, solving different
layers. Picking the wrong one over-engineers a simple case or under-powers a
complex one.

| Standard    | Connects                            | Shape                                          | Use it when                                                                            |
| ----------- | ----------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| **MCP**     | an agent **↓ to** tools & data      | tools / resources / prompts over stdio or HTTP | you want one integration to work in Kiro, Claude, Cursor, ChatGPT without rewriting it |
| **A2A**     | agents **↔ to each other** as peers | an `AgentCard` at `/.well-known/agent.json`    | two or more autonomous agents must discover and delegate to each other                 |
| **OpenAPI** | describes **REST endpoints**        | an `openapi.json` document                     | you already have a REST API and want a machine-readable contract / quick bridge        |

**Why MCP for Knowledge Inbox Zero.** The need is "let any agent send links to my
app and read the recommendations back" — an agent reaching **tools**, the
vertical MCP case. A2A would be over-engineering (there is no second autonomous
agent to negotiate with; the `AgentCard` you may have seen is an A2A artifact and
is not needed here). The app's HTTP API is already REST, so publishing an
`openapi.json` is an **optional** nicety — but MCP is the direct, client-agnostic
answer and it is what the challenge's MCP lesson evaluates.

MCP was donated to the Linux Foundation and is the de-facto standard; WebMCP (a
browser variant where a site exposes actions to in-page agents) is emerging and
is the natural future home for the browser extension — noted, not built.

## MCP server best-practices this server follows

- **Verb+object tool names, stable across versions** — `submit_urls`,
  `list_recommendations`, `explain_document`. The model chooses a tool by its
  name and description, so these read like intents.
- **Rich descriptions on every tool and every parameter.** Each tool's
  description states what it does, which endpoint it maps to, and what it
  returns; the model's tool choice is only as good as these strings.
- **Typed schemas with validation** — `zod` schemas are the single source of
  truth for the contract (`urls` must be 1–500 valid URLs; `state` is a closed
  enum). The SDK rejects bad input before the handler runs.
- **Structured, readable errors — never stack traces.** Every handler is wrapped
  so a failure returns `{ isError: true, content: [{ text: "Error: …" }] }`, and
  misconfiguration fails fast at startup with an actionable stderr message.
- **Thin and stateless.** The server scores nothing locally; each tool is one API
  call, so behavior always matches the deployed app. Submission is explicitly
  asynchronous (`submit_urls` returns a batch, you poll with
  `list_recommendations`).
- **Secrets only via environment**, never in code or args — API URL + a Cognito
  id token (or the email/password trio). A contract-guard hook re-verifies the
  three tools and their schemas on every edit of the server source.
