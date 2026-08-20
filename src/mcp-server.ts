import * as z from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "./config.js";
import type { HerokuOAuthService } from "./auth/oauth-service.js";
import type { HerokuSchemaService } from "./schema/heroku-schema-service.js";
import type { SearchIndex } from "./search/search-index.js";
import { HerokuExecutor, ToolError } from "./execute/heroku-executor.js";
import { getHeaderValue } from "./utils/headers.js";
import type { ExecuteRequest } from "./types.js";

interface ServerDeps {
  config: AppConfig;
  schemaService: HerokuSchemaService;
  searchIndex: SearchIndex;
  oauthService: HerokuOAuthService;
  executor: HerokuExecutor;
}

interface SlackIdentity {
  user_id?: string;
  team_id?: string | null;
  enterprise_id?: string | null;
}

function serializeResult<T extends object>(data: T) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2)
      }
    ],
    structuredContent: data as { [key: string]: unknown }
  };
}

function resolveUserId(
  headerCarrier: unknown,
  userIdHeader: string
): string {
  return (
    getHeaderValue(headerCarrier, userIdHeader) ??
    getHeaderValue(headerCarrier, "x-user-id") ??
    "default"
  );
}

function getSlackIdentity(extra: unknown): SlackIdentity | undefined {
  const meta = (extra as { _meta?: Record<string, unknown> } | undefined)?._meta;
  const slack = meta?.slack;

  if (!slack || typeof slack !== "object") {
    return undefined;
  }

  const candidate = slack as Record<string, unknown>;
  return {
    user_id: typeof candidate.user_id === "string" ? candidate.user_id : undefined,
    team_id:
      typeof candidate.team_id === "string" || candidate.team_id === null
        ? candidate.team_id
        : undefined,
    enterprise_id:
      typeof candidate.enterprise_id === "string" || candidate.enterprise_id === null
        ? candidate.enterprise_id
        : undefined
  };
}

function resolveAuthorizedUserId(extra: unknown, deps: ServerDeps): string {
  if (deps.config.authMode !== "slack_identity") {
    return resolveUserId(
      (extra as { requestInfo?: { headers?: unknown } } | undefined)?.requestInfo?.headers,
      deps.config.userIdHeader
    );
  }

  const slack = getSlackIdentity(extra);
  if (!slack?.user_id || (!slack.team_id && !slack.enterprise_id)) {
    throw new ToolError(
      "Missing Slack identity context. This tool must be called from the configured Slack app.",
      "SLACK_IDENTITY_REQUIRED",
      401
    );
  }

  const teamAllowed =
    Boolean(slack.team_id) && deps.config.slackAllowedTeamIds.includes(slack.team_id as string);
  const enterpriseAllowed =
    Boolean(slack.enterprise_id) &&
    deps.config.slackAllowedEnterpriseIds.includes(slack.enterprise_id as string);

  if (!teamAllowed && !enterpriseAllowed) {
    throw new ToolError(
      "This Slack workspace or enterprise is not authorized for Heroku tools.",
      "SLACK_TENANT_NOT_ALLOWED",
      403
    );
  }

  if (
    deps.config.slackAllowedUserIds.length > 0 &&
    !deps.config.slackAllowedUserIds.includes(slack.user_id)
  ) {
    throw new ToolError(
      "This Slack user is not authorized for Heroku tools.",
      "SLACK_USER_NOT_ALLOWED",
      403
    );
  }

  return slack.user_id;
}

function normalizeBuildResult(options: {
  appName: string;
  githubRepo: string;
  gitRef: string;
  body: unknown;
}) {
  const body =
    options.body && typeof options.body === "object"
      ? (options.body as Record<string, unknown>)
      : {};
  const release =
    body.release && typeof body.release === "object"
      ? (body.release as Record<string, unknown>)
      : undefined;

  return {
    app_name: options.appName,
    github_repo: options.githubRepo,
    git_ref: options.gitRef,
    build_id: typeof body.id === "string" ? body.id : undefined,
    status: typeof body.status === "string" ? body.status : undefined,
    created_at: typeof body.created_at === "string" ? body.created_at : undefined,
    updated_at: typeof body.updated_at === "string" ? body.updated_at : undefined,
    release_id: typeof release?.id === "string" ? release.id : undefined
  };
}

