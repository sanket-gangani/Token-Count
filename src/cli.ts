#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { resolveProjectsDir } from "./discover.js";
import { codexLogDirs, resolveCodexHome } from "./codex.js";
import { UsageStore } from "./store.js";
import { buildSummary, SOURCE_LABELS, startOfDay, type Filters } from "./aggregate.js";
import { footprintOf } from "./footprint.js";
import { loadConfig } from "./config.js";
import { modelLabel, pricing } from "./cost.js";
import { c, fmtDuration, fmtLiters, fmtTokens, fmtUSD, fmtWh } from "./format.js";
import { createApp } from "./server.js";
import { watchProjects } from "./watch.js";
import { statusLine } from "./statusline.js";
import type { Source } from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(here, "..", "package.json"), "utf8"));
const VERSION: string = pkg.version;

interface Args {
  mode: "dashboard" | "summary" | "json" | "statusline" | "help" | "version";
  dir?: string;
  codexDir?: string;
  source: Source | "all";
  port: number;
  open: boolean;
  days?: number;
  projects?: string[];
  models?: string[];
  noCache: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { mode: "dashboard", source: "all", port: 4242, open: true, noCache: false };
  const setSource = (v: string | undefined) => {
    if (v === "claude" || v === "codex" || v === "all") a.source = v;
    else {
      console.error(`--source must be claude, codex or all (got ${v ?? "nothing"})`);
      a.mode = "help";
    }
  };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    const next = () => argv[++i];
    if (x === "statusline") a.mode = "statusline";
    else if (x === "--summary" || x === "summary") a.mode = "summary";
    else if (x === "--json" || x === "json") a.mode = "json";
    else if (x === "--help" || x === "-h") a.mode = "help";
    else if (x === "--version" || x === "-v") a.mode = "version";
    else if (x === "--dir") a.dir = next();
    else if (x.startsWith("--dir=")) a.dir = x.slice(6);
    else if (x === "--codex-dir") a.codexDir = next();
    else if (x.startsWith("--codex-dir=")) a.codexDir = x.slice(12);
    else if (x === "--source") setSource(next());
    else if (x.startsWith("--source=")) setSource(x.slice(9));
    else if (x === "--port") a.port = Number(next());
    else if (x.startsWith("--port=")) a.port = Number(x.slice(7));
    else if (x === "--no-open") a.open = false;
    else if (x === "--no-cache") a.noCache = true;
    else if (x === "--days") a.days = Number(next());
    else if (x.startsWith("--days=")) a.days = Number(x.slice(7));
    else if (x === "--project") (a.projects ??= []).push(next());
    else if (x === "--model") (a.models ??= []).push(next());
    else {
      console.error(`unknown argument: ${x}`);
      a.mode = "help";
    }
  }
  return a;
}

const HELP = `tokenburn ${VERSION} — watch your Claude Code and Codex tokens burn.

usage:
  tokenburn                 parse logs, start the dashboard, open the browser
  tokenburn --summary       print a compact table to the terminal
  tokenburn --json          dump aggregates as JSON (for scripting)
  tokenburn statusline      one-line summary for Claude Code's status line

options:
  --dir <path>        Claude Code logs (default: ~/.claude/projects or $CLAUDE_CONFIG_DIR)
  --codex-dir <path>  Codex logs (default: ~/.codex or $CODEX_HOME; reads sessions/ and archived_sessions/)
  --port <n>          dashboard port (default 4242, binds to 127.0.0.1 only)
  --no-open           do not open the browser
  --no-cache          ignore ~/.tokenburn/cache.json and re-read every file
  --days <n>          only the last n days (summary/json)
  --project <key>     filter by project folder key (repeatable)
  --model <id>        filter by model id (repeatable)
  --source <name>     claude, codex or all (summary/json, default all)

Costs are API-equivalent estimates. Water/energy numbers are rough and for fun.
`;

function filtersFrom(a: Args): Filters {
  const f: Filters = {};
  if (a.days) f.from = startOfDay(Date.now() - (a.days - 1) * 86_400_000);
  if (a.projects) f.projects = a.projects;
  if (a.models) f.models = a.models;
  if (a.source !== "all") f.sources = [a.source];
  return f;
}

function openBrowser(url: string) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* ignore */
  }
}

