import { randomBytes } from "node:crypto";
import type { Logger } from "pino";
import type { AppConfig } from "../config.js";
import type { AuthStatusResponse, OAuthTokenRecord } from "../types.js";
import { EncryptedTokenStore } from "./token-store.js";

interface PendingState {
  userId: string;
  createdAtMs: number;
}

interface TokenEndpointResponse {
  access_token: string;
  token_type?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

function toIsoFromNow(seconds?: number): string | undefined {
  if (!seconds || Number.isNaN(seconds)) {
    return undefined;
  }
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function parseScope(scope: string | undefined): string[] {
  if (!scope) {
    return [];
  }
  return scope
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export class HerokuOAuthService {
  private stateStore = new Map<string, PendingState>();

  constructor(
    private readonly config: AppConfig,
    private readonly tokenStore: EncryptedTokenStore,
    private readonly logger: Logger,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  buildAuthorizationUrl(userId: string): string {
    if (!this.config.oauthClientId) {
      throw new Error("HEROKU_OAUTH_CLIENT_ID is required for OAuth authorization");
    }

    const state = randomBytes(16).toString("hex");
    this.stateStore.set(state, {
      userId,
      createdAtMs: Date.now()
    });

    const url = new URL(this.config.oauthAuthorizeUrl);
    url.searchParams.set("client_id", this.config.oauthClientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", this.config.oauthScope);
    url.searchParams.set("state", state);
    url.searchParams.set("redirect_uri", this.config.oauthRedirectUri);

    return url.toString();
  }

  async handleOAuthCallback(code: string, state: string): Promise<{ userId: string }> {
    const pending = this.stateStore.get(state);
    if (!pending) {
      throw new Error("Invalid or expired OAuth state");
    }

    this.stateStore.delete(state);

    if (Date.now() - pending.createdAtMs > 10 * 60 * 1000) {
      throw new Error("OAuth state expired");
    }

    const token = await this.exchangeAuthorizationCode(code);
    await this.tokenStore.set(pending.userId, token);

    return { userId: pending.userId };
  }

  async getValidAccessToken(userId: string): Promise<string | null> {
    const record = await this.tokenStore.get(userId);
    if (!record) {
      return null;
    }

    if (!record.expiresAt) {
      return record.accessToken;
    }

    const expiresAtMs = Date.parse(record.expiresAt);
    if (Number.isNaN(expiresAtMs)) {
      return record.accessToken;
    }

    const thresholdMs = 60 * 1000;
    if (Date.now() < expiresAtMs - thresholdMs) {
      return record.accessToken;
    }

    if (!record.refreshToken) {
      this.logger.warn({ userId }, "OAuth token expired and no refresh token is present");
      return null;
    }

    const refreshed = await this.refreshAccessToken(record.refreshToken);
    await this.tokenStore.set(userId, refreshed);
    return refreshed.accessToken;
  }

  async getAuthStatus(userId: string): Promise<AuthStatusResponse> {
    const record = await this.tokenStore.get(userId);
    if (!record) {
      return {
        authenticated: false,
        scopes: []
      };
    }

    return {
      authenticated: true,
      scopes: record.scope,
      expires_at: record.expiresAt
    };
  }

  private async exchangeAuthorizationCode(code: string): Promise<OAuthTokenRecord> {
    if (!this.config.oauthClientId || !this.config.oauthClientSecret) {
      throw new Error(
        "HEROKU_OAUTH_CLIENT_ID and HEROKU_OAUTH_CLIENT_SECRET are required"
      );
    }

    const payload = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: this.config.oauthClientId,
      client_secret: this.config.oauthClientSecret,
      redirect_uri: this.config.oauthRedirectUri
    });

    const response = await this.fetchFn(this.config.oauthTokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: payload.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Heroku OAuth token exchange failed: ${response.status} ${errorText}`);
    }

    const parsed = (await response.json()) as TokenEndpointResponse;
    return {
      accessToken: parsed.access_token,
      tokenType: parsed.token_type ?? "Bearer",
      refreshToken: parsed.refresh_token,
      scope: parseScope(parsed.scope),
      expiresAt: toIsoFromNow(parsed.expires_in),
      obtainedAt: new Date().toISOString()
    };
  }

  private async refreshAccessToken(refreshToken: string): Promise<OAuthTokenRecord> {
    if (!this.config.oauthClientId || !this.config.oauthClientSecret) {
      throw new Error(
        "HEROKU_OAUTH_CLIENT_ID and HEROKU_OAUTH_CLIENT_SECRET are required"
      );
    }

    const payload = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.config.oauthClientId,
      client_secret: this.config.oauthClientSecret
    });

    const response = await this.fetchFn(this.config.oauthTokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: payload.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Heroku OAuth refresh failed: ${response.status} ${errorText}`);
    }

    const parsed = (await response.json()) as TokenEndpointResponse;
    return {
      accessToken: parsed.access_token,
      tokenType: parsed.token_type ?? "Bearer",
      refreshToken: parsed.refresh_token ?? refreshToken,
      scope: parseScope(parsed.scope),
      expiresAt: toIsoFromNow(parsed.expires_in),
      obtainedAt: new Date().toISOString()
    };
  }

  purgeExpiredState(): void {
    const now = Date.now();
    for (const [state, pending] of this.stateStore.entries()) {
      if (now - pending.createdAtMs > 10 * 60 * 1000) {
        this.stateStore.delete(state);
      }
    }
  }
}
