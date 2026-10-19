// Demo mode for the hosted preview (built with VITE_DEMO=1). There is no local server and no log
// folder, so this generates a fictional usage history and runs it through the same aggregation
// code the CLI uses. A timer appends new requests so the page behaves as if Claude Code is busy.
import { buildSummary, byModel, byProject, bySource, SOURCE_LABELS } from "../../src/aggregate";
import { modelLabel, pricing } from "../../src/cost";
import { defaultFootprint, energyLadder, footprintOf, footprintSources, waterLadder } from "../../src/footprint";
import { liveSnapshot } from "../../src/live";
import type { Source, UsageEvent } from "../../src/types";
import { version } from "../../package.json";
import type { Filters, LiveSnapshot, Meta, SummaryResponse, UserConfig } from "./api";

const PROJECTS: [string, number][] = [
  ["acme-api", 22], ["orbit-ios", 14], ["agent-lab", 13], ["pricing-engine", 10], ["docs-site", 8],
  ["data-pipeline", 8], ["design-system", 7], ["side-quest", 6], ["landing-v3", 5], ["dotfiles", 2],
];
const MODELS: [string, number][] = [["claude-opus-5-5", 52], ["claude-sonnet-5-5", 20], ["claude-opus-5", 12], ["claude-fable-5-1", 11], ["claude-haiku-5-5", 5]];
const CODEX_MODELS: [string, number][] = [["gpt-5.6-sol", 55], ["gpt-5.6-terra", 30], ["gpt-6.1-sol", 15]];
/** share of sessions run in Codex instead of Claude Code */
const CODEX_SHARE = 0.3;
const HOURS: [number, number][] = [0.2, 0.1, 0.05, 0.03, 0.03, 0.05, 0.2, 0.5, 1.0, 1.6, 2.0, 2.2, 1.6, 1.9, 2.6, 2.9, 3.0, 2.4, 1.5, 1.2, 1.4, 1.3, 0.9, 0.5].map((w, h) => [h, w]);
const LIVE_PROJECT = "acme-api";
const LIVE_MODEL = "claude-opus-5-5";

