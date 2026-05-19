#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${HEROKU_CODE_MCP_ENV_FILE:-${HOME}/Library/Application Support/Claude/heroku-code-mcp/env.sh}"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
fi

if [[ -n "${NODE_BIN_DIR:-}" ]]; then
  export PATH="${NODE_BIN_DIR}:${PATH:-}"
fi

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3333}"
USER_ID="${USER_ID:-default}"
LOG_FILE="${HOME}/Library/Logs/Claude/heroku-code-mcp-http.log"
if [[ -z "${HEROKU_CODE_MCP_VERSION:-}" && -f "${DEFAULT_REPO_DIR}/package.json" ]]; then
  HEROKU_CODE_MCP_VERSION="$(node -p "require('${DEFAULT_REPO_DIR}/package.json').version" 2>/dev/null || true)"
fi
HEROKU_CODE_MCP_VERSION="${HEROKU_CODE_MCP_VERSION:-0.1.0}"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

if [[ -z "${TOKEN_STORE_PATH:-}" ]]; then
  echo "TOKEN_STORE_PATH is required" >&2
  exit 1
fi

if [[ -z "${TOKEN_ENCRYPTION_KEY_BASE64:-}" ]]; then
  echo "TOKEN_ENCRYPTION_KEY_BASE64 is required" >&2
  exit 1
fi

mkdir -p "$(dirname "${LOG_FILE}")"

if ! curl -fsS "http://${HOST}:${PORT}/healthz" >/dev/null 2>&1; then
  if [[ -n "${HEROKU_CODE_MCP_ROOT:-}" ]]; then
    REPO_DIR="${HEROKU_CODE_MCP_ROOT}"
  elif [[ -f "${DEFAULT_REPO_DIR}/dist/index.js" && -f "${DEFAULT_REPO_DIR}/package.json" ]]; then
    REPO_DIR="${DEFAULT_REPO_DIR}"
  else
    REPO_DIR=""
  fi

  (
    if [[ -n "${REPO_DIR}" ]]; then
      cd "${REPO_DIR}"
      START_COMMAND=(node dist/index.js)
    else
      NPX_PACKAGE="${HEROKU_CODE_MCP_NPX_PACKAGE:-github:dsouzaAnush/heroku-code-mcp#v${HEROKU_CODE_MCP_VERSION}}"
      START_COMMAND=(npx -y "${NPX_PACKAGE}")
    fi

    HOST="${HOST}" \
      PORT="${PORT}" \
      TOKEN_STORE_PATH="${TOKEN_STORE_PATH}" \
      TOKEN_ENCRYPTION_KEY_BASE64="${TOKEN_ENCRYPTION_KEY_BASE64}" \
      ALLOW_WRITES="${ALLOW_WRITES:-false}" \
      WRITE_CONFIRMATION_SECRET="${WRITE_CONFIRMATION_SECRET:-local-dev-secret}" \
      LOG_LEVEL="${LOG_LEVEL:-warn}" \
      "${START_COMMAND[@]}" >>"${LOG_FILE}" 2>&1 &
  )

  for _ in {1..50}; do
    if curl -fsS "http://${HOST}:${PORT}/healthz" >/dev/null 2>&1; then
      break
    fi
    sleep 0.2
  done
fi

if ! curl -fsS "http://${HOST}:${PORT}/healthz" >/dev/null 2>&1; then
  echo "Heroku Code MCP did not become healthy at http://${HOST}:${PORT}/healthz" >&2
  echo "See ${LOG_FILE}" >&2
  exit 1
fi

exec npx -y mcp-remote "http://${HOST}:${PORT}/mcp" \
  --allow-http \
  --transport http-only \
  --header "x-user-id:${USER_ID}"
