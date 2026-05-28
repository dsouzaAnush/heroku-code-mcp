import { describe, expect, test } from "vitest";
import { isMcpRequestAuthorized } from "../src/auth/mcp-access.js";
import { getHeaderValue } from "../src/utils/headers.js";

describe("MCP access guard", () => {
  test("allows requests when no shared secret is configured", () => {
    expect(
      isMcpRequestAuthorized({}, { authHeader: "authorization" })
    ).toBe(true);
  });

  test("accepts Authorization bearer tokens", () => {
    expect(
      isMcpRequestAuthorized(
        { authorization: "Bearer secret-token" },
        { authToken: "secret-token", authHeader: "authorization" }
      )
    ).toBe(true);
  });

  test("accepts the explicit MCP auth header", () => {
    expect(
      isMcpRequestAuthorized(
        { "x-mcp-auth-token": "secret-token" },
        { authToken: "secret-token", authHeader: "x-mcp-auth-token" }
      )
    ).toBe(true);
  });

  test("rejects missing or wrong shared secrets", () => {
    expect(
      isMcpRequestAuthorized(
        { authorization: "Bearer wrong-token" },
        { authToken: "secret-token", authHeader: "authorization" }
      )
    ).toBe(false);
  });

  test("reads first header array value", () => {
    expect(getHeaderValue({ authorization: ["Bearer a", "Bearer b"] }, "authorization"))
      .toBe("Bearer a");
  });
});
