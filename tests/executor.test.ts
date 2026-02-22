import { describe, expect, test } from "vitest";
import pino from "pino";
import { HerokuExecutor, ToolError } from "../src/execute/heroku-executor.js";
import type { AppConfig } from "../src/config.js";
import type { HerokuOperation, JsonSchema } from "../src/types.js";

const baseConfig: AppConfig = {
  port: 3000,
  host: "0.0.0.0",
  logLevel: "silent",
  herokuSchemaUrl: "https://api.heroku.com/schema",
  herokuApiBaseUrl: "https://api.heroku.com",
  herokuDocUrl: "https://devcenter.heroku.com/articles/platform-api-reference",
  herokuAcceptHeader: "application/vnd.heroku+json; version=3",
  schemaRefreshMs: 3600000,
  catalogCachePath: "./data/catalog-cache.test.json",
  allowWrites: false,
  requestTimeoutMs: 5000,
  maxRetries: 2,
  readCacheTtlMs: 5000,
  executeMaxBodyBytes: 48000,
  executeBodyPreviewChars: 6000,
  userIdHeader: "x-user-id",
  writeConfirmationSecret: "unit-test-secret",
  tokenStorePath: "./data/tokens.test.json",
  tokenEncryptionKeyBase64: Buffer.alloc(32, 1).toString("base64"),
  oauthClientId: undefined,
  oauthClientSecret: undefined,
  oauthScope: "global",
  oauthAuthorizeUrl: "https://id.heroku.com/oauth/authorize",
  oauthTokenUrl: "https://id.heroku.com/oauth/token",
  oauthRedirectUri: "http://localhost:3000/oauth/callback"
};

function makeExecutor(options: {
  operation: HerokuOperation;
  rootSchema?: JsonSchema;
  allowWrites?: boolean;
  fetchFn?: typeof fetch;
  configOverrides?: Partial<AppConfig>;
}) {
  const config = {
    ...baseConfig,
    allowWrites: options.allowWrites ?? false,
    ...options.configOverrides
  };

  return new HerokuExecutor({
    config,
    logger: pino({ enabled: false }),
    getOperation: (operationId) =>
      operationId === options.operation.operationId ? options.operation : undefined,
    getRootSchema: () => options.rootSchema,
    getAccessToken: async () => "access-token",
    fetchFn: options.fetchFn
  });
}

