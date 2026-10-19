import { useEffect, useRef, useState } from "react";
import type { Source } from "../../src/types";
export type { Source };

export interface Totals {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  total: number;
}
export interface Bucket extends Totals {
  key: string;
  usd: number;
  unknownTokens: number;
  requests: number;
}
export interface ProjectBucket extends Bucket {
  label: string;
}
export interface PeriodCard extends Totals {
  label: string;
  from: number;
  usd: number;
  unknownTokens: number;
  topModel: string | null;
  requests: number;
}
export interface SessionSummary extends Totals {
  sessionId: string;
  source: Source;
  project: string;
  projectLabel: string;
  model: string;
  models: string[];
  start: number;
  end: number;
  durationMs: number;
  usd: number;
  unknownTokens: number;
  requests: number;
}
export interface Summary {
  generatedAt: number;
  range: { from: number | null; to: number | null };
  totals: Totals & { usd: number; unknownTokens: number; unknownModels: string[]; requests: number; sessions: number };
  costByKind: { input: number; output: number; cacheWrite: number; cacheRead: number; cacheSavings: number };
  hours: Bucket[];
  periods: { today: PeriodCard; week: PeriodCard; month: PeriodCard };
  days: Bucket[];
  weeks: Bucket[];
  months: Bucket[];
  models: Bucket[];
  projects: ProjectBucket[];
  sources: Bucket[];
  sessions: SessionSummary[];
  first: number | null;
  last: number | null;
}
export interface LadderUnit {
  id: string;
  singular: string;
  plural: string;
  size: number;
  quip: string;
}
export interface LadderReading {
  unit: LadderUnit;
  count: number;
  text: string;
  quip: string;
  stage: number;
}
export interface FootprintConfig {
  whPerMillionOutputTokens: number;
  tokenWeights: { input: number; output: number; cacheWrite: number; cacheRead: number };
  litersPerKWh: number;
}
export interface Footprint {
  wh: number;
  liters: number;
  water: LadderReading;
  energy: LadderReading;
  lakeLevel: number;
  config: FootprintConfig;
}
export interface UserConfig {
  footprint: FootprintConfig;
  theme?: "dark" | "light";
}
export interface Meta {
  version: string;
  projectsDir: string;
  codexHome: string | null;
  files: number;
  warnings: { malformedLines: number; skippedSynthetic: number; duplicates: number };
  pricing: { source: string; checked: string; sources: { provider: string; source: string; checked: string }[]; models: string[] };
  footprintSources: { claim: string; url: string }[];
  waterLadder: LadderUnit[];
  energyLadder: LadderUnit[];
  projects: { key: string; label: string; total: number }[];
  models: { key: string; label: string; total: number }[];
  sources: { key: string; label: string; total: number }[];
  config: UserConfig;
}
export interface LiveSnapshot {
  totals: Totals & { usd: number; unknownTokens: number; requests: number };
  footprint: Footprint;
  lastHour: { total: number; output: number; usd: number; requests: number };
  lastEventTs: number | null;
}
export interface SummaryResponse {
  summary: Summary;
  footprint: Footprint;
  allTime: LiveSnapshot;
  meta: Meta;
}

export interface Filters {
  from?: number;
  to?: number;
  projects: string[];
  models: string[];
  sources: Source[];
}

export function filtersToQuery(f: Filters): string {
  const q = new URLSearchParams();
  if (f.from !== undefined) q.set("from", String(f.from));
  if (f.to !== undefined) q.set("to", String(f.to));
  if (f.projects.length) q.set("projects", f.projects.join(","));
  if (f.models.length) q.set("models", f.models.join(","));
  if (f.sources.length) q.set("sources", f.sources.join(","));
  const s = q.toString();
  return s ? "?" + s : "";
}

/** Built with VITE_DEMO=1 for the hosted preview: fictional data, no local server. */
export const DEMO = import.meta.env.VITE_DEMO === "1";

export async function fetchSummary(f: Filters): Promise<SummaryResponse> {
  if (DEMO) return (await import("./demo")).demoSummary(f);
  const r = await fetch("/api/summary" + filtersToQuery(f));
  if (!r.ok) throw new Error(`summary ${r.status}`);
  return r.json();
}

export async function saveConfig(patch: Partial<UserConfig>): Promise<UserConfig> {
  if (DEMO) return (await import("./demo")).demoSaveConfig(patch);
  const r = await fetch("/api/config", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
  if (!r.ok) throw new Error(`config ${r.status}`);
  return r.json();
}

export interface LiveState {
  connected: boolean;
  snapshot: LiveSnapshot | null;
  /** increments on every usage event; use as a refetch trigger */
  tick: number;
  lastEventAt: number | null;
  /** tokens added by the most recent live event batch */
  lastDelta: number;
}

/** Subscribe to the server's SSE stream. */
export function useLive(): LiveState {
  const [state, setState] = useState<LiveState>({ connected: false, snapshot: null, tick: 0, lastEventAt: null, lastDelta: 0 });
  const esRef = useRef<EventSource | null>(null);
  useEffect(() => {
    const on = {
      hello: (snap: LiveSnapshot) => setState((s) => ({ ...s, connected: true, snapshot: snap })),
      usage: (d: LiveSnapshot & { at: number }) =>
        setState((s) => ({
          connected: true,
          snapshot: d,
          tick: s.tick + 1,
          lastEventAt: d.at,
          lastDelta: s.snapshot ? Math.max(0, d.totals.total - s.snapshot.totals.total) : 0,
        })),
      config: (d: LiveSnapshot) => setState((s) => ({ ...s, snapshot: d, tick: s.tick + 1, lastDelta: 0 })),
    };
    if (DEMO) {
      let off: (() => void) | null = null;
      let gone = false;
      import("./demo").then((m) => {
        if (!gone) off = m.subscribeDemo((type, d) => on[type](d as LiveSnapshot & { at: number }));
      });
      return () => {
        gone = true;
        off?.();
      };
    }
    const es = new EventSource("/api/events");
    esRef.current = es;
    es.onopen = () => setState((s) => ({ ...s, connected: true }));
    es.onerror = () => setState((s) => ({ ...s, connected: false }));
    for (const type of ["hello", "usage", "config"] as const) es.addEventListener(type, (e) => on[type](JSON.parse((e as MessageEvent).data)));
    return () => es.close();
  }, []);
  return state;
}
