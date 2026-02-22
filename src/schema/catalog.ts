import type { HerokuOperation, JsonSchema, NormalizedCatalog, PathParameter } from "../types.js";

type LinkLike = {
  href?: unknown;
  method?: unknown;
  rel?: unknown;
  title?: unknown;
  description?: unknown;
  schema?: unknown;
  targetSchema?: unknown;
};

interface DefinitionLike {
  links?: unknown;
}

interface RootSchemaLike {
  definitions?: Record<string, DefinitionLike>;
}

function sanitizeParamName(value: string, fallbackIndex: number): string {
  let sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!sanitized) {
    sanitized = `param_${fallbackIndex}`;
  }

  if (/^\d/.test(sanitized)) {
    sanitized = `p_${sanitized}`;
  }

  return sanitized;
}

function refToParamName(ref: string, fallbackIndex: number): string {
  const parts = ref.replace(/^#\//, "").split("/").filter(Boolean);
  const definitionNames: string[] = [];

  for (let index = 0; index < parts.length - 1; index += 1) {
    if (parts[index] === "definitions") {
      definitionNames.push(parts[index + 1] ?? "");
    }
  }

  if (definitionNames.length >= 2) {
    return sanitizeParamName(
      `${definitionNames[0]}_${definitionNames[definitionNames.length - 1]}`,
      fallbackIndex
    );
  }

  if (definitionNames.length === 1) {
    return sanitizeParamName(definitionNames[0] ?? "", fallbackIndex);
  }

  const lastSegment = parts[parts.length - 1] ?? `param_${fallbackIndex}`;
  return sanitizeParamName(lastSegment, fallbackIndex);
}

function normalizeHrefToPath(
  rawHref: string
): { pathTemplate: string; pathParams: PathParameter[] } {
  const href = rawHref.startsWith("http")
    ? new URL(rawHref).pathname
    : rawHref;

  const pathParams: PathParameter[] = [];
  const usedNames = new Set<string>();
  let placeholderIndex = 0;

  const withDecodedRefs = href.replace(/\{\(([^}]+)\)\}/g, (_match, encodedRef) => {
    const decoded = decodeURIComponent(String(encodedRef));
    let name = refToParamName(decoded, placeholderIndex);
    while (usedNames.has(name)) {
      name = `${name}_${placeholderIndex}`;
    }
    usedNames.add(name);
    pathParams.push({ name, sourceRef: decoded });
    placeholderIndex += 1;
    return `{${name}}`;
  });

  const normalized = withDecodedRefs.replace(/\{([^{}]+)\}/g, (match, rawName) => {
    if (match.startsWith("{(") && match.endsWith(")}")) {
      return match;
    }

    const name = sanitizeParamName(String(rawName), placeholderIndex);
    if (!usedNames.has(name)) {
      usedNames.add(name);
      pathParams.push({ name });
    }

    placeholderIndex += 1;
    return `{${name}}`;
  });

  return {
    pathTemplate: normalized,
    pathParams
  };
}

function coerceMethod(value: unknown): string {
  const raw = typeof value === "string" ? value : "GET";
  return raw.toUpperCase();
}

function asObject(value: unknown): JsonSchema | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as JsonSchema;
  }
  return undefined;
}

function operationSummary(link: LinkLike): string {
  const title = typeof link.title === "string" ? link.title : "";
  const description = typeof link.description === "string" ? link.description : "";
  const rel = typeof link.rel === "string" ? link.rel : "";

  return [title, description, rel]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" - ");
}

export function normalizeHerokuSchema(rootSchema: JsonSchema): NormalizedCatalog {
  const root = rootSchema as RootSchemaLike;
  const definitions = root.definitions ?? {};
  const deduped = new Map<string, HerokuOperation>();

  for (const [definitionName, definition] of Object.entries(definitions)) {
    if (!definition || !Array.isArray(definition.links)) {
      continue;
    }

    for (const linkRaw of definition.links) {
      const link = (linkRaw ?? {}) as LinkLike;
      if (typeof link.href !== "string") {
        continue;
      }

      const method = coerceMethod(link.method);
      const { pathTemplate, pathParams } = normalizeHrefToPath(link.href);
      const key = `${method} ${pathTemplate}`;

      const bodySchema = asObject(link.schema);
      const bodyRequired = Array.isArray(bodySchema?.required)
        ? (bodySchema.required as unknown[])
            .filter((item): item is string => typeof item === "string")
            .map((item) => `body.${item}`)
        : [];

      const requiredParams = [...pathParams.map((param) => param.name), ...bodyRequired];
      const isMutating = !["GET", "HEAD"].includes(method);
      const summary = operationSummary(link);
      const searchText = [
        definitionName,
        method,
        pathTemplate,
        typeof link.rel === "string" ? link.rel : "",
        typeof link.title === "string" ? link.title : "",
        typeof link.description === "string" ? link.description : "",
        ...requiredParams
      ]
        .join(" ")
        .toLowerCase();

      const existing = deduped.get(key);
      if (existing) {
        const mergedSummary = [existing.description, summary]
          .filter(Boolean)
          .join(" ")
          .trim();
        existing.description = mergedSummary || existing.description;
        existing.requiredParams = Array.from(
          new Set([...existing.requiredParams, ...requiredParams])
        );
        existing.searchText = `${existing.searchText} ${searchText}`;
        continue;
      }

      const operation: HerokuOperation = {
        operationId: key,
        method,
        pathTemplate,
        rawHref: link.href,
        rel: typeof link.rel === "string" ? link.rel : undefined,
        title: typeof link.title === "string" ? link.title : undefined,
        description: summary || undefined,
        definitionName,
        requestSchema: bodySchema,
        targetSchemaRef: asObject(link.targetSchema)?.$ref as string | undefined,
        pathParams,
        requiredParams,
        isMutating,
        searchText
      };

      deduped.set(key, operation);
    }
  }

  return {
    operations: Array.from(deduped.values()),
    rootSchema
  };
}
