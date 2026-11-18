#!/usr/bin/env bun
// Before/after evidence for anything GitHub renders as Markdown: a Wachiman comment whose format
// changes, or a user-facing document whose table or section changes.
//
//   bun .claude/skills/verify/scripts/before-after.ts <manifest.json> --out <dir> [--png] [--theme=dark|light]
//
// It writes <dir>/index.html: one self-contained page, a Before and an After box per scenario, both
// rendered by GitHub's own Markdown endpoint (`gh api markdown`, mode gfm), so tables, <details>,
// <sub> and alerts look exactly as they will on a pull request. The page has a layout and theme
// toggle and a "Copy evidence table" button that copies the pull request's Evidence rows.
// With --png it also writes <dir>/<id>-before.png and <dir>/<id>-after.png through the system
// Chrome (CHROME_PATH overrides), driven over the DevTools protocol: no browser download, no
// dependency.
//
// Manifest:
//   {
//     "title": "The question the page answers",
//     "subtitle": "The conclusion, one line",
//     "repo": "owner/name",                       // context for relative links and #refs
//     "scenarios": [
//       { "id": "inline", "name": "Inline finding", "note": "what to look at",
//         "frame": "comment" | "file",            // GitHub comment chrome, or a file header
//         "author": "github-actions[bot]",        // comment header for a side that was not posted
//         "before": <source>, "after": <source> }
//     ]
//   }
// A source is one of:
//   { "file": "path.md" }                                         a local file
//   { "text": "markdown" }                                        inline Markdown
//   { "git": "<ref>:<path>", "block": 2 }                         the 2nd ```markdown fence at that ref
//   { "git": "<ref>:<path>", "section": "Heading" }               that heading's section at that ref
//   { "git": "<ref>:<path>" }                                     the whole file at that ref
//   { "review" | "inline" | "issue": "owner/repo#123", "id": 1 }  a posted comment, by id
//   { "review" | "inline" | "issue": "owner/repo#123", "match": "regex" }  first body that matches
//   { "none": "why there is no before" }                          the scenario did not exist
// Add "fill": { "<placeholder>": "text" } to replace a template's placeholder (a spec example's
// "<the model's body>") with real text; the caption then says so.
// Add "label": "..." to any source to override its caption. Captions name where each side came
// from, so a reader can tell a posted comment from a template in a spec.
//
// Sends the Markdown to api.github.com. Do not use it on text that must not leave the machine.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

type Source = Record<string, unknown> & { label?: string };
type Scenario = {
  id: string;
  name: string;
  note?: string;
  frame?: "comment" | "file";
  author?: string;
  before: Source;
  after: Source;
};
type Manifest = { title: string; subtitle?: string; repo: string; scenarios: Scenario[] };
type Side = { markdown: string | null; caption: string; html: string; author?: string };

const CSS_VERSION = "5.8.1";
const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Throws instead of exiting, so a `finally` (the Chrome cleanup) still runs; main() reports it.
class Failure extends Error {}
function fail(message: string): never {
  throw new Failure(message);
}

function run(cmd: string[], input?: string): string {
  const proc = Bun.spawnSync(cmd, { stdin: input === undefined ? "ignore" : Buffer.from(input) });
  if (proc.exitCode !== 0) fail(`${cmd.slice(0, 3).join(" ")} failed: ${proc.stderr.toString().trim()}`);
  return proc.stdout.toString();
}

function fences(text: string): string[] {
  const blocks: string[] = [];
  const re = /^```markdown\n([\s\S]*?)^```$/gm;
  for (let m = re.exec(text); m; m = re.exec(text)) blocks.push(m[1].replace(/\n$/, ""));
  return blocks;
}