function printSummary(store: UsageStore, f: Filters, codexHome: string) {
  const cfg = loadConfig();
  const s = buildSummary(store.events, f);
  const fp = footprintOf(s.totals, cfg.footprint);
  const row = (label: string, v: string) => `  ${c.gray(label.padEnd(14))} ${v}`;
  const t = s.totals;
  const n = store.fileCounts();
  const only = f.sources?.length === 1 ? ` ${c.dim(`(${SOURCE_LABELS[f.sources[0]]} only)`)}` : "";
  console.log("");
  console.log(`  ${c.ember("🔥 tokenburn")} ${c.dim(`v${VERSION} · ${n.claude} Claude Code + ${n.codex} Codex files`)}`);
  console.log(`  ${c.dim(`${store.projectsDir} · ${codexHome}`)}`);
  console.log("");
  console.log(`  ${c.bold(c.ember(fmtTokens(t.total)))} ${c.dim("tokens burned all time")}  ${c.bold(fmtUSD(t.usd))} ${c.dim("API-equivalent")}${only}`);
  console.log("");
  console.log(row("input", fmtTokens(t.input)));
  console.log(row("output", fmtTokens(t.output)));
  console.log(row("cache write", fmtTokens(t.cacheWrite)));
  console.log(row("cache read", fmtTokens(t.cacheRead)));
  console.log(row("requests", t.requests.toLocaleString("en-US")));
  console.log(row("sessions", t.sessions.toLocaleString("en-US")));
  if (t.unknownModels.length) console.log(row("unpriced", `${fmtTokens(t.unknownTokens)} tokens from ${t.unknownModels.join(", ")}`));
  console.log("");
  const period = (p: typeof s.periods.today) =>
    `${p.label.padEnd(11)} ${fmtTokens(p.total).padStart(8)}  ${fmtUSD(p.usd).padStart(9)}  ${p.topModel ? c.dim(modelLabel(p.topModel)) : ""}`;
  console.log(`  ${c.bold("period")}      ${"tokens".padStart(8)}  ${"api-eq".padStart(9)}  top model`);
  for (const p of [s.periods.today, s.periods.week, s.periods.month]) console.log("  " + period(p));
  console.log("");
  console.log(`  ${c.bold("by source")}`);
  for (const x of s.sources) console.log(`  ${SOURCE_LABELS[x.key as Source].padEnd(12)} ${fmtTokens(x.total).padStart(8)}  ${fmtUSD(x.usd).padStart(9)}  ${c.dim(x.requests.toLocaleString("en-US") + " req")}`);
  console.log("");
  console.log(`  ${c.bold("by model")}`);
  for (const m of s.models.slice(0, 8)) console.log(`  ${modelLabel(m.key).padEnd(12)} ${fmtTokens(m.total).padStart(8)}  ${fmtUSD(m.usd).padStart(9)}  ${c.dim(m.requests.toLocaleString("en-US") + " req")}`);
  console.log("");
  console.log(`  ${c.bold("by project")}`);
  for (const p of s.projects.slice(0, 8)) console.log(`  ${p.label.slice(0, 24).padEnd(24)} ${fmtTokens(p.total).padStart(8)}  ${fmtUSD(p.usd).padStart(9)}`);
  console.log("");
  console.log(`  ${c.bold("recent sessions")}`);
  for (const x of s.sessions.slice(0, 6)) console.log(`  ${x.projectLabel.slice(0, 18).padEnd(18)} ${modelLabel(x.model).padEnd(10)} ${fmtDuration(x.durationMs).padStart(7)} ${fmtTokens(x.total).padStart(8)}  ${fmtUSD(x.usd).padStart(9)}`);
  console.log("");
  console.log(`  ${c.blue("💧 the lake")}  ${fp.water.text} ${c.dim(`(${fmtLiters(fp.liters)})`)}  ${c.dim("·")}  ⚡ ${fp.energy.text} ${c.dim(`(${fmtWh(fp.wh)})`)}`);
  console.log(`  ${c.dim(fp.water.quip)}`);
  console.log("");
  console.log(c.dim(`  Costs are API-equivalent (${pricing.sources.map((p) => `${p.provider} prices checked ${p.checked}`).join(", ")}); subscriptions are not billed per token.`));
  console.log(c.dim(`  Water & energy are rough third-party estimates, for fun. Edit factors in the dashboard settings.`));
  if (store.warnings.malformedLines) console.log(c.dim(`  Skipped ${store.warnings.malformedLines} malformed lines.`));
  console.log("");
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.mode === "help") return console.log(HELP);
  if (a.mode === "version") return console.log(VERSION);
  const projectsDir = resolveProjectsDir({ dir: a.dir });
  const codexHome = resolveCodexHome({ dir: a.codexDir });
  const codexDirs = codexLogDirs(codexHome, !!a.codexDir).filter((d) => fs.existsSync(d));

  if (a.mode === "statusline") {
    let stdin: string | null = null;
    if (!process.stdin.isTTY) {
      try {
        stdin = fs.readFileSync(0, "utf8");
      } catch {
        stdin = null;
      }
    }
    process.stdout.write(statusLine(projectsDir, stdin) + "\n");
    return;
  }

  const hasClaude = fs.existsSync(projectsDir);
  if (!hasClaude && !codexDirs.length) {
    console.error(`No Claude Code logs found at ${projectsDir} and no Codex logs at ${codexHome}. Use --dir or --codex-dir to point at them.`);
    process.exit(1);
  }

  const store = new UsageStore(projectsDir, { codexDirs });
  const t0 = Date.now();
  store.loadAll({ cache: !a.noCache });
  const loadMs = Date.now() - t0;

  if (a.mode === "json") {
    const cfg = loadConfig();
    const s = buildSummary(store.events, filtersFrom(a), Date.now(), 1000);
    console.log(JSON.stringify({ version: VERSION, projectsDir, codexHome, codexDirs, files: store.fileCounts(), loadMs, warnings: store.warnings, pricing: { source: pricing.source, checked: pricing.checked, sources: pricing.sources }, summary: s, footprint: footprintOf(s.totals, cfg.footprint) }, null, 2));
    return;
  }
  if (a.mode === "summary") return printSummary(store, filtersFrom(a), codexHome);

  // dist/cli.js serves dist/web; `tsx src/cli.ts` (npm run dev) serves the built dist/web too.
  const webDir =
    [path.join(here, "web"), path.join(here, "..", "dist", "web")].find((d) => fs.existsSync(path.join(d, "index.html"))) ??
    path.join(here, "web");
  if (!fs.existsSync(path.join(webDir, "index.html"))) {
    console.error(c.ember("\n  The dashboard has not been built yet. Run: npm run build\n"));
  }
  let port = 0;
  let app: ReturnType<typeof createApp> | null = null;
  // If the port is busy (e.g. an older tokenburn is still running), try the next few.
  for (let attempt = 0; attempt < 10; attempt++) {
    const tryPort = a.port + attempt;
    const candidate = createApp({ store, webDir, port: tryPort, version: VERSION, codexHome });
    try {
      port = await candidate.listen();
      app = candidate;
      if (attempt > 0) console.log(c.dim(`  port ${a.port} was busy, using ${port} instead`));
      break;
    } catch (e: any) {
      if (e?.code !== "EADDRINUSE") throw e;
    }
  }
  if (!app) {
    console.error(`ports ${a.port}-${a.port + 9} are all busy. try --port <n>.`);
    process.exit(1);
  }
  const url = `http://127.0.0.1:${port}`;
  const watched = [...(hasClaude ? [projectsDir] : []), ...codexDirs];
  console.log(`\n  ${c.ember("🔥 tokenburn")} ${c.dim(`v${VERSION}`)}\n  ${c.dim(`read ${store.fileCount} files in ${loadMs}ms · ${fmtTokens(store.events.length)} requests`)}\n  ${c.bold(url)} ${c.dim("(127.0.0.1 only)")}\n  ${c.dim("watching " + watched.join(", "))}\n`);

  const server = app;
  const watcher = watchProjects(watched, (file) => {
    const added = store.loadFile(file);
    if (added.length) {
      server.broadcast(added);
      store.saveCacheSoon();
    }
  });
  if (a.open) openBrowser(url);

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    // Never hang on exit: if something refuses to close, leave anyway.
    setTimeout(() => process.exit(0), 1500).unref();
    await watcher.close();
    store.saveCache();
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
