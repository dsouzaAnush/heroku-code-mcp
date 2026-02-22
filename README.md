# Heroku Code MCP

Model Context Protocol (MCP) is a standardized way for LLMs to use external systems through tools. This repository provides a focused remote MCP server for the Heroku Platform API so agents can discover operations and execute validated API calls with a fixed low-context tool surface.

This implementation is inspired by the Cloudflare Code Mode blog and Anthropic's programmatic tool-calling approach, where agents inspect available commands (for example via a `help` flow), select the right flags, and execute safely.

The server supports `streamable-http` transport via `/mcp`.

## Server in this Repository

| Server | Description | URL |
| --- | --- | --- |
| `heroku-code-mcp` | Search + execute over Heroku Platform API operations with OAuth and write guardrails | `http://127.0.0.1:3000/mcp` |

## Tools Exposed

| Tool | Purpose | Typical use |
| --- | --- | --- |
| `search` | Finds ranked API operations from schema + docs context | "list apps", "create pipeline", "get releases" |
| `execute` | Validates and executes operation by `operation_id` | Read and write calls with schema checks |
| `auth_status` | Returns auth status for current caller | Preflight before `execute` |

## Access from Any MCP Client

If your MCP client supports remote MCP directly, configure it with the server URL.

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

If your MCP client requires a command-based bridge, use `mcp-remote`:

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

## Quick Start

```bash
cd /Users/anush.dsouza/startup/Aura12/work/codemode/heroku
npm install
npm run build
npm test
```

Seed an auth token from local Heroku CLI login:

```bash
heroku auth:whoami
npm run seed:token
```

Start server:

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

## Tool Calling Flow

1. Call `auth_status`.
2. Call `search` with an intent query (for example, `list apps`).
3. Pick one `operation_id` from ranked results.
4. Call `execute` with parameters.
5. For writes: call `execute` with `dry_run=true`, then replay with returned `confirm_write_token` and `ALLOW_WRITES=true`.

Example `search` input:

```json
{
  "query": "list apps",
  "limit": 5
}
```

Example read `execute` input:

```json
{
  "operation_id": "GET /apps"
}
```

Example write `execute` dry run:

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

## Configuration

Key environment variables:

- `ALLOW_WRITES` (default `false`)
- `REQUEST_TIMEOUT_MS`
- `MAX_RETRIES`
- `CATALOG_CACHE_PATH`
- `READ_CACHE_TTL_MS`
- `EXECUTE_MAX_BODY_BYTES`
- `EXECUTE_BODY_PREVIEW_CHARS`

See `/Users/anush.dsouza/startup/Aura12/work/codemode/heroku/.env.example` for the full set.

## Safety Model

- Mutating methods (`POST`, `PATCH`, `PUT`, `DELETE`) are blocked unless `ALLOW_WRITES=true`.
- Mutating calls require `confirm_write_token` tied to request shape.
- Sensitive headers and body fields are redacted.

## Performance Model

- Fixed 3-tool MCP surface to keep context small.
- Persisted catalog cache enables fast startup and asynchronous refresh.
- Conditional refresh (`ETag` / `Last-Modified`) reduces ingestion cost.
- Short TTL cache for repeated read calls (`GET` / `HEAD`).
- Execute body truncation prevents large payloads from blowing up agent context.

## Benchmarks

Benchmark methodology and captured results are in:

- `/Users/anush.dsouza/startup/Aura12/work/codemode/heroku/BENCHMARKS.md`
- `/Users/anush.dsouza/startup/Aura12/work/codemode/heroku/benchmarks/results`

## Troubleshooting

- Connection error in MCP Inspector: verify server is running and URL is `http://127.0.0.1:3000/mcp`.
- `AUTH_REQUIRED`: run token seed flow or complete OAuth bootstrap.
- Write blocked: check `ALLOW_WRITES=true` and use matching `confirm_write_token`.
- Empty/weak search results: use concrete nouns and resource names (`apps`, `releases`, `pipelines`).

## Development

- Source: `/Users/anush.dsouza/startup/Aura12/work/codemode/heroku/src`
- Tests: `/Users/anush.dsouza/startup/Aura12/work/codemode/heroku/tests`
- References: `/Users/anush.dsouza/startup/Aura12/work/codemode/heroku/REFERENCES.md`
