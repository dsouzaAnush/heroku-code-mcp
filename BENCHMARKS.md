# Benchmarks

## Date

- Captured on: February 22, 2026
- Environment: local machine, same Heroku account, warm network

## Files

- `benchmarks/results/custom-local-http-2026-02-22.json`
- `benchmarks/results/official-heroku-mcp-start-2026-02-22.json`
- `benchmarks/results/context-footprint-2026-02-22.json`

## Summary

### Latency

| Benchmark | Connect avg | list_tools avg | Read operation avg |
| --- | ---: | ---: | ---: |
| This repo (`/mcp`) | 14.8 ms | 4.3 ms | 528.0 ms (`execute GET /apps`) |
| Official Heroku MCP | 10,168.7 ms | 10.3 ms | 9,697.4 ms (`list_apps`) |

### Context footprint

| Implementation | Tool count | list_tools bytes | Approx tokens (chars/4) |
| --- | ---: | ---: | ---: |
| This repo | 3 | 1,469 | 368 |
| Official | 37 | 25,500 | 6,375 |

## Methodology

1. Local server benchmark:
- 10 runs
- Measures: connect, list_tools, auth_status, search("list apps"), execute(GET /apps)

2. Official benchmark:
- 3 runs
- Measures: connect, list_tools, list_apps
- Uses `MCP_SERVER_REQUEST_TIMEOUT=60000`

3. Context measurement:
- Calls `list_tools`
- Serializes JSON response
- Computes rough token estimate as `ceil(bytes / 4)`

## Notes

- Operation latency includes remote Heroku API call time and response serialization.
- Official and custom server semantics are not identical tool-by-tool; comparisons are directional for UX/perf tradeoffs.
