<p align="center">
  <img src="assets/heroku-logo-dark-rgb.svg" alt="Heroku" height="44" />
  <span>&nbsp;&nbsp;&nbsp;</span>
  <img src="assets/claude-ai-logo.svg" alt="Claude" height="44" />
</p>

# Heroku Code MCP

> A token-efficient MCP server for the Heroku Platform API using a Code Mode pattern: `search` + `execute` + `auth_status`.

<!-- mcp-name: io.github.dsouzaAnush/heroku-code-mcp -->

Pair this MCP server with the companion [Heroku Skills](https://github.com/dsouzaAnush/heroku-skills) repository to give Claude both a compact Heroku API tool surface and safe Heroku operating workflows.

Design references:
- [Cloudflare Code Mode MCP](https://blog.cloudflare.com/code-mode-mcp/)
- [Anthropic: Building Effective Agents (advanced tool use)](https://www.anthropic.com/engineering/building-effective-agents)

## Context Comparison

| Approach | Tool surface | Approx context cost at tool-list time | Fits in a 200k-token context window? |
| --- | --- | --- | --- |
| official Heroku MCP | 37 endpoint-oriented tools | ~6,375 tokens | Yes, but consumes meaningful budget up front |
| `heroku-code-mcp` (this repo) | 3 control tools (`search`, `execute`, `auth_status`) | ~368 tokens | Yes, with minimal up-front overhead |

The practical impact is that the agent starts with a much smaller tool schema, then asks the server for just-in-time endpoint discovery. This keeps prompt budget available for user intent, planning, and response quality instead of spending it on static endpoint metadata.

## The Problem

Heroku’s API surface is broad, and an endpoint-per-tool MCP model makes the agent choose between many tools before it has enough task context. That usually increases tool-selection ambiguity, consumes tokens early, and makes multi-step tasks more brittle. The issue is not that many tools are inherently bad, but that model context is scarce and endpoint selection is an agent planning problem, not just a transport problem.

## The Approach

This server applies a Code Mode-style control loop with deterministic inputs:

1. `search` maps natural language intent to ranked `operation_id` candidates.
2. `execute` validates and performs the selected Heroku API operation.
3. `auth_status` provides explicit auth state so agents can branch cleanly.

The server holds schema intelligence and safety policy centrally. The agent gets a small control surface and a stable execution contract.

## Tools

| Tool | What it does | Why it exists |
| --- | --- | --- |
| `search` | Ranks Heroku operations from schema + docs context | Reduces endpoint selection ambiguity |
| `execute` | Validates params/body and executes by `operation_id` | Gives one deterministic execution path |
| `auth_status` | Returns `{authenticated, scopes, expires_at}` | Supports explicit auth-aware planning |

```text
Agent                           MCP Server
  │                                  │
  ├──search({query: "list apps"})──►│ rank operations from catalog/index
  │◄──[GET /apps, ...]───────────────│
  │                                  │
  ├──execute({operation_id: ...})───►│ validate + call Heroku API
  │◄──{status, headers, body}────────│
```

## Benchmark Highlights

Benchmarks were captured on February 22, 2026 on the same machine and account for both implementations. The numbers below compare this repo’s local HTTP MCP endpoint against the official Heroku MCP server over stdio.

### Raw Comparison

| Metric | `heroku-code-mcp` | official Heroku MCP | Delta |
| --- | ---: | ---: | ---: |
| Tool count | 3 | 37 | 91.9% lower |
| Tool-list payload bytes | 1,469 | 25,500 | 94.2% lower |
| Tool-list approx tokens | 368 | 6,375 | 94.2% lower |
| Connect avg | 14.8 ms | 10,168.7 ms | 687x faster |
| `list_tools` avg | 4.3 ms | 10.3 ms | 2.4x faster |
| Read op avg | 528.0 ms (`execute GET /apps`) | 9,697.4 ms (`list_apps`) | 18.4x faster |

### Comparison Graphs

These are static charts so labels stay readable in GitHub without giant auto-scaled Mermaid panels.

![Context reduction chart](benchmarks/graphs/context-reduction.svg)

![Latency comparison chart](benchmarks/graphs/latency-comparison.svg)

### How to Read These Results

The strongest win is context footprint. A 3-tool interface materially lowers initial prompt overhead and reduces tool-choice branching for the model. The second win is connection and read-path latency under this benchmark harness. In measured runs, the official Heroku MCP paid a much larger connect-time cost, and its measured read operation was substantially slower than `execute GET /apps` on this server.

This does not mean every endpoint in every environment will always have the same multiplier. It means the measured default experience in this setup favored the Code Mode control surface for both context economy and latency.

## Benchmark Methodology

- Date: February 22, 2026.
- Environment: same local machine, same Heroku account, warm network.
- Custom server run count: 10.
- Official server run count: 3.
- Context estimate: `ceil(list_tools_json_bytes / 4)` for rough token approximation.
- Read comparison pairing:
  - Custom: `execute GET /apps`
  - Official: `list_apps`

Artifacts:
- `benchmarks/results/context-footprint-2026-02-22.json`
- `benchmarks/results/custom-local-http-2026-02-22.json`
- `benchmarks/results/official-heroku-mcp-start-2026-02-22.json`
- `BENCHMARKS.md`

## Get Started

Default MCP URL: `http://127.0.0.1:3000/mcp`

### From source

```bash
git clone https://github.com/dsouzaAnush/heroku-code-mcp.git
cd heroku-code-mcp
npm install
npm run build
npm test
```

### Option 1: OAuth (Recommended)

Configure OAuth env vars and use `/oauth/start` + `/oauth/callback`.

### Option 2: Local token seeding from Heroku CLI

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

### From npm or GitHub

After the npm package is published:

```bash
HOST=127.0.0.1 PORT=3333 \
TOKEN_STORE_PATH="$HOME/.heroku-code-mcp/tokens.json" \
TOKEN_ENCRYPTION_KEY_BASE64="<base64-32-byte-key>" \
WRITE_CONFIRMATION_SECRET="<random-secret>" \
npx -y heroku-code-mcp
```

Before npm publication, install from GitHub:

```bash
HOST=127.0.0.1 PORT=3333 \
TOKEN_STORE_PATH="$HOME/.heroku-code-mcp/tokens.json" \
TOKEN_ENCRYPTION_KEY_BASE64="<base64-32-byte-key>" \
WRITE_CONFIRMATION_SECRET="<random-secret>" \
npx -y github:dsouzaAnush/heroku-code-mcp
```

Set `ALLOW_WRITES=true` only when the client should be able to complete mutating Heroku API calls after a dry-run confirmation token.

## Install in Claude

Heroku Code MCP is the tool layer. It gives Claude three control tools:

- `auth_status`: check whether the current caller is authenticated with Heroku
- `search`: map intent such as "list apps" or "inspect config vars" to Heroku Platform API operations
- `execute`: validate and run the selected operation

Use [Heroku Skills](https://github.com/dsouzaAnush/heroku-skills) alongside this server when you want Claude to follow Heroku-specific workflows, guardrails, and product guidance before calling tools.

Claude Code MCP setup follows Anthropic's [Claude Code MCP documentation](https://docs.anthropic.com/en/docs/claude-code/mcp).

### Claude Code MCP

Add the running local MCP server directly:

```bash
claude mcp add \
  --transport http \
  --scope local \
  heroku-code-mcp \
  http://127.0.0.1:3000/mcp \
  --header "x-user-id: default"
```

Verify the connection:

```bash
claude mcp get heroku-code-mcp
```

For a bundled Claude Code plugin that includes both the Heroku skills and this MCP wiring, build the Claude adapter in the companion repo:

```bash
claude plugin marketplace add dsouzaAnush/heroku-plugin
claude plugin install heroku@heroku-plugin
claude plugin enable heroku@heroku-plugin
```

### Claude Desktop

Claude Desktop can use this server through MCP configuration. If your Claude Desktop build supports HTTP MCP servers directly, add:

```json
{
  "mcpServers": {
    "heroku-code-mcp": {
      "type": "http",
      "url": "http://127.0.0.1:3000/mcp",
      "headers": {
        "x-user-id": "default"
      }
    }
  }
}
```

If your Claude Desktop build expects a stdio command, bridge to the local HTTP server with `mcp-remote`:

```json
{
  "mcpServers": {
    "heroku-code-mcp": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://127.0.0.1:3000/mcp", "--allow-http", "--header", "x-user-id:default"]
    }
  }
}
```

Restart Claude Desktop after editing `~/Library/Application Support/Claude/claude_desktop_config.json`.

For a branded Claude Desktop `.mcpb` bundle:

```bash
npm run build:mcpb
```

The bundle is written to `dist/mcpb/heroku-code-mcp.mcpb`. Publish it as a GitHub release asset. The bundle wrapper runs a local checkout when `HEROKU_CODE_MCP_ROOT` is set; otherwise it falls back to `npx -y github:dsouzaAnush/heroku-code-mcp#v0.1.0`. Set `HEROKU_CODE_MCP_NPX_PACKAGE=heroku-code-mcp` after npm publication if you want the npm package instead.

### Claude cowork / remote code sessions

Claude cowork and other remote code-session surfaces should use the same two-part pattern:

1. Run `heroku-code-mcp` somewhere reachable from the cowork runtime.
2. Load the Claude plugin bundle from [Heroku Skills](https://github.com/dsouzaAnush/heroku-skills), or add the MCP server directly with `claude mcp add`.

For a local cowork session that can reach your laptop, keep the server bound to `127.0.0.1` and use the local Claude Code plugin. For a remote cowork environment, run this MCP server inside that environment or expose it through an authenticated internal endpoint. Do not expose a locally seeded Heroku token store on a public network.

## Install in Codex

Codex uses the companion [Heroku Plugin](https://github.com/dsouzaAnush/heroku-plugin) for skills and optional `.mcp.json` wiring:

```bash
codex plugin marketplace add dsouzaAnush/heroku-plugin --ref main
```

Enable `heroku-plugin@heroku-plugin` in the Codex Plugins tab, or add this stanza to `~/.codex/config.toml`:

```toml
[plugins."heroku-plugin@heroku-plugin"]
enabled = true
```

Run `heroku-code-mcp` on `http://127.0.0.1:3333/mcp` when you want live Heroku API tools available through the plugin's `.mcp.json`.

## Install in Cursor

Cursor can use the plugin skills and the MCP server separately.

Load the companion plugin from a checkout:

```bash
git clone https://github.com/dsouzaAnush/heroku-plugin.git
cursor agent --plugin-dir "$(pwd)/heroku-plugin"
```

Add the MCP server to `~/.cursor/mcp.json` or a project-local `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "heroku-code-mcp": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:3333/mcp",
      "headers": {
        "x-user-id": "default"
      }
    }
  }
}
```

## Add to Another Agent

### Direct streamable HTTP

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

### Command bridge

```json
{
  "mcpServers": {
    "heroku-code-mcp": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://127.0.0.1:3000/mcp", "--allow-http", "--header", "x-user-id:default"]
    }
  }
}
```

## Typical Workflow

1. Call `auth_status`.
2. Call `search` with intent.
3. Choose one `operation_id`.
4. Call `execute` with `path_params`, `query_params`, and `body` as needed.
5. For writes, run `dry_run=true` first, then replay with `confirm_write_token` and `ALLOW_WRITES=true`.

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

- Mutations (`POST`, `PATCH`, `PUT`, `DELETE`) are blocked by default.
- Mutations require both `ALLOW_WRITES=true` and a matching `confirm_write_token`.
- Sensitive headers and body fields are redacted.
- Idempotent retries (`GET` / `HEAD`) are enabled for transient failures.

## Performance Design

- 3-tool MCP surface minimizes up-front tool context.
- Persistent catalog cache (`CATALOG_CACHE_PATH`) avoids cold-start re-ingestion.
- Background refresh decouples ingestion from request path.
- Conditional fetches (`ETag`/`Last-Modified`) reduce refresh cost.
- Short read cache (`READ_CACHE_TTL_MS`) improves repeated read latency.
- Output bounds (`EXECUTE_MAX_BODY_BYTES`, `EXECUTE_BODY_PREVIEW_CHARS`) prevent oversized responses from dominating context.

## Configuration

Key env vars:
- `ALLOW_WRITES`
- `REQUEST_TIMEOUT_MS`
- `MAX_RETRIES`
- `CATALOG_CACHE_PATH`
- `READ_CACHE_TTL_MS`
- `EXECUTE_MAX_BODY_BYTES`
- `EXECUTE_BODY_PREVIEW_CHARS`

Full example: `.env.example`

## Publish

Validate the package and MCP Registry metadata:

```bash
npm run build
npm test
npm run validate:server
npm run publish:dry-run
```

Publish the npm package:

```bash
npm publish --access public
```

Publish the MCP Registry metadata. The checked-in `server.json` points at the GitHub Release `.mcpb` artifact, so npm publication is optional for the current registry entry:

```bash
mcp-publisher login github
mcp-publisher publish server.json
```

The current MCP Registry name is `io.github.dsouzaAnush/heroku-code-mcp`.

For Claude Desktop distribution, build the `.mcpb` bundle and attach it to a GitHub release:

```bash
npm run build:mcpb
gh release create v0.1.0 dist/mcpb/heroku-code-mcp.mcpb
```

For OpenAI and ChatGPT surfaces, host this as a remote MCP server or package it as part of a ChatGPT app submission. The standalone Codex plugin is distributed today from GitHub through the companion plugin repo rather than a public self-serve OpenAI plugin marketplace.

## Brand assets

This repo includes the official Heroku wordmark and mark under [`assets`](assets), plus the Claude logo used in the Claude-facing setup examples. Use the Heroku assets according to Heroku's brand guidance:

- [Heroku Brand Guidelines](https://devcenter.heroku.com/articles/heroku-brand-guidelines)

## Repository Layout

- `src/schema/*`: ingestion + operation normalization + cache
- `src/search/*`: search index + ranking
- `src/execute/*`: validation + Heroku API execution
- `src/auth/*`: OAuth + encrypted token storage
- `tests/*`: catalog/search/execute tests
- `benchmarks/results/*`: benchmark artifacts
- `BENCHMARKS.md`: benchmark methodology details
- `REFERENCES.md`: external references

## Troubleshooting

- MCP Inspector connection error: confirm URL is `http://127.0.0.1:3000/mcp` and server is running.
- `AUTH_REQUIRED`: seed token or complete OAuth flow.
- Write blocked: confirm `ALLOW_WRITES=true` and send the matching `confirm_write_token` from the dry run.
- Large response body: narrow query scope or lower output caps for stricter truncation.
