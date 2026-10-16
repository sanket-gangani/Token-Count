import { costBreakdownOfEvent, costOf, costOfEvent, type KindCost } from "./cost.js";
import type { Bucket, SessionSummary, TokenTotals, UsageEvent } from "./types.js";

export interface Filters {
  /** inclusive epoch ms */
  from?: number;
  /** exclusive epoch ms */
  to?: number;
  projects?: string[];
  models?: string[];
}

export function filterEvents(events: readonly UsageEvent[], f: Filters = {}): UsageEvent[] {
  const projects = f.projects?.length ? new Set(f.projects) : null;
  const models = f.models?.length ? new Set(f.models) : null;
  return events.filter(
    (e) =>
      (f.from === undefined || e.ts >= f.from) &&
      (f.to === undefined || e.ts < f.to) &&
      (!projects || projects.has(e.project)) &&
      (!models || models.has(e.model)),
  );
}

export function emptyTotals(): TokenTotals {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 };
}

export function addEvent(t: TokenTotals, e: UsageEvent): TokenTotals {
  t.input += e.input;
  t.output += e.output;
  t.cacheWrite += e.cacheWrite5m + e.cacheWrite1h;
  t.cacheRead += e.cacheRead;
  t.total += e.input + e.output + e.cacheWrite5m + e.cacheWrite1h + e.cacheRead;
  return t;
}

