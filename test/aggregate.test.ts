import { describe, expect, it } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { UsageStore } from "../src/store.js";
import { buildSummary, byDay, byModel, byProject, dayKey, filterEvents, sessions, startOfWeek, tokenTotals, weekKey } from "../src/aggregate.js";
import { costOf, costOfEvent, modelLabel, normalizeModel, priceFor } from "../src/cost.js";
import { describeEnergy, describeWater, energyWh, footprintOf, lakeLevel, waterLiters } from "../src/footprint.js";
import { loadConfig, mergeConfig, saveConfig } from "../src/config.js";

const fixtures = path.join(__dirname, "fixtures", "projects");
const load = () => {
  const s = new UsageStore(fixtures);
  s.loadAll();
  return s.events;
};

describe("cost", () => {
  it("normalizes model ids", () => {
    expect(normalizeModel("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5");
    expect(normalizeModel("us.anthropic.claude-opus-5-5-v1:0")).toBe("claude-opus-5-5");
    expect(normalizeModel("claude-opus-4-5@20251101")).toBe("claude-opus-4-5");
    expect(normalizeModel("claude-3-5-haiku-20241022")).toBe("claude-3-5-haiku");
    expect(normalizeModel("claude-sonnet-5-5[1m]")).toBe("claude-sonnet-5-5");
  });
  it("prices each token kind, including 1h cache writes", () => {
    const ev = load().find((e) => e.key === "msg_1:req_1")!;
    // opus 5.5: 10*4 + 100*20 + 400*5 + 600*8 + 5000*0.20 = 40+2000+2000+4800+1000 = 9840 / 1e6
    expect(costOfEvent(ev)).toBeCloseTo(0.00984, 8);
  });
  it("applies the long-context tier for haiku 5.5 over 100k prompt tokens", () => {
    const ev = load().find((e) => e.key === "msg_20:req_20")!;
    // 150000*0.50 + 1000*2.50 = 75000 + 2500 = 77500 / 1e6
    expect(costOfEvent(ev)).toBeCloseTo(0.0775, 8);
  });
  it("marks unknown models instead of guessing", () => {
    const c = costOf(load());
    expect(c.unknownModels).toEqual(["claude-future-9"]);
    expect(c.unknownTokens).toBe(3000);
    expect(priceFor("claude-future-9")).toBeNull();
  });
  it("labels models", () => {
    expect(modelLabel("claude-opus-5-5")).toBe("Opus 5.5");
    expect(modelLabel("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
    expect(modelLabel("claude-3-5-haiku-20241022")).toBe("Haiku 3.5");
    expect(modelLabel("claude-opus-4")).toBe("Opus 4");
    expect(modelLabel("gpt-9")).toBe("gpt-9");
  });
});

describe("aggregate", () => {
  it("totals all token kinds", () => {
    const t = tokenTotals(load());
    expect(t.input).toBe(10 + 200 + 1000 + 5000 + 150000 + 1);
    expect(t.cacheWrite).toBe(1000 + 300);
    expect(t.total).toBe(t.input + t.output + t.cacheWrite + t.cacheRead);
  });
  it("buckets by day/model/project", () => {
    const ev = load();
    expect(byDay(ev).map((b) => b.key)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"].map((d) => dayKey(Date.parse(d + "T12:00:00Z"))).filter((v, i, a) => a.indexOf(v) === i));
    expect(byModel(ev)[0].key).toBe("claude-haiku-5-5");
    const p = byProject(ev);
    expect(p[0].label).toBe("app-two");
    expect(p.map((x) => x.key).sort()).toEqual(["-Users-alice-app-one", "-Users-alice-app-two"]);
  });
  it("filters by range, project and model", () => {
    const ev = load();
    expect(filterEvents(ev, { models: ["claude-opus-5-5"] })).toHaveLength(1);
    expect(filterEvents(ev, { projects: ["-Users-alice-app-two"] })).toHaveLength(3);
    expect(filterEvents(ev, { from: Date.parse("2026-10-03T00:00:00Z") })).toHaveLength(1);
  });
  it("summarizes sessions with duration and dominant model", () => {
    const s = sessions(load());
    const one = s.find((x) => x.sessionId === "sess-1")!;
    expect(one.requests).toBe(3);
    expect(one.durationMs).toBe(Date.parse("2026-10-02T09:00:00Z") - Date.parse("2026-10-01T10:00:05Z"));
    expect(one.model).toBe("claude-opus-5-5");
    expect(one.models).toContain("claude-future-9");
  });
  it("week keys start on Monday", () => {
    const wed = Date.parse("2026-10-14T12:00:00");
    expect(new Date(startOfWeek(wed)).getDay()).toBe(1);
    expect(weekKey(wed)).toBe(dayKey(startOfWeek(wed)));
  });
  it("builds a full summary with period cards", () => {
    const now = Date.parse("2026-10-02T23:00:00");
    const s = buildSummary(load(), {}, now);
    expect(s.totals.requests).toBe(6);
    expect(s.periods.today.requests).toBeGreaterThan(0);
    expect(s.days.length).toBeGreaterThanOrEqual(3);
    expect(s.sessions.length).toBe(3);
  });
});

describe("footprint", () => {
  it("computes energy and water from weighted tokens", () => {
    const wh = energyWh({ input: 0, output: 1_000_000, cacheWrite: 0, cacheRead: 0, total: 1_000_000 });
    expect(wh).toBe(600);
    expect(waterLiters(wh)).toBeCloseTo(1.2, 6);
    const whIn = energyWh({ input: 1_000_000, output: 0, cacheWrite: 0, cacheRead: 0, total: 1_000_000 });
    expect(whIn).toBe(60);
  });
  it("walks the ladder with playful copy", () => {
    expect(describeWater(0.3).text).toBe("≈ 1.2 cups of water");
    expect(describeWater(150).text).toBe("≈ 1.0 bathtub");
    expect(describeWater(480).text).toBe("≈ 3.2 bathtubs");
    expect(describeWater(0.001).text).toBe("≈ 0.1 sips");
    expect(describeWater(5e8).text).toBe("≈ 5.0 small lakes");
    expect(describeEnergy(24).text).toBe("≈ 2.0 phone charges");
  });
  it("drains the lake on a log scale", () => {
    expect(lakeLevel(0)).toBe(1);
    expect(lakeLevel(0.015)).toBe(1);
    expect(lakeLevel(1e8)).toBe(0);
    const mid = lakeLevel(Math.sqrt(0.015 * 1e8));
    expect(mid).toBeCloseTo(0.5, 6);
    const f = footprintOf({ input: 0, output: 1e6, cacheWrite: 0, cacheRead: 0, total: 1e6 });
    expect(f.lakeLevel).toBeGreaterThan(0.5);
    expect(f.lakeLevel).toBeLessThan(1);
  });
});

describe("config", () => {
  it("loads defaults, merges safely, and round-trips", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tb-home-"));
    const env = { TOKENBURN_HOME: home };
    const cfg = loadConfig(env);
    expect(cfg.footprint.litersPerKWh).toBe(2);
    const merged = mergeConfig(cfg, { footprint: { litersPerKWh: 3, tokenWeights: { input: -1, output: 2 } }, theme: "light", junk: 1 });
    expect(merged.footprint.litersPerKWh).toBe(3);
    expect(merged.footprint.tokenWeights.input).toBe(0.1);
    expect(merged.footprint.tokenWeights.output).toBe(2);
    expect(merged.theme).toBe("light");
    saveConfig(merged, env);
    expect(loadConfig(env).footprint.litersPerKWh).toBe(3);
    fs.rmSync(home, { recursive: true, force: true });
  });
});

describe("cost breakdown + hours", () => {
  it("splits cost by token kind and computes cache savings", async () => {
    const { costBreakdownOfEvent } = await import("../src/cost.js");
    const ev = load().find((e) => e.key === "msg_1:req_1")!;
    const b = costBreakdownOfEvent(ev)!;
    // opus 5.5: input 10*4, output 100*20, writes 400*5 + 600*8, reads 5000*0.20
    expect(b.input).toBeCloseTo(40 / 1e6, 10);
    expect(b.output).toBeCloseTo(2000 / 1e6, 10);
    expect(b.cacheWrite).toBeCloseTo(6800 / 1e6, 10);
    expect(b.cacheRead).toBeCloseTo(1000 / 1e6, 10);
    expect(b.cacheSavings).toBeCloseTo((5000 * 3.8) / 1e6, 10);
    expect(b.input + b.output + b.cacheWrite + b.cacheRead).toBeCloseTo(costOfEvent(ev)!, 12);
  });
  it("buckets by local hour of day and includes costByKind in the summary", () => {
    const s = buildSummary(load(), {}, Date.parse("2026-10-03T12:00:00"));
    expect(s.hours).toHaveLength(24);
    expect(s.hours.reduce((a, h) => a + h.requests, 0)).toBe(6);
    const k = s.costByKind;
    expect(k.input + k.output + k.cacheWrite + k.cacheRead).toBeCloseTo(s.totals.usd, 10);
  });
});