function section(text: string, heading: string): string {
  const lines = text.split("\n");
  // A "# comment" inside a code fence is not a heading.
  let fenced = false;
  const isHeading = lines.map((l) => {
    if (/^\s*(```|~~~)/.test(l)) fenced = !fenced;
    return !fenced && /^#{1,6} /.test(l);
  });
  const start = lines.findIndex((l, i) => isHeading[i] && l.replace(/^#+ /, "").trim() === heading);
  if (start < 0) fail(`no heading "${heading}"`);
  const level = lines[start].match(/^#+/)![0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const h = isHeading[i] && lines[i].match(/^(#{1,6}) /);
    if (h && h[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trimEnd();
}

function comment(kind: string, ref: string, src: Source): { body: string; caption: string; author: string } {
  const m = ref.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/);
  if (!m) fail(`"${ref}" is not owner/repo#number`);
  const [, repo, n] = m;
  const path = {
    review: `repos/${repo}/pulls/${n}/reviews`,
    inline: `repos/${repo}/pulls/${n}/comments`,
    issue: `repos/${repo}/issues/${n}/comments`,
  }[kind]!;
  const items = JSON.parse(run(["gh", "api", "--paginate", "--slurp", path])).flat() as {
    id: number;
    body: string;
    submitted_at?: string;
    created_at?: string;
    user?: { login: string };
  }[];
  const hit = items.find((c) =>
    src.id !== undefined ? c.id === Number(src.id) : new RegExp(String(src.match)).test(c.body ?? ""),
  );
  if (!hit) fail(`no ${kind} comment on ${ref} matching ${src.id ?? src.match}`);
  if (!hit.body?.trim()) fail(`${kind} comment ${hit.id} on ${ref} has an empty body`);
  const date = (hit.submitted_at ?? hit.created_at ?? "").slice(0, 10);
  return { body: hit.body, caption: `Posted on ${ref}, ${date}`, author: hit.user?.login ?? "unknown" };
}

function resolveSource(src: Source): { markdown: string | null; caption: string; author?: string } {
  let out: { markdown: string | null; caption: string; author?: string };
  if (typeof src.none === "string") out = { markdown: null, caption: src.none };
  else if (typeof src.text === "string") out = { markdown: src.text, caption: "Inline text" };
  else if (typeof src.file === "string")
    out = { markdown: readFileSync(src.file, "utf8"), caption: src.file };
  else if (typeof src.git === "string") {
    const [ref, path] = [src.git.slice(0, src.git.indexOf(":")), src.git.slice(src.git.indexOf(":") + 1)];
    const sha = run(["git", "rev-parse", "--short", `${ref}^{commit}`]).trim();
    const text = run(["git", "show", `${sha}:${path}`]);
    const name = path.split("/").pop();
    if (src.block !== undefined) {
      const all = fences(text);
      const md = all[Number(src.block) - 1];
      if (md === undefined) fail(`${src.git} has ${all.length} markdown blocks, not ${src.block}`);
      out = { markdown: md, caption: `${name} @ ${sha}, example ${src.block}` };
    } else if (typeof src.section === "string")
      out = { markdown: section(text, src.section), caption: `${name} @ ${sha}, "${src.section}"` };
    else out = { markdown: text, caption: `${name} @ ${sha}` };
  } else {
    const kind = ["review", "inline", "issue"].find((k) => typeof src[k] === "string");
    if (!kind) fail(`unknown source ${JSON.stringify(src)}`);
    const posted = comment(kind, String(src[kind]), src);
    out = { markdown: posted.body, caption: posted.caption, author: posted.author };
  }
  if (src.fill && out.markdown !== null) {
    for (const [placeholder, value] of Object.entries(src.fill as Record<string, string>)) {
      if (!out.markdown.includes(placeholder)) fail(`placeholder "${placeholder}" not found`);
      // split/join: a "$&" or "$1" in the posted text must stay literal.
      out.markdown = out.markdown.split(placeholder).join(value);
    }
    out.caption += ", placeholders filled";
  }
  return { ...out, caption: src.label ?? out.caption };
}

function render(markdown: string, repo: string): string {
  const body = JSON.stringify({ text: markdown, mode: "gfm", context: repo });
  return run(["gh", "api", "markdown", "--input", "-"], body);
}

async function css(name: string): Promise<string> {
  const url = `https://cdn.jsdelivr.net/npm/github-markdown-css@${CSS_VERSION}/${name}`;
  const res = await fetch(url);
  if (!res.ok) fail(`could not fetch ${url}: ${res.status}`);
  return res.text();
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// The author of a posted comment comes from the API; a template side uses the scenario's
// "author" (default github-actions[bot]), shown the way GitHub shows a bot.
function commentHead(login: string): string {
  const bot = login.endsWith("[bot]");
  const name = esc(login.replace(/\[bot\]$/, ""));
  return `<div class="gh-head"><b>${name}</b>${bot ? ' <span class="bot">bot</span>' : ""} commented</div>`;
}

function box(sc: Scenario, which: "before" | "after", side: Side): string {
  const frame =
    sc.frame === "file"
      ? `<div class="gh-head"><span class="mono">${esc(side.caption.split(" @ ")[0])}</span></div>`
      : commentHead(side.author ?? sc.author ?? "github-actions[bot]");
  const content = side.markdown === null ? `<p class="empty">${esc(side.caption)}</p>` : side.html;
  return `<figure class="side ${which}" id="${sc.id}-${which}">
  <figcaption><b>${which === "before" ? "Before" : "After"}</b><span>${esc(side.caption)}</span></figcaption>
  <div class="gh">${frame}<article class="markdown-body">${content}</article></div>
</figure>`;
}

function page(m: Manifest, sides: Map<string, { before: Side; after: Side }>, light: string, dark: string): string {
  const rows = m.scenarios
    .map((sc) => {
      const s = sides.get(sc.id)!;
      return `<section class="scenario">
  <h2>${esc(sc.name)}</h2>${sc.note ? `<p class="note">${esc(sc.note)}</p>` : ""}
  <div class="pair">${box(sc, "before", s.before)}${box(sc, "after", s.after)}</div>
</section>`;
    })
    .join("\n");
  const table = [
    "| Scenario | Before | After |",
    "| --- | --- | --- |",
    ...m.scenarios.map(
      (sc) => `| ${sc.name} | ![${sc.name}, before](./${sc.id}-before.png) | ![${sc.name}, after](./${sc.id}-after.png) |`,
    ),
  ].join("\n");
  return `<!doctype html>
<html lang="en" data-theme="dark" data-layout="side">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(m.title)}</title>
<style>
html[data-theme="light"] { ${light} }
html[data-theme="dark"] { ${dark} }
:root { --bg:#ffffff; --fg:#1f2328; --muted:#59636e; --line:#d1d9e0; --head:#f6f8fa;
  --before:#ffebe9; --before-fg:#82071e; --after:#dafbe1; --after-fg:#116329; }
html[data-theme="dark"] { --bg:#0d1117; --fg:#f0f6fc; --muted:#9198a1; --line:#3d444d; --head:#151b23;
  --before:#3c1618; --before-fg:#ffa198; --after:#12261e; --after-fg:#7ee787; }
* { box-sizing: border-box; }
body { margin:0; padding:24px 16px; background:var(--bg); color:var(--fg);
  font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif; }
header, main { max-width:1640px; margin:0 auto; }
header h1 { font-size:20px; margin:0; }
header p { margin:4px 0 0; color:var(--muted); }
.controls { display:flex; flex-wrap:wrap; gap:8px; margin:16px 0 8px; }
.controls button { font:inherit; font-size:12px; padding:4px 10px; border-radius:6px; cursor:pointer;
  border:1px solid var(--line); background:var(--head); color:var(--fg); }
.scenario { margin:28px 0; }
.scenario h2 { font-size:16px; margin:0 0 2px; }
.note { margin:0 0 10px; color:var(--muted); font-size:13px; }
.pair { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; align-items:start; }
html[data-layout="stack"] .pair { grid-template-columns:minmax(0,1fr); max-width:860px; }
@media (max-width:900px) { .pair { grid-template-columns:minmax(0,1fr); } }
.side { margin:0; min-width:0; }
.side figcaption { display:flex; gap:8px; align-items:baseline; justify-content:space-between;
  padding:4px 10px; border-radius:6px 6px 0 0; font-size:12px; }
.side figcaption span { opacity:.85; text-align:right; }
.before figcaption { background:var(--before); color:var(--before-fg); }
.after figcaption { background:var(--after); color:var(--after-fg); }
.gh { border:1px solid var(--line); border-top:none; border-radius:0 0 6px 6px; overflow:hidden; }
.gh-head { background:var(--head); border-bottom:1px solid var(--line); padding:8px 16px;
  color:var(--muted); font-size:13px; }
.gh-head b { color:var(--fg); }
.bot { border:1px solid var(--line); border-radius:2em; padding:0 6px; font-size:11px; margin-left:2px; }
.mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; color:var(--fg); }
.markdown-body { padding:16px; font-size:14px; background:transparent !important; }
.empty { color:var(--muted); font-style:italic; margin:0; }
html.capture .pair { display:block; }
html.capture .side { width:760px; margin:0 0 24px; }
</style>
</head>
<body>
<header>
  <h1>${esc(m.title)}</h1>
  ${m.subtitle ? `<p>${esc(m.subtitle)}</p>` : ""}
  <p>Both sides rendered by GitHub's Markdown endpoint (gfm, context ${esc(m.repo)}). Hidden HTML comments do not show, as on GitHub.</p>
  <div class="controls">
    <button data-toggle="layout">Side by side / stacked</button>
    <button data-toggle="theme">Dark / light</button>
    <button data-copy>Copy evidence table</button>
  </div>
</header>
<main>
${rows}
</main>
<script type="text/plain" id="evidence-table">${esc(table)}</script>
<script>
const root = document.documentElement;
const params = new URLSearchParams(location.search);
if (params.get("theme")) root.dataset.theme = params.get("theme");
if (params.has("capture")) root.classList.add("capture");
document.querySelector('[data-toggle="layout"]').onclick = () =>
  root.dataset.layout = root.dataset.layout === "side" ? "stack" : "side";
document.querySelector('[data-toggle="theme"]').onclick = () =>
  root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
document.querySelector("[data-copy]").onclick = async (e) => {
  const text = document.getElementById("evidence-table").textContent;
  try { await navigator.clipboard.writeText(text); e.target.textContent = "Copied"; }
  catch { prompt("Copy the evidence table", text); }
};
</script>
</body>
</html>
`;
}

// Chrome DevTools protocol, just enough to clip one element per PNG.
async function screenshots(html: string, ids: string[], outDir: string, theme: string) {
  if (!existsSync(CHROME)) fail(`Chrome not found at ${CHROME}; set CHROME_PATH`);
  // Port 0 lets Chrome pick a free port; it writes the one it chose to DevToolsActivePort.
  const profile = mkdtempSync(join(tmpdir(), "before-after-"));
  let chrome: ReturnType<typeof Bun.spawn> | undefined;
  try {
    chrome = Bun.spawn(
      [CHROME, "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
        "--hide-scrollbars", "--no-first-run", "about:blank"],
      { stdout: "ignore", stderr: "ignore" },
    );
    let target: { webSocketDebuggerUrl: string } | undefined;
    for (let i = 0; i < 100 && !target; i++) {
      try {
        const port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0];
        const list = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as {
          type: string;
          webSocketDebuggerUrl: string;
        }[];
        target = list.find((t) => t.type === "page");
      } catch {
        // Chrome is still starting: no port file yet, or the endpoint is not answering.
      }
      if (!target) await Bun.sleep(100);
    }
    if (!target) fail(`Chrome did not start (${CHROME})`);
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((ok) => (ws.onopen = ok));
    let next = 0;
    const waiting = new Map<number, (v: any) => void>();
    const events: ((m: any) => void)[] = [];
    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data));
      if (msg.id !== undefined) waiting.get(msg.id)?.(msg);
      else events.forEach((f) => f(msg));
    };
    const send = (method: string, params: object = {}) =>
      new Promise<any>((ok) => {
        const id = ++next;
        waiting.set(id, ok);
        ws.send(JSON.stringify({ id, method, params }));
      }).then((m) => (m.error ? fail(`${method}: ${m.error.message}`) : m.result));
    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 900, height: 900, deviceScaleFactor: 2, mobile: false });
    const loaded = new Promise((ok) => events.push((m) => m.method === "Page.loadEventFired" && ok(null)));
    await send("Page.navigate", { url: `${pathToFileURL(html).href}?capture=1&theme=${theme}` });
    await loaded;
    await send("Runtime.evaluate", { expression: "document.fonts.ready", awaitPromise: true });
    for (const id of ids) {
      const { result } = await send("Runtime.evaluate", {
        expression: `(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();
          return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }; })()`,
        returnByValue: true,
      });
      const { data } = await send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
        clip: { ...result.value, scale: 1 },
      });
      writeFileSync(join(outDir, `${id}.png`), Buffer.from(data, "base64"));
      console.log(join(outDir, `${id}.png`));
    }
    ws.close();
  } finally {
    chrome?.kill();
    await chrome?.exited;
    rmSync(profile, { recursive: true, force: true });
  }
}

