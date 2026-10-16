import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import type { UsageStore } from "./store.js";
import { buildSummary, byModel, byProject, tokenTotals, type Filters } from "./aggregate.js";
import { footprintOf, footprintSources, waterLadder, energyLadder } from "./footprint.js";
import { loadConfig, mergeConfig, saveConfig, type UserConfig } from "./config.js";
import { pricing, modelLabel } from "./cost.js";
import { costOf } from "./cost.js";
import type { UsageEvent } from "./types.js";

export interface ServerOptions {
  store: UsageStore;
  webDir: string;
  port: number;
  version: string;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

function parseFilters(u: URL): Filters {
  const f: Filters = {};
  const from = u.searchParams.get("from");
  const to = u.searchParams.get("to");
  if (from) f.from = Number(from);
  if (to) f.to = Number(to);
  const p = u.searchParams.get("projects");
  const m = u.searchParams.get("models");
  if (p) f.projects = p.split(",").filter(Boolean);
  if (m) f.models = m.split(",").filter(Boolean);
  return f;
}

export function liveSnapshot(store: UsageStore, config: UserConfig, now = Date.now()) {
  const all = store.events;
  const t = tokenTotals(all);
  const c = costOf(all);
  // events are sorted by ts, so walk back from the end for the last hour
  const hourAgo = now - 3_600_000;
  let i = all.length;
  while (i > 0 && all[i - 1].ts >= hourAgo) i--;
  const recent = all.slice(i);
  const lt = tokenTotals(recent);
  const lc = costOf(recent);
  return {
    totals: { ...t, usd: c.usd, unknownTokens: c.unknownTokens, requests: all.length },
    footprint: footprintOf(t, config.footprint),
    lastHour: { total: lt.total, output: lt.output, usd: lc.usd, requests: recent.length },
    lastEventTs: all.length ? all[all.length - 1].ts : null,
  };
}

export function createApp(opts: ServerOptions) {
  const { store, webDir } = opts;
  let config = loadConfig();
  const clients = new Set<http.ServerResponse>();

  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };

  const meta = () => ({
    version: opts.version,
    projectsDir: store.projectsDir,
    files: store.fileCount,
    warnings: store.warnings,
    pricing: { source: pricing.source, checked: pricing.checked, models: Object.keys(pricing.models) },
    footprintSources,
    waterLadder,
    energyLadder,
    projects: byProject(store.events).map((p) => ({ key: p.key, label: p.label, total: p.total })),
    models: byModel(store.events).map((m) => ({ key: m.key, label: modelLabel(m.key), total: m.total })),
    config,
  });

  const broadcast = (added: UsageEvent[]) => {
    if (!clients.size || !added.length) return;
    const snap = liveSnapshot(store, config);
    const payload = `event: usage\ndata: ${JSON.stringify({ added: added.length, ...snap, at: Date.now() })}\n\n`;
    for (const res of clients) res.write(payload);
  };

  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://127.0.0.1");
    const p = u.pathname;
    // Never allow cross-origin pages to read local usage data.
    const origin = req.headers.origin;
    if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) {
      res.writeHead(403).end();
      return;
    }
    if (p === "/api/summary" && req.method === "GET") {
      const f = parseFilters(u);
      const s = buildSummary(store.events, f);
      const fp = footprintOf(s.totals, config.footprint);
      const live = liveSnapshot(store, config);
      return json(res, 200, { summary: s, footprint: fp, allTime: live, meta: meta() });
    }
    if (p === "/api/meta") return json(res, 200, meta());
    if (p === "/api/config" && req.method === "GET") return json(res, 200, config);
    if (p === "/api/config" && (req.method === "PUT" || req.method === "POST")) {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 64_000) req.destroy();
      });
      req.on("end", () => {
        try {
          config = mergeConfig(config, JSON.parse(body || "{}"));
          saveConfig(config);
          json(res, 200, config);
          broadcastConfig();
        } catch (e) {
          json(res, 400, { error: String(e) });
        }
      });
      return;
    }
    if (p === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      res.write(`event: hello\ndata: ${JSON.stringify(liveSnapshot(store, config))}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (p.startsWith("/api/")) return json(res, 404, { error: "not found" });

    // Static dashboard
    let file = path.join(webDir, p === "/" ? "index.html" : p);
    if (!file.startsWith(webDir)) {
      res.writeHead(403).end();
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(webDir, "index.html");
    if (!fs.existsSync(file)) {
      res
        .writeHead(503, { "content-type": "text/html; charset=utf-8" })
        .end(
          `<!doctype html><meta charset="utf-8"><title>TokenBurn</title><body style="background:#09080c;color:#f4efe6;font:16px/1.5 -apple-system,system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0"><div style="max-width:520px;padding:24px"><h1 style="color:#ff6a1f;margin:0 0 8px">The dashboard is not built yet</h1><p>The API is running, but the web files are missing. In the project folder, run:</p><pre style="background:#16141c;padding:12px 14px;border-radius:10px">npm start</pre><p style="color:#9b97a6">That builds the dashboard and starts TokenBurn. Then reload this page.</p></div></body>`,
        );
      return;
    }
    const ext = path.extname(file);
    res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream", "cache-control": ext === ".html" ? "no-store" : "public, max-age=3600" });
    fs.createReadStream(file).pipe(res);
  });

  const broadcastConfig = () => {
    const snap = liveSnapshot(store, config);
    const payload = `event: config\ndata: ${JSON.stringify({ config, ...snap })}\n\n`;
    for (const r of clients) r.write(payload);
  };

  const heartbeat = setInterval(() => {
    for (const r of clients) r.write(`: ping\n\n`);
  }, 15_000);
  heartbeat.unref();

  const listen = () =>
    new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      // 127.0.0.1 only. Never 0.0.0.0.
      server.listen(opts.port, "127.0.0.1", () => {
        const addr = server.address();
        resolve(typeof addr === "object" && addr ? addr.port : opts.port);
      });
    });

  const close = () =>
    new Promise<void>((resolve) => {
      // SSE connections never end on their own; drop them so close() can complete.
      clearInterval(heartbeat);
      for (const r of clients) r.end();
      clients.clear();
      server.closeAllConnections?.();
      server.close(() => resolve());
    });

  return { server, listen, broadcast, clients, close };
}
