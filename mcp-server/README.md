# Read Worthy — MCP server

A **Model Context Protocol** server that lets _any_ MCP-capable agent (Kiro,
Claude Desktop, ChatGPT, Cursor…) use Read Worthy. It is a **thin
client** of the deployed HTTP API — it scores nothing locally; each tool call
maps to one endpoint.

- **Transport:** `stdio`
- **SDK:** [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk)
- **Runtime:** TypeScript, Node 22 ESM
- **Entry:** `dist/index.js` (built from `src/index.ts`)

## Three tools

| Tool                   | What it does                                                     | Endpoint                  |
| ---------------------- | ---------------------------------------------------------------- | ------------------------- |
| `submit_urls`          | Send 1–500 URLs to the inbox for async analysis                  | `POST /imports`           |
| `list_recommendations` | List analyzed docs with state (READ/SKIM/SKIP), MKV score, title | `GET /documents[?state=]` |
| `explain_document`     | Fetch one doc's full LLM explanation, scores, and state          | `GET /documents/{id}`     |

## Quick start

```bash
# from the repo root
npm install
npm run build -w mcp-server
npm test  -w mcp-server      # 15 no-network tests

# run it (id-token mode)
KIZ_API_URL="https://<api-id>.execute-api.<region>.amazonaws.com" \
KIZ_ID_TOKEN="<cognito-id-token>" \
node mcp-server/dist/index.js
```

It prints `read-worthy MCP server ready on stdio` to **stderr** (stdout
is the MCP channel) and then speaks MCP.

## Configuration (environment only — no hardcoded URL/token/credentials)

Provide `KIZ_API_URL` **plus** one auth strategy. In order of preference:

- **Refresh token** (recommended — **no password on disk**): run `kiz-login`
  once; it signs you in interactively (password read without echo, never
  stored) and prints a Cognito **refresh token** to put in `KIZ_REFRESH_TOKEN`
  (+ `KIZ_COGNITO_CLIENT_ID`). The server exchanges it for fresh id tokens and
  renews them automatically. The refresh token lasts 30 days and is revocable
  from Cognito — it is **not** your password. This is how OAuth-style MCP
  servers (GitHub, Slack, Google) work.

  ```bash
  npm run build -w mcp-server
  KIZ_COGNITO_CLIENT_ID=<app-client-id> \
  KIZ_API_URL=https://<api-id>.execute-api.<region>.amazonaws.com \
  node mcp-server/dist/login.js      # prints a ready-to-paste mcpServers block
  ```

- **Email + password** (`KIZ_EMAIL` + `KIZ_PASSWORD` + `KIZ_COGNITO_CLIENT_ID`):
  convenient, also auto-renews, but keeps your password in the config/env —
  avoid for anything shared.
- **`KIZ_ID_TOKEN`** (quick tests / MFA accounts): a ready-made id token. It
  **cannot be renewed**, so the server errors clearly once it expires (~1h).

## Full guide

Install instructions **per client** (Kiro, Claude Desktop, ChatGPT), the
tool/endpoint contract with input/output examples, the **MCP vs A2A vs OpenAPI**
decision, and the MCP best-practices this server follows:

👉 [`docs/mcp.md`](../docs/mcp.md)
