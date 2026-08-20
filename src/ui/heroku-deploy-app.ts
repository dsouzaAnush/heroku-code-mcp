export const HEROKU_DEPLOY_UI_URI = "ui://heroku/deploy-workspace.html";
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

export function createHerokuDeployAppHtml(input: { logoUrl: string }): string {
  return String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <title>Heroku deployment workspace</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #ffffff;
      --surface: #f8f7fb;
      --surface-strong: #f0edf7;
      --text: #1d1c1d;
      --muted: #616061;
      --border: #d9d5e3;
      --purple: #430098;
      --purple-hover: #350079;
      --green: #007a5a;
      --amber: #9a6700;
      --red: #c23b33;
      --code-bg: #18151f;
      --code-text: #f4f0fa;
      font-family: Slack-Lato, Slack-Fractions, appleLogo, sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #1a171d;
        --surface: #242027;
        --surface-strong: #2d2732;
        --text: #f8f8f8;
        --muted: #b9b6bb;
        --border: #4d4652;
        --purple: #a985d6;
        --purple-hover: #bc9ce0;
        --green: #56c9a2;
        --amber: #e3b341;
        --red: #ff7b72;
      }
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--text); }
    body { padding: 16px; }
    button { font: inherit; }
    .shell { max-width: 980px; margin: 0 auto; }
    .topbar { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
    .brand { width: 34px; height: 34px; border-radius: 8px; object-fit: contain; flex: none; }
    .title { min-width: 0; }
    .title h1 { font-size: 18px; line-height: 1.25; margin: 0; }
    .title p { font-size: 13px; color: var(--muted); margin: 2px 0 0; }
    .badge { margin-left: auto; padding: 4px 8px; border-radius: 999px; background: var(--surface-strong); color: var(--muted); font-size: 12px; font-weight: 700; }
    .panel { border: 1px solid var(--border); border-radius: 12px; overflow: hidden; background: var(--bg); }
    .summary { padding: 14px 16px; background: var(--surface); border-bottom: 1px solid var(--border); }
    .summary-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
    .label { color: var(--muted); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
    .value { display: block; margin-top: 4px; font-size: 14px; font-weight: 700; word-break: break-word; }
    .sha { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
    .workspace { display: grid; grid-template-columns: 220px minmax(0, 1fr); min-height: 360px; }
    .files { border-right: 1px solid var(--border); background: var(--surface); padding: 10px; }
    .files h2, .content h2 { font-size: 12px; color: var(--muted); margin: 2px 6px 8px; text-transform: uppercase; letter-spacing: .04em; }
    .file { width: 100%; border: 0; background: transparent; color: var(--text); text-align: left; padding: 8px 9px; border-radius: 6px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .file:hover, .file.active { background: var(--surface-strong); color: var(--purple); }
    .content { min-width: 0; padding: 10px; background: var(--code-bg); }
    .content h2 { color: #bcb4c7; }
    pre { margin: 0; padding: 10px; color: var(--code-text); font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre; overflow: auto; max-height: 390px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 12px 14px; border-top: 1px solid var(--border); }
    .button { border: 1px solid var(--border); border-radius: 7px; background: var(--bg); color: var(--text); padding: 8px 12px; font-weight: 700; cursor: pointer; }
    .button:hover { background: var(--surface); }
    .button.primary { background: var(--purple); border-color: var(--purple); color: white; }
    .button.primary:hover { background: var(--purple-hover); }
    .button:disabled { opacity: .55; cursor: wait; }
    .hint { color: var(--muted); font-size: 12px; margin-left: auto; }
    .app-list { display: grid; gap: 8px; padding: 12px; }
    .app-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 11px 12px; border: 1px solid var(--border); border-radius: 9px; }
    .app-row strong { display: block; font-size: 14px; }
    .app-row span { display: block; color: var(--muted); font-size: 12px; margin-top: 2px; }
    .timeline { padding: 16px; }
    .step { display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 10px; position: relative; padding-bottom: 16px; }
    .step:not(:last-child)::after { content: ""; position: absolute; left: 11px; top: 24px; width: 2px; height: calc(100% - 12px); background: var(--border); }
    .dot { width: 24px; height: 24px; border-radius: 50%; background: var(--surface-strong); display: grid; place-items: center; font-size: 12px; font-weight: 800; z-index: 1; }
    .step.done .dot { background: var(--green); color: white; }
    .step.active .dot { background: var(--purple); color: white; }
    .step.failed .dot { background: var(--red); color: white; }
    .step strong { display: block; font-size: 14px; margin-top: 2px; }
    .step span { color: var(--muted); font-size: 12px; }
    .preview-card { margin: 0 16px 16px; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
    .preview-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: var(--surface); border-bottom: 1px solid var(--border); }
    .preview-head strong { font-size: 13px; }
    .preview-head span { margin-left: auto; font-size: 12px; color: var(--green); font-weight: 700; }
    .preview-body { padding: 18px; min-height: 130px; background: linear-gradient(135deg, var(--surface), var(--bg)); }
    .preview-body h3 { margin: 0 0 8px; font-size: 22px; }
    .preview-body p { margin: 0; color: var(--muted); line-height: 1.45; }
    .empty { padding: 28px; text-align: center; color: var(--muted); }
    .error { color: var(--red); }
    .spinner { width: 15px; height: 15px; display: inline-block; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin .8s linear infinite; vertical-align: -2px; margin-right: 6px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (max-width: 680px) {
      body { padding: 10px; }
      .workspace { grid-template-columns: 1fr; }
      .files { border-right: 0; border-bottom: 1px solid var(--border); display: flex; overflow-x: auto; gap: 4px; }
      .files h2 { display: none; }
      .file { width: auto; flex: none; max-width: 190px; }
      .summary-grid { grid-template-columns: 1fr; }
      .hint { width: 100%; margin-left: 0; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <img class="brand" src=${JSON.stringify(input.logoUrl)} alt="Heroku" />
      <div class="title">
        <h1>Heroku build workspace</h1>
        <p>Review source, deploy the exact commit, and inspect the result.</p>
      </div>
      <span class="badge">MCP App</span>
    </header>
    <section id="root" class="panel"><div class="empty"><span class="spinner"></span>Loading Heroku data…</div></section>
  </main>
  <script type="module">
    import { App } from "https://esm.sh/@modelcontextprotocol/ext-apps@1.7.4/app-with-deps";

    const root = document.getElementById("root");
    const app = new App({ name: "Heroku build workspace", version: "1.0.0" });
    let currentData = null;
    let pollTimer = null;

    function escapeHtml(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function shortSha(value) {
      return String(value || "").slice(0, 10);
    }

    function stopPolling() {
      if (pollTimer) window.clearInterval(pollTimer);
      pollTimer = null;
    }

    function wireLinks() {
      root.querySelectorAll("[data-link]").forEach((element) => {
        element.addEventListener("click", async () => {
          await app.openLink({ url: element.dataset.link });
        });
      });
    }

    function renderApps(data) {
      const apps = Array.isArray(data.apps) ? data.apps : [];
      const starter = data.deployment_starter || null;
      const visibleApps = starter
        ? [...apps.filter((item) => item.name === starter.app_name), ...apps.filter((item) => item.name !== starter.app_name)]
        : apps;
      root.innerHTML = '<div class="summary"><span class="label">Heroku account</span><span class="value">' + apps.length + ' apps available</span></div>' +
        '<div class="app-list">' + visibleApps.slice(0, 12).map((item) => {
          const state = item.maintenance ? "Maintenance mode" : "Available";
          const canReview = starter && starter.app_name === item.name;
          const button = canReview
            ? '<button class="button primary" data-review-source>Review source</button>'
            : item.web_url ? '<button class="button" data-link="' + escapeHtml(item.web_url) + '">Open app</button>' : "";
          return '<div class="app-row"><div><strong>' + escapeHtml(item.name) + '</strong><span>' + state + (item.updated_at ? ' · Updated ' + escapeHtml(new Date(item.updated_at).toLocaleString()) : "") + '</span></div>' + button + '</div>';
        }).join("") + '</div>';
      wireLinks();
      const reviewButton = root.querySelector("[data-review-source]");
      if (reviewButton && starter) {
        reviewButton.addEventListener("click", async () => {
          reviewButton.disabled = true;
          reviewButton.innerHTML = '<span class="spinner"></span>Loading source…';
          try {
            const result = await app.callServerTool({
              name: "preview_github_deployment",
              arguments: starter
            });
            if (result.isError) throw new Error(result.content?.[0]?.text || "Source preview failed");
            render(result.structuredContent || {});
          } catch (error) {
            reviewButton.disabled = false;
            reviewButton.textContent = "Try source preview again";
          }
        });
      }
    }

    function renderPreview(data) {
      const source = data.source || {};
      const files = Array.isArray(source.files) ? source.files : [];
      const appData = data.app || {};
      const first = files[0];
      root.innerHTML =
        '<div class="summary"><div class="summary-grid">' +
          '<div><span class="label">Existing Heroku app</span><span class="value">' + escapeHtml(appData.name) + '</span></div>' +
          '<div><span class="label">Reviewed source</span><span class="value">' + escapeHtml(source.repository) + '@' + escapeHtml(source.git_ref) + ' <span class="sha">' + escapeHtml(shortSha(source.source_sha)) + '</span></span></div>' +
        '</div></div>' +
        '<div class="workspace">' +
          '<aside class="files"><h2>Source files</h2>' + files.map((file, index) => '<button class="file' + (index === 0 ? ' active' : '') + '" data-file-index="' + index + '">' + escapeHtml(file.path) + '</button>').join("") + '</aside>' +
          '<section class="content"><h2 id="file-title">' + escapeHtml(first?.path || "No previewable files") + '</h2><pre id="code-preview"></pre></section>' +
        '</div>' +
        '<div class="actions">' +
          '<button id="deploy-button" class="button primary">Deploy reviewed commit</button>' +
          '<button class="button" data-link="' + escapeHtml(source.commit_url) + '">Open commit</button>' +
          '<span class="hint">Creates no new app · reuses ' + escapeHtml(appData.name) + '</span>' +
        '</div>';

      const codePreview = document.getElementById("code-preview");
      const fileTitle = document.getElementById("file-title");
      function selectFile(index) {
        const file = files[index];
        if (!file) return;
        root.querySelectorAll(".file").forEach((button) => button.classList.toggle("active", Number(button.dataset.fileIndex) === index));
        fileTitle.textContent = file.path + (file.truncated ? " · preview truncated" : "");
        codePreview.textContent = file.content;
      }
      root.querySelectorAll("[data-file-index]").forEach((button) => button.addEventListener("click", () => selectFile(Number(button.dataset.fileIndex))));
      selectFile(0);
      wireLinks();

      document.getElementById("deploy-button").addEventListener("click", async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        button.innerHTML = '<span class="spinner"></span>Starting build…';
        try {
          const result = await app.callServerTool({
            name: "deploy_github_repo",
            arguments: {
              app_name: appData.name,
              github_repo: source.repository,
              git_ref: source.git_ref,
              source_sha: source.source_sha
            }
          });
          if (result.isError) throw new Error(result.content?.[0]?.text || "Deployment failed");
          render(result.structuredContent || {});
        } catch (error) {
          button.disabled = false;
          button.textContent = "Try deployment again";
          const hint = root.querySelector(".hint");
          if (hint) { hint.classList.add("error"); hint.textContent = String(error); }
        }
      });
    }

    function stepClass(status, step) {
      if (status === "failed") return step === "build" ? "failed" : "done";
      if (status === "succeeded") return "done";
      if (step === "review" || step === "create") return "done";
      if (step === "build") return "active";
      return "";
    }

    function renderDeployment(data) {
      const appData = data.app || {};
      const source = data.source || {};
      const build = data.build || {};
      const preview = data.live_preview || {};
      const status = build.status || data.status || "pending";
      const complete = status === "succeeded" || status === "failed";
      const statusLabel = status === "succeeded" ? "Live" : status === "failed" ? "Build failed" : "Building";
      root.innerHTML =
        '<div class="summary"><div class="summary-grid">' +
          '<div><span class="label">Heroku app</span><span class="value">' + escapeHtml(appData.name) + '</span></div>' +
          '<div><span class="label">Deployment</span><span class="value">' + (complete ? "" : '<span class="spinner"></span>') + escapeHtml(statusLabel) + '</span></div>' +
        '</div></div>' +
        '<div class="timeline">' +
          '<div class="step ' + stepClass(status, "review") + '"><span class="dot">✓</span><div><strong>Code reviewed</strong><span>' + escapeHtml(source.repository || "Allowlisted repository") + (source.source_sha ? ' · ' + escapeHtml(shortSha(source.source_sha)) : "") + '</span></div></div>' +
          '<div class="step ' + stepClass(status, "create") + '"><span class="dot">✓</span><div><strong>Existing app selected</strong><span>No additional Heroku app was created.</span></div></div>' +
          '<div class="step ' + stepClass(status, "build") + '"><span class="dot">' + (status === "failed" ? "!" : status === "succeeded" ? "✓" : "3") + '</span><div><strong>Build ' + escapeHtml(status) + '</strong><span>' + escapeHtml(build.id || "Waiting for build ID") + '</span></div></div>' +
          '<div class="step ' + stepClass(status, "live") + '"><span class="dot">4</span><div><strong>Live preview</strong><span>' + (preview.reachable ? 'HTTP ' + escapeHtml(preview.http_status) : status === "succeeded" ? "Waking app and checking the public route…" : "Available after a successful release") + '</span></div></div>' +
        '</div>' +
        (status === "succeeded" ? '<div class="preview-card"><div class="preview-head"><strong>' + escapeHtml(preview.url || appData.web_url) + '</strong><span>' + (preview.reachable ? "Live" : "Released") + '</span></div><div class="preview-body"><h3>' + escapeHtml(preview.title || appData.name) + '</h3><p>' + escapeHtml(preview.description || preview.text_preview || "The Heroku release succeeded. Open the live app to inspect the full rendered experience.") + '</p></div></div>' : "") +
        '<div class="actions">' +
          (appData.web_url ? '<button class="button primary" data-link="' + escapeHtml(appData.web_url) + '">Open live app</button>' : "") +
          (appData.dashboard_url ? '<button class="button" data-link="' + escapeHtml(appData.dashboard_url) + '">Build activity and logs</button>' : "") +
          (source.commit_url ? '<button class="button" data-link="' + escapeHtml(source.commit_url) + '">Reviewed commit</button>' : "") +
          (!complete ? '<span class="hint">This view refreshes automatically.</span>' : '<span class="hint">Future deploys reuse this app.</span>') +
        '</div>';
      wireLinks();

      if (!complete && build.id && appData.name) {
        stopPolling();
        pollTimer = window.setInterval(async () => {
          try {
            const result = await app.callServerTool({ name: "get_deployment_status", arguments: { app_name: appData.name, build_id: build.id } });
            if (!result.isError) render(result.structuredContent || {});
          } catch (error) {
            console.error("Heroku build poll failed", error);
          }
        }, 3000);
      } else {
        stopPolling();
      }
    }

    function render(data) {
      if (data.view === "deployment_status" && !data.source && currentData?.source) {
        data = { ...data, source: currentData.source };
      }
      currentData = data;
      const view = data.view;
      if (view === "app_list") return renderApps(data);
      if (view === "deployment_preview") return renderPreview(data);
      if (view === "deployment" || view === "deployment_status") return renderDeployment(data);
      root.innerHTML = '<div class="empty">Heroku returned data, but this view does not recognize its shape yet.</div>';
    }

    app.ontoolresult = (result) => render(result.structuredContent || {});
    app.onerror = (error) => {
      root.innerHTML = '<div class="empty error">Unable to load the Heroku workspace: ' + escapeHtml(error?.message || error) + '</div>';
    };
    app.onteardown = async () => { stopPolling(); return {}; };
    await app.connect();
  </script>
</body>
</html>`;
}
