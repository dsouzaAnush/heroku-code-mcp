import { describe, expect, test } from "vitest";
import {
  fetchGitHubSourcePreview,
  fetchLiveAppSummary
} from "../src/github/source-preview.js";
import { createHerokuDeployAppHtml } from "../src/ui/heroku-deploy-app.js";

describe("GitHub deployment source preview", () => {
  test("pins preview files to the resolved immutable commit", async () => {
    const requested: string[] = [];
    const fetchFn = async (input: string | URL | Request) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("/commits/main.atom")) {
        return new Response(
          `<feed><entry><id>tag:github.com,2008:Grit::Commit/${"a".repeat(40)}</id><title>Ship the preview</title><updated>2026-08-20T00:00:00Z</updated><author><name>Example</name></author></entry></feed>`,
          { headers: { "content-type": "application/atom+xml" } }
        );
      }
      if (url.includes("/README.md")) {
        return new Response("# Reviewed app", {
          headers: { "content-type": "text/plain" }
        });
      }
      if (url.includes("/src/index.ts")) {
        return new Response("console.log('reviewed');", {
          headers: { "content-type": "text/plain" }
        });
      }
      return new Response("not found", { status: 404 });
    };

    const preview = await fetchGitHubSourcePreview({
      repository: "example/repo",
      gitRef: "main",
      fetchFn: fetchFn as typeof fetch
    });

    expect(preview.source_sha).toBe("a".repeat(40));
    expect(preview.files.map((file) => file.path)).toEqual([
      "README.md",
      "src/index.ts"
    ]);
    expect(requested).toContain(
      `https://raw.githubusercontent.com/example/repo/${"a".repeat(40)}/README.md`
    );
    expect(requested).toContain(
      `https://raw.githubusercontent.com/example/repo/${"a".repeat(40)}/src/index.ts`
    );
  });

  test("returns a safe textual live-app summary", async () => {
    const summary = await fetchLiveAppSummary({
      appUrl: "https://example.herokuapp.com/",
      fetchFn: (async () =>
        new Response(
          '<html><head><title>Live App</title><meta name="description" content="Deployed from Slack"></head><body><h1>Hello</h1><script>secret()</script></body></html>',
          { status: 200, headers: { "content-type": "text/html" } }
        )) as typeof fetch
    });

    expect(summary).toMatchObject({
      reachable: true,
      http_status: 200,
      title: "Live App",
      description: "Deployed from Slack",
      text_preview: "Live App Hello"
    });
  });
});

describe("Heroku MCP App HTML", () => {
  test("contains the real logo, source review, tool calls, and auto-polling", () => {
    const html = createHerokuDeployAppHtml({
      logoUrl: "https://example.com/assets/heroku.png"
    });
    expect(html).toContain("https://example.com/assets/heroku.png");
    expect(html).toContain("Deploy reviewed commit");
    expect(html).toContain('name: "deploy_github_repo"');
    expect(html).toContain('name: "get_deployment_status"');
    expect(html).toContain("Source files");
  });
});
