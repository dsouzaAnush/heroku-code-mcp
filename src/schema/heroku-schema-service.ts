import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Logger } from "pino";
import type { AppConfig } from "../config.js";
import type { HerokuOperation, JsonSchema } from "../types.js";
import { normalizeHerokuSchema } from "./catalog.js";

interface CatalogCachePayload {
  version: 1;
  cachedAt: string;
  schemaEtag?: string;
  docsEtag?: string;
  docsLastModified?: string;
  operations: HerokuOperation[];
  rootSchema: JsonSchema;
  docsContext: string;
}

interface DocsRefreshResult {
  changed: boolean;
}

function stripHtml(input: string): string {
  return input
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export class HerokuSchemaService {
  private operations: HerokuOperation[] = [];

  private operationById = new Map<string, HerokuOperation>();

  private rootSchema?: JsonSchema;

  private docsContext = "";

  private etag?: string;

  private docsEtag?: string;

  private docsLastModified?: string;

  private refreshInFlight?: Promise<void>;

  private cacheLoaded = false;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  async bootstrapFromCache(): Promise<void> {
    if (this.cacheLoaded) {
      return;
    }
    this.cacheLoaded = true;

    try {
      const raw = await readFile(this.config.catalogCachePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<CatalogCachePayload>;

      if (
        parsed.version !== 1 ||
        !Array.isArray(parsed.operations) ||
        !parsed.rootSchema ||
        typeof parsed.docsContext !== "string"
      ) {
        this.logger.warn(
          { path: this.config.catalogCachePath },
          "Ignoring invalid schema cache payload"
        );
        return;
      }

      this.operations = parsed.operations;
      this.rootSchema = parsed.rootSchema as JsonSchema;
      this.operationById = new Map(
        parsed.operations.map((operation) => [operation.operationId, operation])
      );
      this.docsContext = parsed.docsContext;
      this.etag = parsed.schemaEtag;
      this.docsEtag = parsed.docsEtag;
      this.docsLastModified = parsed.docsLastModified;

      this.logger.info(
        {
          path: this.config.catalogCachePath,
          operations: this.operations.length
        },
        "Loaded Heroku schema catalog cache"
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.logger.warn(
          { err: error, path: this.config.catalogCachePath },
          "Failed to load Heroku schema cache"
        );
      }
    }
  }

  async ensureReady(): Promise<void> {
    await this.bootstrapFromCache();

    if (this.operations.length > 0) {
      return;
    }

    await this.refresh(true);
  }

  async refresh(force = false): Promise<void> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    this.refreshInFlight = this.refreshInternal(force);
    try {
      await this.refreshInFlight;
    } finally {
      this.refreshInFlight = undefined;
    }
  }

  private async refreshInternal(force: boolean): Promise<void> {
    await this.bootstrapFromCache();

    const headers: HeadersInit = {
      Accept: this.config.herokuAcceptHeader
    };

    if (!force && this.etag) {
      headers["If-None-Match"] = this.etag;
    }

    const response = await this.fetchFn(this.config.herokuSchemaUrl, {
      method: "GET",
      headers
    });

    let catalogChanged = false;

    if (response.status === 304) {
      if (this.operations.length === 0) {
        this.logger.warn(
          "Heroku schema returned 304 but no in-memory catalog exists; refetching"
        );
        await this.refreshInternal(true);
        return;
      }

      this.logger.debug("Heroku schema not modified (etag hit)");
    } else {
      if (!response.ok) {
        throw new Error(`Failed to fetch Heroku schema: HTTP ${response.status}`);
      }

      this.etag = response.headers.get("etag") ?? this.etag;

      const schema = (await response.json()) as JsonSchema;
      const normalized = normalizeHerokuSchema(schema);
      this.operations = normalized.operations;
      this.rootSchema = normalized.rootSchema;
      this.operationById = new Map(
        normalized.operations.map((operation) => [operation.operationId, operation])
      );

      catalogChanged = true;
      this.logger.info({ count: this.operations.length }, "Heroku schema catalog refreshed");
    }

    const docsRefresh = await this.refreshDocumentationContext(force || catalogChanged);

    if (catalogChanged || docsRefresh.changed) {
      await this.persistCache();
    }
  }

  private async refreshDocumentationContext(force: boolean): Promise<DocsRefreshResult> {
    try {
      const headers: HeadersInit = {
        Accept: "text/html"
      };

      if (!force && this.docsEtag) {
        headers["If-None-Match"] = this.docsEtag;
      }
      if (!force && !this.docsEtag && this.docsLastModified) {
        headers["If-Modified-Since"] = this.docsLastModified;
      }

      const response = await this.fetchFn(this.config.herokuDocUrl, {
        method: "GET",
        headers
      });

      if (response.status === 304) {
        this.logger.debug("Heroku docs context not modified (etag/last-modified hit)");
        return { changed: false };
      }

      if (!response.ok) {
        this.logger.warn(
          { status: response.status },
          "Failed to fetch Heroku docs context"
        );
        return { changed: false };
      }

      this.docsEtag = response.headers.get("etag") ?? this.docsEtag;
      this.docsLastModified =
        response.headers.get("last-modified") ?? this.docsLastModified;

      const html = await response.text();
      const compact = stripHtml(html).slice(0, 30_000);

      if (compact === this.docsContext) {
        return { changed: false };
      }

      this.docsContext = compact;
      return { changed: true };
    } catch (error) {
      this.logger.warn({ err: error }, "Error fetching Heroku docs context");
      return { changed: false };
    }
  }

  private async persistCache(): Promise<void> {
    if (!this.rootSchema) {
      return;
    }

    const payload: CatalogCachePayload = {
      version: 1,
      cachedAt: new Date().toISOString(),
      schemaEtag: this.etag,
      docsEtag: this.docsEtag,
      docsLastModified: this.docsLastModified,
      operations: this.operations,
      rootSchema: this.rootSchema,
      docsContext: this.docsContext
    };

    try {
      await mkdir(dirname(this.config.catalogCachePath), { recursive: true });
      await writeFile(
        this.config.catalogCachePath,
        JSON.stringify(payload),
        "utf8"
      );
    } catch (error) {
      this.logger.warn(
        { err: error, path: this.config.catalogCachePath },
        "Failed to persist Heroku schema cache"
      );
    }
  }

  getOperations(): HerokuOperation[] {
    return this.operations;
  }

  getOperation(operationId: string): HerokuOperation | undefined {
    return this.operationById.get(operationId);
  }

  getRootSchema(): JsonSchema | undefined {
    return this.rootSchema;
  }

  getDocsContext(): string {
    return this.docsContext;
  }
}
