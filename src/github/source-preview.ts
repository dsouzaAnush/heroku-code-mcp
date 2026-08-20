const GITHUB_RAW_BASE_URL = "https://raw.githubusercontent.com";

const MAX_PREVIEW_FILES = 8;
const MAX_FILE_CHARACTERS = 12_000;
const MAX_TOTAL_CHARACTERS = 48_000;

const COMMON_SOURCE_PATHS = [
  "src/index.ts",
  "src/index.js",
  "src/server.ts",
  "src/server.js",
  "index.ts",
  "index.js",
  "server.ts",
  "server.js",
  "app.ts",
  "app.js",
  "public/index.html",
  "src/App.tsx",
  "src/App.jsx",
  "package.json",
  "Procfile",
  "app.json",
  "requirements.txt",
  "pyproject.toml",
  "main.py",
  "README.md"
] as const;

export interface SourcePreviewFile {
  path: string;
  language: string;
  content: string;
  raw_url: string;
  truncated: boolean;
}

export interface GitHubSourcePreview {
  repository: string;
  repository_url: string;
  git_ref: string;
  source_sha: string;
  commit_url: string;
  commit_message?: string;
  commit_author?: string;
  committed_at?: string;
  tree_truncated: boolean;
  files: SourcePreviewFile[];
}

export class GitHubPreviewError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
  }
}

function encodePath(value: string): string {
  return value
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function filePriority(path: string): number {
  const normalized = path.toLowerCase();
  const exactPriority = new Map<string, number>([
    ["src/index.ts", 0],
    ["src/index.js", 0],
    ["src/server.ts", 1],
    ["src/server.js", 1],
    ["index.ts", 2],
    ["index.js", 2],
    ["server.ts", 3],
    ["server.js", 3],
    ["app.ts", 4],
    ["app.js", 4],
    ["package.json", 20],
    ["procfile", 21],
    ["app.json", 22],
    ["readme.md", 40]
  ]);

  const exact = exactPriority.get(normalized);
  if (exact !== undefined) {
    return exact;
  }

  if (/^(src|app)\/.+\.(ts|tsx|js|jsx|py|rb|go)$/.test(normalized)) {
    return 20;
  }
  if (/\.(html|css|scss)$/.test(normalized)) {
    return 30;
  }
  if (/\.(md|json|ya?ml|toml)$/.test(normalized)) {
    return 40;
  }
  return 100;
}

function languageForPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  const languages: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    md: "markdown",
    html: "html",
    css: "css",
    scss: "scss",
    py: "python",
    rb: "ruby",
    go: "go",
    java: "java",
    yml: "yaml",
    yaml: "yaml",
    toml: "toml"
  };
  if (path.toLowerCase() === "procfile") {
    return "procfile";
  }
  return (extension && languages[extension]) || "text";
}

async function fetchWithTimeout(
  fetchFn: typeof fetch,
  url: string,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(fetchFn: typeof fetch, url: string): Promise<string> {
  const response = await fetchWithTimeout(fetchFn, url, {
    headers: {
      Accept: "application/atom+xml,text/plain;q=0.9,*/*;q=0.8",
      "User-Agent": "heroku-code-mcp"
    }
  });
  if (!response.ok) {
    throw new GitHubPreviewError(
      `GitHub source preview failed: HTTP ${response.status}`,
      response.status
    );
  }
  return response.text();
}

function decodeXmlText(value?: string): string | undefined {
  return value
    ?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPreviewFile(
  fetchFn: typeof fetch,
  repository: string,
  sourceSha: string,
  path: string
): Promise<SourcePreviewFile | undefined> {
  const rawUrl = `${GITHUB_RAW_BASE_URL}/${repository}/${sourceSha}/${encodePath(path)}`;
  const response = await fetchWithTimeout(fetchFn, rawUrl, {
    headers: { "User-Agent": "heroku-code-mcp" }
  });
  if (!response.ok) {
    return undefined;
  }

  const original = await response.text();
  const content = original.slice(0, MAX_FILE_CHARACTERS);
  return {
    path,
    language: languageForPath(path),
    content,
    raw_url: rawUrl,
    truncated: content.length < original.length
  };
}

export async function fetchGitHubSourcePreview(input: {
  repository: string;
  gitRef: string;
  fetchFn?: typeof fetch;
}): Promise<GitHubSourcePreview> {
  const fetchFn = input.fetchFn ?? fetch;
  const commitsUrl = `https://github.com/${input.repository}/commits/${encodePath(input.gitRef)}.atom`;
  const feed = await fetchText(fetchFn, commitsUrl);
  const firstEntry = feed.match(/<entry>([\s\S]*?)<\/entry>/i)?.[1] ?? "";
  const sourceSha = firstEntry.match(/Grit::Commit\/([a-f0-9]{40})/i)?.[1];
  if (!sourceSha) {
    throw new GitHubPreviewError("GitHub did not return a stable commit SHA for this ref.");
  }

  const fetched = await Promise.all(
    COMMON_SOURCE_PATHS.map((path) =>
      fetchPreviewFile(fetchFn, input.repository, sourceSha, path)
    )
  );
  let totalCharacters = 0;
  const files: SourcePreviewFile[] = [];
  for (const file of fetched
    .filter((candidate): candidate is SourcePreviewFile => Boolean(candidate))
    .sort((a, b) => filePriority(a.path) - filePriority(b.path) || a.path.localeCompare(b.path))
    .slice(0, MAX_PREVIEW_FILES)) {
    if (!file || totalCharacters >= MAX_TOTAL_CHARACTERS) {
      continue;
    }
    const remaining = MAX_TOTAL_CHARACTERS - totalCharacters;
    const content = file.content.slice(0, remaining);
    files.push({
      ...file,
      content,
      truncated: file.truncated || content.length < file.content.length
    });
    totalCharacters += content.length;
  }

  return {
    repository: input.repository,
    repository_url: `https://github.com/${input.repository}`,
    git_ref: input.gitRef,
    source_sha: sourceSha,
    commit_url: `https://github.com/${input.repository}/commit/${sourceSha}`,
    commit_message: decodeXmlText(firstEntry.match(/<title>([\s\S]*?)<\/title>/i)?.[1]),
    commit_author: decodeXmlText(
      firstEntry.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/i)?.[1]
    ),
    committed_at: firstEntry.match(/<updated>([^<]+)<\/updated>/i)?.[1],
    tree_truncated: true,
    files
  };
}

export async function fetchLiveAppSummary(input: {
  appUrl: string;
  fetchFn?: typeof fetch;
}): Promise<{
  url: string;
  http_status?: number;
  title?: string;
  description?: string;
  text_preview?: string;
  reachable: boolean;
}> {
  const fetchFn = input.fetchFn ?? fetch;
  try {
    const response = await fetchWithTimeout(fetchFn, input.appUrl, {
      headers: { "User-Agent": "heroku-code-mcp-preview" },
      redirect: "follow"
    });
    const contentType = response.headers.get("content-type") ?? "";
    const html = contentType.includes("text/html") ? await response.text() : "";
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?.replace(/\s+/g, " ")
      .trim();
    const description = html
      .match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i)?.[1]
      ?.trim();
    const textPreview = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 800);

    return {
      url: response.url || input.appUrl,
      http_status: response.status,
      title,
      description,
      text_preview: textPreview || undefined,
      reachable: response.ok
    };
  } catch {
    return { url: input.appUrl, reachable: false };
  }
}
