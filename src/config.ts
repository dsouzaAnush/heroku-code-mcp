import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

loadDotEnv();

const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional()
);
const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.url().optional()
);

export function normalizePublicBaseUrl(
  publicBaseUrl?: string,
  herokuAppName?: string
): string | undefined {
  if (publicBaseUrl) {
    return publicBaseUrl.replace(/\/+$/, "");
  }

  if (herokuAppName) {
    return `https://${herokuAppName}.herokuapp.com`;
  }

  return undefined;
}

export function resolveOAuthRedirectUri(input: {
  explicitRedirectUri?: string;
  publicBaseUrl?: string;
  port: number;
}): string {
  if (input.explicitRedirectUri) {
    return input.explicitRedirectUri;
  }

  if (input.publicBaseUrl) {
    return new URL("/oauth/callback", input.publicBaseUrl).toString();
  }

  return `http://localhost:${input.port}/oauth/callback`;
}

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.string().default("info"),
  PUBLIC_BASE_URL: optionalUrl,
  HEROKU_APP_NAME: optionalString,
  MCP_AUTH_TOKEN: optionalString,
  MCP_AUTH_HEADER: z.string().default("authorization"),

  HEROKU_SCHEMA_URL: z.url().default("https://api.heroku.com/schema"),
  HEROKU_API_BASE_URL: z.url().default("https://api.heroku.com"),
  HEROKU_DOC_URL: z.url().default("https://devcenter.heroku.com/articles/platform-api-reference"),
  HEROKU_ACCEPT_HEADER: z
    .string()
    .default("application/vnd.heroku+json; version=3"),
  SCHEMA_REFRESH_MS: z.coerce.number().int().positive().default(60 * 60 * 1000),
  CATALOG_CACHE_PATH: z.string().default("./data/catalog-cache.json"),

  ALLOW_WRITES: z
    .string()
    .default("false")
    .transform((value) => value.toLowerCase() === "true"),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  MAX_RETRIES: z.coerce.number().int().nonnegative().default(2),
  READ_CACHE_TTL_MS: z.coerce.number().int().nonnegative().default(5000),
  EXECUTE_MAX_BODY_BYTES: z.coerce.number().int().positive().default(48_000),
  EXECUTE_BODY_PREVIEW_CHARS: z.coerce.number().int().positive().default(6000),
  USER_ID_HEADER: z.string().default("x-user-id"),
  WRITE_CONFIRMATION_SECRET: z.string().min(8).default("local-dev-secret"),

  TOKEN_STORE_PATH: z.string().default("./data/tokens.json"),
  TOKEN_ENCRYPTION_KEY_BASE64: optionalString,

  HEROKU_OAUTH_CLIENT_ID: optionalString,
  HEROKU_OAUTH_CLIENT_SECRET: optionalString,
  HEROKU_OAUTH_SCOPE: z.string().default("global"),
  HEROKU_OAUTH_AUTHORIZE_URL: z
    .url()
    .default("https://id.heroku.com/oauth/authorize"),
  HEROKU_OAUTH_TOKEN_URL: z
    .url()
    .default("https://id.heroku.com/oauth/token"),
  HEROKU_OAUTH_REDIRECT_URI: optionalUrl
});

const parsed = envSchema.parse(process.env);
const publicBaseUrl = normalizePublicBaseUrl(
  parsed.PUBLIC_BASE_URL,
  parsed.HEROKU_APP_NAME
);

export const appConfig = {
  port: parsed.PORT,
  host: parsed.HOST,
  logLevel: parsed.LOG_LEVEL,
  publicBaseUrl,
  mcpAuthToken: parsed.MCP_AUTH_TOKEN,
  mcpAuthHeader: parsed.MCP_AUTH_HEADER.toLowerCase(),

  herokuSchemaUrl: parsed.HEROKU_SCHEMA_URL,
  herokuApiBaseUrl: parsed.HEROKU_API_BASE_URL,
  herokuDocUrl: parsed.HEROKU_DOC_URL,
  herokuAcceptHeader: parsed.HEROKU_ACCEPT_HEADER,
  schemaRefreshMs: parsed.SCHEMA_REFRESH_MS,
  catalogCachePath: parsed.CATALOG_CACHE_PATH,

  allowWrites: parsed.ALLOW_WRITES,
  requestTimeoutMs: parsed.REQUEST_TIMEOUT_MS,
  maxRetries: parsed.MAX_RETRIES,
  readCacheTtlMs: parsed.READ_CACHE_TTL_MS,
  executeMaxBodyBytes: parsed.EXECUTE_MAX_BODY_BYTES,
  executeBodyPreviewChars: parsed.EXECUTE_BODY_PREVIEW_CHARS,
  userIdHeader: parsed.USER_ID_HEADER.toLowerCase(),
  writeConfirmationSecret: parsed.WRITE_CONFIRMATION_SECRET,

  tokenStorePath: parsed.TOKEN_STORE_PATH,
  tokenEncryptionKeyBase64: parsed.TOKEN_ENCRYPTION_KEY_BASE64,

  oauthClientId: parsed.HEROKU_OAUTH_CLIENT_ID,
  oauthClientSecret: parsed.HEROKU_OAUTH_CLIENT_SECRET,
  oauthScope: parsed.HEROKU_OAUTH_SCOPE,
  oauthAuthorizeUrl: parsed.HEROKU_OAUTH_AUTHORIZE_URL,
  oauthTokenUrl: parsed.HEROKU_OAUTH_TOKEN_URL,
  oauthRedirectUri: resolveOAuthRedirectUri({
    explicitRedirectUri: parsed.HEROKU_OAUTH_REDIRECT_URI,
    publicBaseUrl,
    port: parsed.PORT
  })
};

export type AppConfig = typeof appConfig;
