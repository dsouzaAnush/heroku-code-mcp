import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import { verifySlackRequest } from "../src/auth/slack-request.js";

const signingSecret = "slack-signing-secret";
const timestamp = "1787205000";
const nowMs = Number(timestamp) * 1000;
const rawBody = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/list",
  params: {}
});

function signature(body: string, requestTimestamp = timestamp): string {
  return `v0=${createHmac("sha256", signingSecret)
    .update(`v0:${requestTimestamp}:${body}`)
    .digest("hex")}`;
}

describe("verifySlackRequest", () => {
  test("accepts a valid Slack v0 signature", () => {
    expect(
      verifySlackRequest({
        headers: {
          "x-slack-request-timestamp": timestamp,
          "x-slack-signature": signature(rawBody)
        },
        rawBody,
        signingSecret,
        nowMs
      })
    ).toBe(true);
  });

  test("rejects a signature when the body changes", () => {
    expect(
      verifySlackRequest({
        headers: {
          "x-slack-request-timestamp": timestamp,
          "x-slack-signature": signature(rawBody)
        },
        rawBody: `${rawBody} `,
        signingSecret,
        nowMs
      })
    ).toBe(false);
  });

  test("rejects replayed requests older than five minutes", () => {
    expect(
      verifySlackRequest({
        headers: {
          "x-slack-request-timestamp": timestamp,
          "x-slack-signature": signature(rawBody)
        },
        rawBody,
        signingSecret,
        nowMs: nowMs + 301_000
      })
    ).toBe(false);
  });
});
