# Knowledge Inbox Zero — MCP server

A **Model Context Protocol** server that lets _any_ MCP-capable agent (Kiro,
Claude Desktop, ChatGPT, Cursor…) use Knowledge Inbox Zero. It is a **thin
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

It prints `knowledge-inbox-zero MCP server ready on stdio` to **stderr** (stdout
is the MCP channel) and then speaks MCP.

## Configuration (environment only — no hardcoded URL/token/credentials)

Provide `KIZ_API_URL` **plus** one auth strategy: either `KIZ_ID_TOKEN`
(preferred, works with MFA), or `KIZ_EMAIL` + `KIZ_PASSWORD` +
`KIZ_COGNITO_CLIENT_ID` (signs in via Cognito `USER_PASSWORD_AUTH` at startup).

## Full guide

Install instructions **per client** (Kiro, Claude Desktop, ChatGPT), the
tool/endpoint contract with input/output examples, the **MCP vs A2A vs OpenAPI**
decision, and the MCP best-practices this server follows:

👉 [`docs/mcp.md`](../docs/mcp.md)