export function normalizeAppList(body: unknown) {
  const apps = Array.isArray(body)
    ? body.flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object") {
          return [];
        }

        const app = candidate as Record<string, unknown>;
        if (typeof app.name !== "string") {
          return [];
        }

        return [
          {
            name: app.name,
            id: typeof app.id === "string" ? app.id : undefined,
            web_url: typeof app.web_url === "string" ? app.web_url : undefined,
            maintenance:
              typeof app.maintenance === "boolean" ? app.maintenance : undefined,
            updated_at: typeof app.updated_at === "string" ? app.updated_at : undefined
          }
        ];
      })
    : [];

  return {
    count: apps.length,
    apps
  };
}

function formatError(error: unknown): string {
  if (error instanceof ToolError) {
    return JSON.stringify(
      {
        code: error.code,
        message: error.message,
        status: error.status
      },
      null,
      2
    );
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function createHerokuMcpServer(deps: ServerDeps): McpServer {
  const server = new McpServer(
    {
      name: "heroku-code-mcp",
      version: "0.1.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.registerTool(
    "search",
    {
      title: "Search Heroku API Operations",
      description:
        "Searches Heroku Platform API operations derived from machine-readable schema and docs context.",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().min(1).max(25).optional(),
        resource_filter: z.array(z.string()).optional()
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true
      }
    },
    async ({ query, limit, resource_filter }, extra) => {
      resolveAuthorizedUserId(extra, deps);
      await deps.schemaService.ensureReady();
      const results = deps.searchIndex.search({
        query,
        limit,
        resourceFilter: resource_filter
      });
      return serializeResult(results);
    }
  );

  if (deps.config.authMode !== "slack_identity" || deps.config.slackEnableGenericExecute) {
    server.registerTool(
      "execute",
      {
        title: "Execute Heroku API Operation",
        description:
          "Validates and executes Heroku Platform API operations by operation_id. For request bodies, pass a JSON object; JSON-string bodies are accepted for Claude Desktop compatibility.",
        inputSchema: {
          operation_id: z.string().min(1),
          path_params: z.record(z.string(), z.string()).optional(),
          query_params: z
            .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
            .optional(),
          body: z
            .union([
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.string()
            ])
            .optional(),
          dry_run: z.boolean().optional(),
          confirm_write_token: z.string().optional()
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: true
        }
      },
      async (args, extra) => {
        try {
          await deps.schemaService.ensureReady();
          const userId = resolveAuthorizedUserId(extra, deps);
          const result = await deps.executor.execute(args as ExecuteRequest, userId);
          return serializeResult(result);
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: formatError(error)
              }
            ]
          };
        }
      }
    );
  }

  if (deps.config.authMode === "slack_identity") {
    server.registerTool(
      "list_apps",
      {
        title: "List Heroku Apps",
        description:
          "Lists the Heroku apps available to the authenticated Heroku service account. Returns app names plus stable identifiers and non-secret status metadata.",
        inputSchema: {},
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: true
        }
      },
      async (_args, extra) => {
        try {
          const userId = resolveAuthorizedUserId(extra, deps);
          await deps.schemaService.ensureReady();
          const result = await deps.executor.execute(
            { operation_id: "GET /apps" },
            userId
          );
          return serializeResult(normalizeAppList(result.body));
        } catch (error) {
          return {
            isError: true,
            content: [{ type: "text", text: formatError(error) }]
          };
        }
      }
    );

    server.registerTool(
      "deploy_github_repo",
      {
        title: "Deploy a GitHub Repository to Heroku",
        description:
          "Starts a Heroku Build API deployment from an allowlisted public GitHub repository to an allowlisted Heroku app. The build runs asynchronously; use get_deployment_status with the returned build ID to check completion.",
        inputSchema: {
          app_name: z.string().regex(/^[a-z][a-z0-9-]{1,28}[a-z0-9]$/),
          github_repo: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
          git_ref: z
            .string()
            .min(1)
            .max(200)
            .regex(/^[A-Za-z0-9._\/-]+$/)
            .default("main")
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true
        }
      },
      async ({ app_name, github_repo, git_ref }, extra) => {
        try {
          const userId = resolveAuthorizedUserId(extra, deps);
          const normalizedRepo = github_repo.toLowerCase();

          if (!deps.config.slackDeployAllowedApps.includes(app_name)) {
            throw new ToolError(
              `App is not allowlisted for Slack deployments: ${app_name}`,
              "DEPLOY_APP_NOT_ALLOWED",
              403
            );
          }

          if (!deps.config.slackDeployAllowedRepos.includes(normalizedRepo)) {
            throw new ToolError(
              `GitHub repository is not allowlisted for Slack deployments: ${github_repo}`,
              "DEPLOY_REPO_NOT_ALLOWED",
              403
            );
          }

          await deps.schemaService.ensureReady();
          const request: ExecuteRequest = {
            operation_id: "POST /apps/{app_identity}/builds",
            path_params: { app_identity: app_name },
            body: {
              source_blob: {
                url: `https://github.com/${github_repo}/archive/${encodeURIComponent(git_ref)}.tar.gz`,
                version: git_ref,
                version_description: `Slackbot deployment of ${github_repo}@${git_ref}`
              }
            }
          };

          const dryRun = await deps.executor.execute({ ...request, dry_run: true }, userId);
          const dryRunBody = dryRun.body as Record<string, unknown>;
          const confirmationToken = dryRunBody.confirm_write_token;
          if (typeof confirmationToken !== "string") {
            throw new ToolError(
              "Heroku deployment preflight did not return a confirmation token.",
              "DEPLOY_PREFLIGHT_FAILED",
              500
            );
          }

          const result = await deps.executor.execute(
            { ...request, confirm_write_token: confirmationToken },
            userId
          );
          return serializeResult(
            normalizeBuildResult({
              appName: app_name,
              githubRepo: github_repo,
              gitRef: git_ref,
              body: result.body
            })
          );
        } catch (error) {
          return {
            isError: true,
            content: [{ type: "text", text: formatError(error) }]
          };
        }
      }
    );

    server.registerTool(
      "get_deployment_status",
      {
        title: "Get Heroku Deployment Status",
        description:
          "Gets the current status of a Heroku build started by deploy_github_repo.",
        inputSchema: {
          app_name: z.string().regex(/^[a-z][a-z0-9-]{1,28}[a-z0-9]$/),
          build_id: z.uuid()
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: true
        }
      },
      async ({ app_name, build_id }, extra) => {
        try {
          const userId = resolveAuthorizedUserId(extra, deps);
          if (!deps.config.slackDeployAllowedApps.includes(app_name)) {
            throw new ToolError(
              `App is not allowlisted for Slack deployments: ${app_name}`,
              "DEPLOY_APP_NOT_ALLOWED",
              403
            );
          }

          await deps.schemaService.ensureReady();
          const result = await deps.executor.execute(
            {
              operation_id: "GET /apps/{app_identity}/builds/{build_identity}",
              path_params: {
                app_identity: app_name,
                build_identity: build_id
              }
            },
            userId
          );

          return serializeResult(
            normalizeBuildResult({
              appName: app_name,
              githubRepo: "",
              gitRef: "",
              body: result.body
            })
          );
        } catch (error) {
          return {
            isError: true,
            content: [{ type: "text", text: formatError(error) }]
          };
        }
      }
    );
  }

  server.registerTool(
    "auth_status",
    {
      title: "Check OAuth Status",
      description: "Returns Heroku authentication status for the current caller.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false
      }
    },
    async (_args, extra) => {
      const userId = resolveAuthorizedUserId(extra, deps);
      if (deps.config.herokuApiToken) {
        return serializeResult({
          authenticated: true,
          scopes: ["heroku_service_token"],
          identity: deps.config.authMode === "slack_identity" ? "slack" : "service"
        });
      }
      const status = await deps.oauthService.getAuthStatus(userId);
      return serializeResult(status);
    }
  );

  return server;
}
