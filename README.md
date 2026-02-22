# Heroku Code MCP

> A token-efficient MCP server for the Heroku Platform API using a Code Mode pattern: `search` + `execute` + `auth_status`.

This implementation is inspired by the Cloudflare Code Mode blog and Anthropic's programmatic tool-calling approach, where agents inspect available commands (for example via a `help` flow), select the right flags, and execute safely.

## Why This Is Useful

Most API-oriented MCP servers expose many endpoint-specific tools, which inflates tool-list context and increases tool-selection errors. This server keeps the interface intentionally small:

- `search` finds valid operations from Heroku API schema + docs context.
- `execute` validates inputs and performs the selected API call.
- `auth_status` reports per-caller OAuth readiness.

Result: lower context footprint, predictable agent behavior, and safer mutation controls.

## Context Comparison

Measured from `tools/list` payload size (JSON bytes, ~chars/4 token estimate), February 22, 2026.

| Approach | Tools | list_tools payload | Approx tokens |
| --- | ---: | ---: | ---: |
| `heroku mcp:start` (official) | 37 | 25,500 bytes | ~6,375 |
| `heroku-code-mcp` (this repo) | 3 | 1,469 bytes | ~368 |

Source: `/Users/anush.dsouza/startup/Aura12/work/codemode/heroku/benchmarks/results/context-footprint-2026-02-22.json`

## Benchmark Snapshot

Measured on the same machine/account, February 22, 2026.

| Metric | This repo (`http://127.0.0.1:3000/mcp`) | Official (`heroku mcp:start`) |
| --- | ---: | ---: |
| Connect avg | 14.8 ms | 10,168.7 ms |
| list_tools avg | 4.3 ms | 10.3 ms |
| Read operation avg | 528.0 ms (`execute GET /apps`) | 9,697.4 ms (`list_apps`) |

Sources:
- `/Users/anush.dsouza/startup/Aura12/work/codemode/heroku/benchmarks/results/custom-local-http-2026-02-22.json`
- `/Users/anush.dsouza/startup/Aura12/work/codemode/heroku/benchmarks/results/official-heroku-mcp-start-2026-02-22.json`

## Get Started

MCP URL: `http://127.0.0.1:3000/mcp`

```bash
cd /Users/anush.dsouza/startup/Aura12/work/codemode/heroku
npm install
npm run build
npm test
```

### Option 1: OAuth (Recommended)

Configure OAuth env vars and use `/oauth/start` + `/oauth/callback` flow.

### Option 2: Local token seeding from Heroku CLI

```bash
heroku auth:whoami
npm run seed:token
```

Start server (use key printed by seed command):

```bash
TOKEN_STORE_PATH=./data/tokens.integration.json \
TOKEN_ENCRYPTION_KEY_BASE64='<seed-output-key>' \
PORT=3000 HOST=127.0.0.1 npm run dev
```

Smoke test:

```bash
curl -sS http://127.0.0.1:3000/healthz
MCP_URL=http://127.0.0.1:3000/mcp USER_ID=default npm run smoke:mcp
```

## Add to an Agent

Direct streamable HTTP configuration:

```json
{
  "mcpServers": {
    "heroku-code-mcp": {
      "transport": "streamable_http",
      "url": "http://127.0.0.1:3000/mcp",
      "headers": {
        "x-user-id": "default"
      }
    }
  }
}
```

If your client needs a command-based bridge:

```json
{
  "mcpServers": {
    "heroku-code-mcp": {
      "command": "npx",
      "args": ["mcp-remote", "http://127.0.0.1:3000/mcp"],
      "env": {
        "MCP_REMOTE_HEADERS": "{\"x-user-id\":\"default\"}"
      }
    }
  }
}
```

## Tools

| Tool | Description |
| --- | --- |
| `search` | Ranks Heroku operations by natural-language query |
| `execute` | Validates params/body and executes by `operation_id` |
| `auth_status` | Returns `{authenticated, scopes, expires_at}` |

```
Agent                           MCP Server
  │                                  │
  ├──search({query: "list apps"})──►│ rank operations from catalog/index
  │◄──[GET /apps, ...]───────────────│
  │                                  │
  ├──execute({operation_id: ...})───►│ validate + call Heroku API
  │◄──{status, headers, body}────────│
```

## Typical Workflow

1. Call `auth_status`.
2. Call `search` for intent mapping.
3. Pick one `operation_id` from results.
4. Call `execute` with path/query/body.
5. For writes: call `dry_run=true`, then replay with `confirm_write_token` and `ALLOW_WRITES=true`.

Example `search`:

```json
{
  "query": "list apps",
  "limit": 5
}
```

Example read `execute`:

```json
{
  "operation_id": "GET /apps"
}
```

Example write dry-run:

```json
{
  "operation_id": "PATCH /apps/{app_identity}",
  "path_params": {
    "app_identity": "my-app"
  },
  "body": {
    "maintenance": true
  },
  "dry_run": true
}
```

## Safety and Guardrails

- Mutations (`POST`, `PATCH`, `PUT`, `DELETE`) blocked by default (`ALLOW_WRITES=false`).
- Mutations require request-bound `confirm_write_token` from dry-run.
- Sensitive headers and body fields are redacted.
- Idempotent retry policy for transient failures (`GET` / `HEAD`).

## Performance Design

- 3-tool surface keeps tool selection and prompt context small.
- Persistent catalog cache (`CATALOG_CACHE_PATH`) enables fast boot.
- Background refresh decouples ingestion from request path.
- Conditional fetches (`ETag`/`Last-Modified`) cut refresh overhead.
- Short read cache (`READ_CACHE_TTL_MS`) accelerates repeated reads.
- Output bounding (`EXECUTE_MAX_BODY_BYTES`, `EXECUTE_BODY_PREVIEW_CHARS`) prevents oversized responses from dominating context.

## Configuration

Important env vars:

- `ALLOW_WRITES`
- `REQUEST_TIMEOUT_MS`
- `MAX_RETRIES`
- `CATALOG_CACHE_PATH`
- `READ_CACHE_TTL_MS`
- `EXECUTE_MAX_BODY_BYTES`
- `EXECUTE_BODY_PREVIEW_CHARS`

Full example: `/Users/anush.dsouza/startup/Aura12/work/codemode/heroku/.env.example`

## Repository Layout

- `src/schema/*`: ingestion + operation normalization + cache
- `src/search/*`: search index + ranking
- `src/execute/*`: validation + Heroku API execution
- `src/auth/*`: OAuth + encrypted token storage
- `tests/*`: catalog/search/execute tests
- `benchmarks/results/*`: benchmark artifacts
- `BENCHMARKS.md`: benchmark methodology
- `REFERENCES.md`: references

## Troubleshooting

- MCP Inspector connection error: ensure URL is `http://127.0.0.1:3000/mcp`.
- `AUTH_REQUIRED`: seed token or complete OAuth flow.
- Write blocked: set `ALLOW_WRITES=true` and send matching `confirm_write_token`.
- Unexpected large responses: reduce payload scope or tune execute body limits.
