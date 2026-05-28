import { describe, expect, test } from "vitest";
import {
  normalizePublicBaseUrl,
  resolveOAuthRedirectUri
} from "../src/config.js";

describe("hosted config helpers", () => {
  test("normalizes explicit public base URLs", () => {
    expect(normalizePublicBaseUrl("https://demo.herokuapp.com/")).toBe(
      "https://demo.herokuapp.com"
    );
  });

  test("derives a Heroku app URL when dyno metadata is present", () => {
    expect(normalizePublicBaseUrl(undefined, "demo-mcp")).toBe(
      "https://demo-mcp.herokuapp.com"
    );
  });

  test("uses hosted OAuth callback when public base URL is configured", () => {
    expect(
      resolveOAuthRedirectUri({
        publicBaseUrl: "https://demo.herokuapp.com",
        port: 3000
      })
    ).toBe("https://demo.herokuapp.com/oauth/callback");
  });

  test("keeps explicit OAuth redirect URI authoritative", () => {
    expect(
      resolveOAuthRedirectUri({
        explicitRedirectUri: "https://oauth.example.com/callback",
        publicBaseUrl: "https://demo.herokuapp.com",
        port: 3000
      })
    ).toBe("https://oauth.example.com/callback");
  });
});
