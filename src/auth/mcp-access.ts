import { timingSafeEqual } from "node:crypto";
import { getHeaderValue } from "../utils/headers.js";

interface McpAccessConfig {
  authToken?: string;
  authHeader: string;
}

function safeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeCandidate(value: string): string {
  const trimmed = value.trim();
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(trimmed);
  return bearerMatch?.[1]?.trim() ?? trimmed;
}

export function isMcpRequestAuthorized(
  headers: unknown,
  config: McpAccessConfig
): boolean {
  if (!config.authToken) {
    return true;
  }

  const candidates = [
    getHeaderValue(headers, config.authHeader),
    getHeaderValue(headers, "authorization"),
    getHeaderValue(headers, "x-mcp-auth-token")
  ].filter((value): value is string => typeof value === "string");

  return candidates.some((candidate) =>
    safeEquals(normalizeCandidate(candidate), config.authToken ?? "")
  );
}
