# boostloop-mcp

BoostLoop MCP server, extracted from the main app (`lib/mcp.ts`, `app/mcp`). Stateless Streamable HTTP, JSON responses, POST only, endpoint `/mcp`.

It holds no database access. Each tool call forwards the member's `bl_mcp_…` token as `Authorization: Bearer` to the BoostLoop API (`$BOOSTLOOP_ORIGIN/api/...`), which validates the token, expiry, read/write access and applies all campaign rules.

## Run

```
npm i
BOOSTLOOP_ORIGIN=https://boostloop.club PORT=3001 npm start
npm test && npm run typecheck
```

| Env | Purpose |
|---|---|
| `BOOSTLOOP_ORIGIN` | Required. BoostLoop app origin the API calls go to. |
| `ALLOWED_ORIGINS` | Optional comma list of browser `Origin`s allowed. Non-browser MCP clients send none. |
| `PORT` | Default 3001. |

## Cutover

1. Main app change (PR in `boostloop`) lets `/api/*` accept `Authorization: Bearer bl_mcp_…` (read tokens: GET only; token management routes excluded).
2. Deploy main app, then deploy this server behind HTTPS.
3. Point clients/prompts at the new URL. Main app's `/mcp` keeps working until removed, so no forced cutover.

Token creation, encryption and storage (`lib/mcp-auth.ts`, `mcp-tokens` API) stay in the main app because they use its database.
