import * as z from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "./config.js";
import type { HerokuOAuthService } from "./auth/oauth-service.js";
import type { HerokuSchemaService } from "./schema/heroku-schema-service.js";
import type { SearchIndex } from "./search/search-index.js";
import { HerokuExecutor, ToolError } from "./execute/heroku-executor.js";
import {
  fetchGitHubSourcePreview,
  fetchLiveAppSummary,
  type GitHubSourcePreview
} from "./github/source-preview.js";
import {
  createHerokuDeployAppHtml,
  HEROKU_DEPLOY_UI_URI,
  MCP_APP_MIME_TYPE
} from "./ui/heroku-deploy-app.js";
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

function getPublicBaseUrl(deps: ServerDeps): string {
  return deps.config.publicBaseUrl ?? "http://127.0.0.1:3000";
}

function getHerokuLogoUrl(deps: ServerDeps): string {
  return new URL("/assets/heroku-slack-app-icon.png", getPublicBaseUrl(deps)).toString();
}

function getAppLinks(appName: string) {
  return {
    name: appName,
    web_url: `https://${appName}.herokuapp.com/`,
    dashboard_url: `https://dashboard.heroku.com/apps/${appName}`,
    activity_url: `https://dashboard.heroku.com/apps/${appName}/activity`
  };
}

function richToolMeta() {
  return {
    ui: { resourceUri: HEROKU_DEPLOY_UI_URI },
    slack: { supportsBlockKit: true }
  };
}

function richResult<T extends object>(input: {
  data: T;
  text: string;
  blocks: Array<Record<string, unknown>>;
}) {
  return {
    content: [{ type: "text" as const, text: input.text }],
    structuredContent: input.data as { [key: string]: unknown },
    _meta: {
      ui: { resourceUri: HEROKU_DEPLOY_UI_URI },
      slack: { blocks: input.blocks }
    }
  };
}

function herokuContextBlock(deps: ServerDeps): Record<string, unknown> {
  return {
    type: "context",
    elements: [
      {
        type: "image",
        image_url: getHerokuLogoUrl(deps),
        alt_text: "Heroku"
      },
      { type: "mrkdwn", text: "*Heroku MCP* · Slackbot deployment workspace" }
    ]
  };
}

function appListBlocks(
  deps: ServerDeps,
  data: ReturnType<typeof normalizeAppList>,
  deploymentStarter?: {
    app_name: string;
    github_repo: string;
    git_ref: string;
  }
): Array<Record<string, unknown>> {
  const appBlocks = data.apps.slice(0, 12).map((app) => ({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*${app.name}*\n${app.maintenance ? "Maintenance mode" : "Available"}${app.updated_at ? ` · updated ${app.updated_at}` : ""}`
    },
    ...(deploymentStarter?.app_name === app.name
      ? {
          accessory: {
            type: "button",
            text: { type: "plain_text", text: "Review source" },
            style: "primary",
            action_id: "tool:preview_github_deployment",
            value: JSON.stringify(deploymentStarter)
          }
        }
      : app.web_url
      ? {
          accessory: {
            type: "button",
            text: { type: "plain_text", text: "Open app" },
            url: app.web_url,
            action_id: `open_${app.name}`
          }
      }
    : {})
  }));

  return [
    herokuContextBlock(deps),
    {
      type: "header",
      text: { type: "plain_text", text: `Heroku apps (${data.count})` }
    },
    ...appBlocks
  ];
}

function previewBlocks(input: {
  deps: ServerDeps;
  appName: string;
  source: GitHubSourcePreview;
}): Array<Record<string, unknown>> {
  const deployArgs = JSON.stringify({
    app_name: input.appName,
    github_repo: input.source.repository,
    git_ref: input.source.git_ref,
    source_sha: input.source.source_sha
  });
  const firstFile = input.source.files[0];
  const codePreview = firstFile
    ? firstFile.content.slice(0, 1800)
    : "No previewable text files were found.";
  return [
    herokuContextBlock(input.deps),
    {
      type: "header",
      text: { type: "plain_text", text: "Review before deployment" }
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Existing app*\n${input.appName}`
        },
        {
          type: "mrkdwn",
          text: `*Reviewed source*\n${input.source.repository}@${input.source.git_ref} · ${input.source.source_sha.slice(0, 10)}`
        }
      ]
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${firstFile?.path ?? "Source preview"}*\n\`\`\`${codePreview}\`\`\``
      }
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Deploy reviewed commit" },
          style: "primary",
          action_id: "tool:deploy_github_repo",
          value: deployArgs
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Open commit" },
          url: input.source.commit_url,
          action_id: "open_reviewed_commit"
        }
      ]
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `No new app will be created. This deploy reuses *${input.appName}*.` }
      ]
    }
  ];
}