/** Seeded PRNG (mulberry32) so the history is the same on every visit. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let n = 0;
function event(project: string, sessionId: string, ts: number, model: string, rand: () => number, ctx: number, source: Source = "claude"): UsageEvent {
  const between = (a: number, b: number) => a + rand() * (b - a);
  if (source === "codex") {
    // Codex logs no cache writes: the uncached part of the prompt is plain input.
    return {
      key: `demo-${n++}`,
      source,
      ts,
      model,
      project: `-Users-dev-${project}`,
      projectLabel: project,
      sessionId,
      isSidechain: false,
      input: Math.round(between(300, 6000)),
      output: Math.round(between(80, 2400)),
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      cacheRead: Math.round(ctx),
    };
  }
  const write5m = rand() < 0.15 ? Math.round(between(1000, 9000)) : 0;
  return {
    key: `demo-${n++}`,
    source,
    ts,
    model,
    project: `-Users-dev-${project}`,
    projectLabel: project,
    sessionId,
    isSidechain: false,
    input: Math.round(between(1, 40)),
    output: Math.round(between(120, 3200)),
    cacheWrite5m: write5m,
    cacheWrite1h: Math.round(between(600, 14_000)),
    cacheRead: Math.round(ctx),
  };
}

/** Roughly ten weeks of usage ending now, growing over time, with weekends off and the odd spike. */
function generate(now: number): UsageEvent[] {
  const rand = seeded(20261017);
  const between = (a: number, b: number) => a + rand() * (b - a);
  const pick = <T>(items: [T, number][]): T => {
    let r = rand() * items.reduce((a, [, w]) => a + w, 0);
    for (const [v, w] of items) if ((r -= w) <= 0) return v;
    return items[0][0];
  };
  const out: UsageEvent[] = [];
  const start = new Date(now);
  start.setDate(start.getDate() - 70);
  start.setHours(0, 0, 0, 0);
  const span = now - start.getTime();
  for (const d = new Date(start); d.getTime() < now; d.setDate(d.getDate() + 1)) {
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const ramp = 0.45 + 0.75 * ((d.getTime() - start.getTime()) / span);
    const isToday = d.toDateString() === new Date(now).toDateString();
    if (!isToday && rand() < (weekend ? 0.45 : 0.1)) continue;
    const spike = rand() < 0.08 ? between(2.2, 3.4) : 1;
    const count = isToday ? 3 : Math.max(1, Math.round(between(1.4, 5) * ramp * spike * (weekend ? 0.6 : 1)));
    for (let s = 0; s < count; s++) {
      const project = pick(PROJECTS);
      const sessionId = `demo-${d.getTime()}-${s}`;
      let t = new Date(d);
      t.setHours(pick(HOURS), Math.floor(rand() * 60), Math.floor(rand() * 60));
      // today's sessions start in the hours before now so the page looks mid-day busy
      if (isToday) t = new Date(now - (s + 1) * between(35, 70) * 60_000);
      if (t.getTime() > now) continue;
      const source: Source = rand() < CODEX_SHARE ? "codex" : "claude";
      const model = pick(source === "codex" ? CODEX_MODELS : MODELS);
      const requests = Math.round(between(30, 230) * spike);
      let ctx = between(18_000, 40_000);
      for (let i = 0; i < requests && t.getTime() < now; i++) {
        ctx = Math.min(ctx + between(800, 6000), between(160_000, source === "codex" ? 250_000 : 420_000));
        const m = source === "claude" && rand() < 0.08 ? "claude-haiku-5-5" : model;
        out.push(event(project, sessionId, t.getTime(), m, rand, ctx, source));
        t = new Date(t.getTime() + between(6, 95) * 1000);
      }
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}

let events: UsageEvent[] | null = null;
let config: UserConfig = { footprint: structuredClone(defaultFootprint), theme: "dark" };
const all = () => (events ??= generate(Date.now()));

export function demoSummary(f: Filters): SummaryResponse {
  const ev = all();
  const summary = buildSummary(ev, f);
  const meta: Meta = {
    version,
    projectsDir: "~/.claude/projects",
    codexHome: "~/.codex",
    files: new Set(ev.map((e) => e.sessionId)).size,
    warnings: { malformedLines: 0, skippedSynthetic: 0, duplicates: 0 },
    pricing: { source: pricing.source, checked: pricing.checked, sources: pricing.sources, models: Object.keys(pricing.models) },
    footprintSources,
    waterLadder,
    energyLadder,
    projects: byProject(ev).map((p) => ({ key: p.key, label: p.label, total: p.total })),
    models: byModel(ev).map((m) => ({ key: m.key, label: modelLabel(m.key), total: m.total })),
    sources: bySource(ev).map((x) => ({ key: x.key, label: SOURCE_LABELS[x.key as Source], total: x.total })),
    config,
  };
  return { summary, footprint: footprintOf(summary.totals, config.footprint), allTime: liveSnapshot(ev, config.footprint), meta };
}

type Listener = (type: "hello" | "usage" | "config", data: LiveSnapshot & { at?: number; config?: UserConfig }) => void;
const listeners = new Set<Listener>();
const emit: Listener = (type, data) => listeners.forEach((l) => l(type, data));

export function demoSaveConfig(patch: Partial<UserConfig>): UserConfig {
  config = { ...config, ...patch, footprint: { ...config.footprint, ...patch.footprint, tokenWeights: { ...config.footprint.tokenWeights, ...patch.footprint?.tokenWeights } } };
  emit("config", { config, ...liveSnapshot(all(), config.footprint) });
  return config;
}

// The live session: one Claude Code window working through a task, a request every few seconds.
const liveSession = `demo-live-${Date.now()}`;
let liveCtx = 60_000;
let timer: number | null = null;

function tick() {
  const ev = all();
  const burst = Math.random() < 0.25 ? 2 : 1;
  for (let i = 0; i < burst; i++) {
    liveCtx = liveCtx > 380_000 ? 40_000 : liveCtx + 800 + Math.random() * 5200;
    ev.push(event(LIVE_PROJECT, liveSession, Date.now(), LIVE_MODEL, Math.random, liveCtx));
  }
  emit("usage", { ...liveSnapshot(ev, config.footprint), at: Date.now() });
  timer = window.setTimeout(tick, 3500 + Math.random() * 5500);
}

/** Stands in for the server's SSE stream. Returns an unsubscribe function. */
export function subscribeDemo(listener: Listener): () => void {
  listeners.add(listener);
  listener("hello", liveSnapshot(all(), config.footprint));
  if (timer === null) timer = window.setTimeout(tick, 2500);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };
}
