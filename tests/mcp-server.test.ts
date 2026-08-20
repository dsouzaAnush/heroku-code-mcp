import { describe, expect, test } from "vitest";
import { isLiveAppListQuery, normalizeAppList } from "../src/mcp-server.js";

describe("Slack-safe app listing", () => {
  test("returns app names and non-secret metadata", () => {
    expect(
      normalizeAppList([
        {
          id: "app-123",
          name: "example-app",
          web_url: "https://example-app.example/",
          maintenance: false,
          updated_at: "2026-08-20T00:00:00Z",
          owner: { email: "private@example.com" },
          internal_routing: { private_key: "do-not-return" }
        }
      ])
    ).toEqual({
      count: 1,
      apps: [
        {
          id: "app-123",
          name: "example-app",
          web_url: "https://example-app.example/",
          maintenance: false,
          updated_at: "2026-08-20T00:00:00Z"
        }
      ]
    });
  });

  test("ignores malformed entries", () => {
    expect(normalizeAppList([null, "bad", { id: "missing-name" }])).toEqual({
      count: 0,
      apps: []
    });
  });

  test.each([
    "list my apps",
    "list Heroku apps",
    "Heroku apps list",
    "GET /apps"
  ])("recognizes a live app-list query: %s", (query) => {
    expect(isLiveAppListQuery(query)).toBe(true);
  });

  test("does not treat ordinary operation searches as live app-list queries", () => {
    expect(isLiveAppListQuery("find build endpoints")).toBe(false);
  });
});