function deploymentBlocks(input: {
  deps: ServerDeps;
  data: Record<string, unknown>;
  appName: string;
  status?: string;
}): Array<Record<string, unknown>> {
  const app = getAppLinks(input.appName);
  const status = input.status ?? "pending";
  const complete = status === "succeeded" || status === "failed";
  return [
    herokuContextBlock(input.deps),
    {
      type: "header",
      text: {
        type: "plain_text",
        text: status === "succeeded" ? "Deployment is live" : status === "failed" ? "Deployment failed" : "Deployment started"
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${input.appName}*\nCode reviewed ✓ · Existing app reused ✓ · Build ${status}`
      }
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: complete && status === "succeeded" ? "Open live app" : "Open app" },
          style: status === "succeeded" ? "primary" : undefined,
          url: app.web_url,
          action_id: "open_live_app"
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Build activity and logs" },
          url: app.activity_url,
          action_id: "open_build_activity"
        }
      ]
    }
  ];
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

export function isLiveAppListQuery(query: string): boolean {
  const normalized = query
    .toLowerCase()
    .replace(/[_/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (
    /\blist\b.*\bapps?\b/.test(normalized) ||
    /\bapps?\b.*\blist\b/.test(normalized) ||
    normalized.includes("get apps")
  );
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
      const userId = resolveAuthorizedUserId(extra, deps);
      await deps.schemaService.ensureReady();
      const results = deps.searchIndex.search({
        query,
        limit,
        resourceFilter: resource_filter
      });

      // Slackbot may retain an older tool catalog briefly after a server update.
      // Keep this read-only compatibility path so its already-cached search tool
      // can complete the first live app-listing scenario without a generic
      // executor or any write access.
      if (isLiveAppListQuery(query)) {
        const apps = await deps.executor.listApps(userId);
        return serializeResult({
          matching_operations: results,
          live_app_list: normalizeAppList(apps)
        });
      }

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
        },
        _meta: richToolMeta()
      },
      async (_args, extra) => {
        try {
          const userId = resolveAuthorizedUserId(extra, deps);
          await deps.schemaService.ensureReady();
          const apps = await deps.executor.listApps(userId);
          const normalized = normalizeAppList(apps);
          const deploymentApp = normalized.apps.find(
            (app) =>
              deps.config.slackDeployAllowedApps.includes(app.name) &&
              !new URL(getPublicBaseUrl(deps)).hostname.startsWith(`${app.name}.`)
          );
          const deploymentRepo =
            deps.config.slackDeployAllowedRepos.find(
              (repo) => repo === "heroku/nodejs-getting-started"
            ) ?? deps.config.slackDeployAllowedRepos[0];
          const deploymentStarter =
            deploymentApp && deploymentRepo
              ? {
                  app_name: deploymentApp.name,
                  github_repo: deploymentRepo,
                  git_ref: "main"
                }
              : undefined;
          const data = { view: "app_list", ...normalized, deployment_starter: deploymentStarter };
          return richResult({
            data,
            text: `Found ${normalized.count} Heroku apps.`,
            blocks: appListBlocks(deps, normalized, deploymentStarter)
          });
        } catch (error) {
          return {
            isError: true,
            content: [{ type: "text", text: formatError(error) }]
          };
        }
      }
    );

    server.registerTool(
      "preview_github_deployment",
      {
        title: "Review GitHub Source Before Heroku Deployment",
        description:
          "Required read-only first step before deploy_github_repo. Resolves a public allowlisted GitHub ref to an immutable commit, returns a source-file preview, and shows the exact existing Heroku app that would receive it. Call this before asking the user to approve deployment.",
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
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: true
        },
        _meta: richToolMeta()
      },
      async ({ app_name, github_repo, git_ref }, extra) => {
        try {
          resolveAuthorizedUserId(extra, deps);
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

          const source = await fetchGitHubSourcePreview({
            repository: github_repo,
            gitRef: git_ref
          });
          const data = {
            view: "deployment_preview",
            status: "ready_to_deploy",
            app: getAppLinks(app_name),
            source
          };
          return richResult({
            data,
            text: `Reviewed ${github_repo}@${git_ref} at ${source.source_sha}. It is ready to deploy to the existing app ${app_name}.`,
            blocks: previewBlocks({ deps, appName: app_name, source })
          });
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
          "Deploys an exact Git commit that the user already reviewed through preview_github_deployment. Requires the immutable source_sha returned by that preview, rechecks the ref before deployment, reuses an allowlisted existing Heroku app, and never creates another app. The build runs asynchronously and the rich view polls get_deployment_status.",
        inputSchema: {
          app_name: z.string().regex(/^[a-z][a-z0-9-]{1,28}[a-z0-9]$/),
          github_repo: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
          git_ref: z
            .string()
            .min(1)
            .max(200)
            .regex(/^[A-Za-z0-9._\/-]+$/)
            .default("main"),
          source_sha: z
            .string()
            .regex(/^[a-f0-9]{40}$/i)
            .describe("Immutable commit SHA returned by preview_github_deployment")
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true
        },
        _meta: richToolMeta()
      },
      async ({ app_name, github_repo, git_ref, source_sha }, extra) => {
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

          const reviewedSource = await fetchGitHubSourcePreview({
            repository: github_repo,
            gitRef: git_ref
          });
          if (reviewedSource.source_sha.toLowerCase() !== source_sha.toLowerCase()) {
            throw new ToolError(
              `The Git ref changed after review. Preview it again before deploying. Reviewed ${source_sha}, current ${reviewedSource.source_sha}.`,
              "SOURCE_CHANGED_AFTER_PREVIEW",
              409
            );
          }

          await deps.schemaService.ensureReady();
          const request: ExecuteRequest = {
            operation_id: "POST /apps/{app_identity}/builds",
            path_params: { app_identity: app_name },
            body: {
              source_blob: {
                url: `https://github.com/${github_repo}/archive/${source_sha}.tar.gz`,
                version: source_sha,
                version_description: `Slackbot deployment of reviewed ${github_repo}@${source_sha.slice(0, 10)}`
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
          const normalized = normalizeBuildResult({
              appName: app_name,
              githubRepo: github_repo,
              gitRef: git_ref,
              body: result.body
            });
          const data = {
            view: "deployment",
            app: getAppLinks(app_name),
            source: {
              repository: github_repo,
              git_ref,
              source_sha,
              commit_url: reviewedSource.commit_url
            },
            build: {
              id: normalized.build_id,
              status: normalized.status ?? "pending",
              created_at: normalized.created_at,
              updated_at: normalized.updated_at,
              release_id: normalized.release_id
            }
          };
          return richResult({
            data,
            text: `Started deployment of reviewed commit ${source_sha.slice(0, 10)} to ${app_name}. Build ID: ${normalized.build_id ?? "pending"}.`,
            blocks: deploymentBlocks({
              deps,
              data,
              appName: app_name,
              status: normalized.status ?? "pending"
            })
          });
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
        },
        _meta: richToolMeta()
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

          const normalized = normalizeBuildResult({
              appName: app_name,
              githubRepo: "",
              gitRef: "",
              body: result.body
            });
          const app = getAppLinks(app_name);
          const livePreview =
            normalized.status === "succeeded"
              ? await fetchLiveAppSummary({ appUrl: app.web_url })
              : undefined;
          const data = {
            view: "deployment_status",
            app,
            build: {
              id: normalized.build_id ?? build_id,
              status: normalized.status ?? "pending",
              created_at: normalized.created_at,
              updated_at: normalized.updated_at,
              release_id: normalized.release_id
            },
            live_preview: livePreview
          };
          return richResult({
            data,
            text: `Heroku build ${build_id} for ${app_name} is ${normalized.status ?? "pending"}.`,
            blocks: deploymentBlocks({
              deps,
              data,
              appName: app_name,
              status: normalized.status ?? "pending"
            })
          });
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

  const publicBaseUrl = getPublicBaseUrl(deps);
  const publicOrigin = new URL(publicBaseUrl).origin;
  const resourceUiMeta = {
    ui: {
      csp: {
        resourceDomains: ["https://esm.sh", publicOrigin],
        connectDomains: ["https://esm.sh"]
      },
      prefersBorder: true
    }
  };
  server.registerResource(
    "Heroku deployment workspace",
    HEROKU_DEPLOY_UI_URI,
    {
      title: "Heroku deployment workspace",
      description:
        "Interactive source review, immutable-commit deployment, build progress, logs, and live-app preview for Slackbot.",
      mimeType: MCP_APP_MIME_TYPE,
      _meta: resourceUiMeta
    },
    async () => ({
      contents: [
        {
          uri: HEROKU_DEPLOY_UI_URI,
          mimeType: MCP_APP_MIME_TYPE,
          text: createHerokuDeployAppHtml({ logoUrl: getHerokuLogoUrl(deps) }),
          _meta: resourceUiMeta
        }
      ]
    })
  );

  return server;
}