export function tokenTotals(events: Iterable<UsageEvent>): TokenTotals {
  const t = emptyTotals();
  for (const e of events) addEvent(t, e);
  return t;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local-time calendar day: YYYY-MM-DD */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** Local-time month: YYYY-MM */
export function monthKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
/** Local-time week, keyed by its Monday: YYYY-MM-DD */
export function weekKey(ts: number): string {
  return dayKey(startOfWeek(ts));
}

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
export function startOfWeek(ts: number): number {
  const d = new Date(startOfDay(ts));
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - dow);
  return d.getTime();
}
export function startOfMonth(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export function groupBy(events: Iterable<UsageEvent>, keyOf: (e: UsageEvent) => string): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const e of events) {
    const k = keyOf(e);
    let b = map.get(k);
    if (!b) {
      b = { key: k, ...emptyTotals(), usd: 0, unknownTokens: 0, requests: 0 };
      map.set(k, b);
    }
    addEvent(b, e);
    b.requests++;
    const c = costOfEvent(e);
    if (c === null) b.unknownTokens += e.input + e.output + e.cacheWrite5m + e.cacheWrite1h + e.cacheRead;
    else b.usd += c;
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export const byDay = (ev: Iterable<UsageEvent>) => groupBy(ev, (e) => dayKey(e.ts));
export const byWeek = (ev: Iterable<UsageEvent>) => groupBy(ev, (e) => weekKey(e.ts));
export const byMonth = (ev: Iterable<UsageEvent>) => groupBy(ev, (e) => monthKey(e.ts));
export const byModel = (ev: Iterable<UsageEvent>) =>
  groupBy(ev, (e) => e.model).sort((a, b) => b.total - a.total);

export interface ProjectBucket extends Bucket {
  label: string;
}
export function byProject(ev: Iterable<UsageEvent>): ProjectBucket[] {
  const labels = new Map<string, string>();
  const list = [...ev];
  for (const e of list) if (!labels.has(e.project)) labels.set(e.project, e.projectLabel);
  return groupBy(list, (e) => e.project)
    .map((b) => ({ ...b, label: labels.get(b.key) ?? b.key }))
    .sort((a, b) => b.total - a.total);
}

/** Fill in missing days between first and last so charts show gaps honestly. */
export function fillDays(buckets: Bucket[], from?: number, to?: number): Bucket[] {
  if (!buckets.length && from === undefined) return [];
  const start = from !== undefined ? startOfDay(from) : Date.parse(buckets[0].key + "T00:00");
  const end = to !== undefined ? startOfDay(to - 1) : Date.parse(buckets[buckets.length - 1].key + "T00:00");
  const have = new Map(buckets.map((b) => [b.key, b]));
  const out: Bucket[] = [];
  const d = new Date(start);
  while (d.getTime() <= end) {
    const k = dayKey(d.getTime());
    out.push(have.get(k) ?? { key: k, ...emptyTotals(), usd: 0, unknownTokens: 0, requests: 0 });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export function sessions(events: Iterable<UsageEvent>): SessionSummary[] {
  const map = new Map<string, SessionSummary & { modelTokens: Map<string, number> }>();
  for (const e of events) {
    let s = map.get(e.sessionId);
    if (!s) {
      s = {
        sessionId: e.sessionId,
        project: e.project,
        projectLabel: e.projectLabel,
        model: e.model,
        models: [],
        start: e.ts,
        end: e.ts,
        durationMs: 0,
        ...emptyTotals(),
        usd: 0,
        unknownTokens: 0,
        requests: 0,
        modelTokens: new Map(),
      };
      map.set(e.sessionId, s);
    }
    addEvent(s, e);
    s.requests++;
    s.start = Math.min(s.start, e.ts);
    s.end = Math.max(s.end, e.ts);
    const c = costOfEvent(e);
    if (c === null) s.unknownTokens += e.input + e.output + e.cacheWrite5m + e.cacheWrite1h + e.cacheRead;
    else s.usd += c;
    const tk = e.input + e.output + e.cacheWrite5m + e.cacheWrite1h + e.cacheRead;
    s.modelTokens.set(e.model, (s.modelTokens.get(e.model) ?? 0) + tk);
  }
  return [...map.values()]
    .map(({ modelTokens, ...s }) => {
      const sorted = [...modelTokens.entries()].sort((a, b) => b[1] - a[1]);
      return { ...s, model: sorted[0]?.[0] ?? s.model, models: sorted.map((x) => x[0]), durationMs: s.end - s.start };
    })
    .sort((a, b) => b.end - a.end);
}

export interface PeriodCard extends TokenTotals {
  label: string;
  from: number;
  usd: number;
  unknownTokens: number;
  topModel: string | null;
  requests: number;
}

export function periodCard(label: string, events: readonly UsageEvent[], from: number, now: number): PeriodCard {
  const slice = filterEvents(events, { from, to: now + 1 });
  const t = tokenTotals(slice);
  const c = costOf(slice);
  const models = byModel(slice);
  return { label, from, ...t, usd: c.usd, unknownTokens: c.unknownTokens, topModel: models[0]?.key ?? null, requests: slice.length };
}

/** Tokens and cost by local hour of day (0-23). */
export function byHourOfDay(events: Iterable<UsageEvent>): Bucket[] {
  const out: Bucket[] = Array.from({ length: 24 }, (_, h) => ({ key: String(h), ...emptyTotals(), usd: 0, unknownTokens: 0, requests: 0 }));
  for (const e of events) {
    const b = out[new Date(e.ts).getHours()];
    addEvent(b, e);
    b.requests++;
    const c = costOfEvent(e);
    if (c === null) b.unknownTokens += e.input + e.output + e.cacheWrite5m + e.cacheWrite1h + e.cacheRead;
    else b.usd += c;
  }
  return out;
}

export function costByKind(events: Iterable<UsageEvent>): KindCost & { cacheSavings: number } {
  const t = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cacheSavings: 0 };
  for (const e of events) {
    const b = costBreakdownOfEvent(e);
    if (!b) continue;
    t.input += b.input;
    t.output += b.output;
    t.cacheWrite += b.cacheWrite;
    t.cacheRead += b.cacheRead;
    t.cacheSavings += b.cacheSavings;
  }
  return t;
}

export interface Summary {
  generatedAt: number;
  range: { from: number | null; to: number | null };
  totals: TokenTotals & { usd: number; unknownTokens: number; unknownModels: string[]; requests: number; sessions: number };
  costByKind: KindCost & { cacheSavings: number };
  hours: Bucket[];
  periods: { today: PeriodCard; week: PeriodCard; month: PeriodCard };
  days: Bucket[];
  weeks: Bucket[];
  months: Bucket[];
  models: Bucket[];
  projects: ProjectBucket[];
  sessions: SessionSummary[];
  first: number | null;
  last: number | null;
}

export function buildSummary(all: readonly UsageEvent[], f: Filters = {}, now = Date.now(), sessionLimit = 50): Summary {
  const events = filterEvents(all, f);
  const t = tokenTotals(events);
  const c = costOf(events);
  const sess = sessions(events);
  let first: number | null = null;
  let last: number | null = null;
  for (const e of events) {
    if (first === null || e.ts < first) first = e.ts;
    if (last === null || e.ts > last) last = e.ts;
  }
  // Period cards respect project/model filters but always use the calendar window.
  const scoped = filterEvents(all, { projects: f.projects, models: f.models });
  return {
    generatedAt: now,
    range: { from: f.from ?? null, to: f.to ?? null },
    totals: { ...t, usd: c.usd, unknownTokens: c.unknownTokens, unknownModels: c.unknownModels, requests: events.length, sessions: sess.length },
    costByKind: costByKind(events),
    hours: byHourOfDay(events),
    periods: {
      today: periodCard("Today", scoped, startOfDay(now), now),
      week: periodCard("This week", scoped, startOfWeek(now), now),
      month: periodCard("This month", scoped, startOfMonth(now), now),
    },
    days: fillDays(byDay(events), f.from, f.to),
    weeks: byWeek(events),
    months: byMonth(events),
    models: byModel(events),
    projects: byProject(events),
    sessions: sess.slice(0, sessionLimit),
    first,
    last,
  };
}
