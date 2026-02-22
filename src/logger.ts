import pino from "pino";
import type { AppConfig } from "./config.js";

export function createLogger(config: AppConfig) {
  return pino({
    name: "heroku-code-mode-mcp",
    level: config.logLevel,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "response.body.access_token",
        "response.body.refresh_token",
        "oauth.accessToken",
        "oauth.refreshToken"
      ],
      censor: "[REDACTED]"
    }
  });
}