function parseArgs(argv: string[]) {
  const usage = "usage: before-after.ts <manifest.json> --out <dir> [--png] [--theme=dark|light]";
  let manifest: string | undefined;
  let out: string | undefined;
  let png = false;
  let theme = "dark";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") out = argv[++i];
    else if (a.startsWith("--out=")) out = a.slice(6);
    else if (a === "--png") png = true;
    else if (a.startsWith("--theme=")) theme = a.slice(8);
    else if (a.startsWith("--")) fail(`unknown option ${a}\n${usage}`);
    else if (manifest) fail(`two manifests given\n${usage}`);
    else manifest = a;
  }
  if (!manifest || !out) fail(usage);
  if (theme !== "dark" && theme !== "light") fail(`--theme must be dark or light`);
  return { manifestPath: manifest, outDir: resolve(out), png, theme };
}

async function main() {
  const { manifestPath, outDir, png, theme } = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  mkdirSync(outDir, { recursive: true });

  const sides = new Map<string, { before: Side; after: Side }>();
  for (const sc of manifest.scenarios) {
    const pair = {} as { before: Side; after: Side };
    for (const which of ["before", "after"] as const) {
      const { markdown, caption, author } = resolveSource(sc[which]);
      pair[which] = { markdown, caption, author, html: markdown === null ? "" : render(markdown, manifest.repo) };
    }
    sides.set(sc.id, pair);
  }
  const [light, dark] = await Promise.all([css("github-markdown-light.css"), css("github-markdown-dark.css")]);
  const htmlPath = join(outDir, "index.html");
  writeFileSync(htmlPath, page(manifest, sides, light, dark));
  console.log(htmlPath);
  if (png)
    await screenshots(
      htmlPath,
      manifest.scenarios.flatMap((sc) => [`${sc.id}-before`, `${sc.id}-after`]),
      outDir,
      theme,
    );
}

try {
  await main();
} catch (error) {
  console.error(`before-after: ${error instanceof Failure ? error.message : (error as Error).stack}`);
  process.exit(1);
}