describe("HerokuExecutor", () => {
  test("fails preflight when required path param is missing", async () => {
    const operation: HerokuOperation = {
      operationId: "GET /apps/{app_identity}",
      method: "GET",
      pathTemplate: "/apps/{app_identity}",
      rawHref: "/apps/{app_identity}",
      definitionName: "app",
      pathParams: [{ name: "app_identity" }],
      requiredParams: ["app_identity"],
      isMutating: false,
      searchText: ""
    };

    const executor = makeExecutor({ operation, rootSchema: { definitions: {} } });

    await expect(
      executor.execute({ operation_id: operation.operationId }, "u1")
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  test("rejects invalid body against request schema", async () => {
    const operation: HerokuOperation = {
      operationId: "POST /apps",
      method: "POST",
      pathTemplate: "/apps",
      rawHref: "/apps",
      definitionName: "app",
      pathParams: [],
      requiredParams: ["body.name"],
      isMutating: true,
      searchText: "",
      requestSchema: {
        type: ["object"],
        required: ["name"],
        properties: {
          name: { type: ["string"] }
        }
      }
    };

    const executor = makeExecutor({ operation, rootSchema: { definitions: {} } });

    await expect(
      executor.execute({ operation_id: operation.operationId, body: {} }, "u1")
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  test("returns dry_run confirm token for mutating operation", async () => {
    const operation: HerokuOperation = {
      operationId: "POST /apps",
      method: "POST",
      pathTemplate: "/apps",
      rawHref: "/apps",
      definitionName: "app",
      pathParams: [],
      requiredParams: [],
      isMutating: true,
      searchText: ""
    };

    const executor = makeExecutor({ operation, rootSchema: { definitions: {} } });

    const result = await executor.execute(
      {
        operation_id: operation.operationId,
        dry_run: true,
        body: { name: "demo" }
      },
      "u1"
    );

    expect(result.status).toBe(0);
    expect(result.body).toMatchObject({
      dry_run: true
    });
    expect((result.body as Record<string, unknown>).confirm_write_token).toBeTruthy();
  });

  test("retries idempotent read calls", async () => {
    const operation: HerokuOperation = {
      operationId: "GET /apps",
      method: "GET",
      pathTemplate: "/apps",
      rawHref: "/apps",
      definitionName: "app",
      pathParams: [],
      requiredParams: [],
      isMutating: false,
      searchText: ""
    };

    let calls = 0;
    const fetchFn: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ message: "retry" }), {
          status: 500,
          headers: {
            "content-type": "application/json"
          }
        });
      }
      return new Response(JSON.stringify({ data: [{ id: "app-1" }] }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "request-id": "req-123"
        }
      });
    };

    const executor = makeExecutor({
      operation,
      rootSchema: { definitions: {} },
      fetchFn
    });

    const result = await executor.execute({ operation_id: operation.operationId }, "u1");

    expect(calls).toBe(2);
    expect(result.status).toBe(200);
    expect(result.request_id).toBe("req-123");
  });

  test("serves repeated read requests from short TTL cache", async () => {
    const operation: HerokuOperation = {
      operationId: "GET /apps",
      method: "GET",
      pathTemplate: "/apps",
      rawHref: "/apps",
      definitionName: "app",
      pathParams: [],
      requiredParams: [],
      isMutating: false,
      searchText: ""
    };

    let calls = 0;
    const fetchFn: typeof fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ data: [{ id: "app-1" }] }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "request-id": "req-cache"
        }
      });
    };

    const executor = makeExecutor({
      operation,
      rootSchema: { definitions: {} },
      fetchFn,
      configOverrides: { readCacheTtlMs: 60_000 }
    });

    await executor.execute({ operation_id: operation.operationId }, "u1");
    const second = await executor.execute({ operation_id: operation.operationId }, "u1");

    expect(calls).toBe(1);
    expect(second.warnings).toContain("served_from_read_cache");
  });

  test("truncates oversized response body", async () => {
    const operation: HerokuOperation = {
      operationId: "GET /apps",
      method: "GET",
      pathTemplate: "/apps",
      rawHref: "/apps",
      definitionName: "app",
      pathParams: [],
      requiredParams: [],
      isMutating: false,
      searchText: ""
    };

    const huge = "x".repeat(5000);
    const fetchFn: typeof fetch = async () =>
      new Response(JSON.stringify({ data: huge }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });

    const executor = makeExecutor({
      operation,
      rootSchema: { definitions: {} },
      fetchFn,
      configOverrides: {
        executeMaxBodyBytes: 256,
        executeBodyPreviewChars: 64
      }
    });

    const result = await executor.execute({ operation_id: operation.operationId }, "u1");
    expect(result.warnings?.[0]).toContain("response_body_truncated");
    expect(result.body).toMatchObject({
      truncated: true
    });
  });

  test("blocks writes when ALLOW_WRITES is false", async () => {
    const operation: HerokuOperation = {
      operationId: "PATCH /apps/{app_identity}",
      method: "PATCH",
      pathTemplate: "/apps/{app_identity}",
      rawHref: "/apps/{app_identity}",
      definitionName: "app",
      pathParams: [{ name: "app_identity" }],
      requiredParams: ["app_identity"],
      isMutating: true,
      searchText: ""
    };

    const executor = makeExecutor({ operation, rootSchema: { definitions: {} } });

    await expect(
      executor.execute(
        {
          operation_id: operation.operationId,
          path_params: { app_identity: "my-app" },
          confirm_write_token: "anything"
        },
        "u1"
      )
    ).rejects.toMatchObject({ code: "WRITES_DISABLED" });
  });

  test("returns auth error without token", async () => {
    const operation: HerokuOperation = {
      operationId: "GET /apps",
      method: "GET",
      pathTemplate: "/apps",
      rawHref: "/apps",
      definitionName: "app",
      pathParams: [],
      requiredParams: [],
      isMutating: false,
      searchText: ""
    };

    const executor = new HerokuExecutor({
      config: baseConfig,
      logger: pino({ enabled: false }),
      getOperation: () => operation,
      getRootSchema: () => ({ definitions: {} }),
      getAccessToken: async () => null,
      fetchFn: async () => {
        throw new ToolError("should not call", "TEST_ERROR");
      }
    });

    await expect(
      executor.execute({ operation_id: operation.operationId }, "u1")
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });
});
