import { describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { codexLogDirs, newCodexState, parseCodexFile, parseCodexLine, resolveCodexHome } from "../src/codex.js";
import { newWarnings } from "../src/parse.js";
import { UsageStore } from "../src/store.js";
import { buildSummary, filterEvents } from "../src/aggregate.js";
import { costOf, costOfEvent, normalizeModel, priceFor } from "../src/cost.js";

const root = path.join(__dirname, "..");
const claudeFixtures = path.join(__dirname, "fixtures", "projects");
const codexHome = path.join(__dirname, "fixtures", "codex");
const ID_A = "0199aaaa-0000-7000-8000-000000000001";
const ID_B = "0199bbbb-0000-7000-8000-000000000002";
const fileA = path.join(codexHome, "sessions", "2026", "10", "01", `rollout-2026-10-01T09-00-00-${ID_A}.jsonl`);
const fileB = path.join(codexHome, "archived_sessions", `rollout-2026-10-02T10-00-00-${ID_B}.jsonl`);
const ctxFor = (file: string) => ({ state: newCodexState(file), seen: new Set<string>(), warnings: newWarnings() });
const tmp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

describe("parseCodexFile (token_count only, older Codex)", () => {
  const c = ctxFor(fileA);
  const events = parseCodexFile(fileA, c);

  it("turns each new token_count into one event, with cached input as cache reads", () => {
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ source: "codex", model: "gpt-5.5", sessionId: ID_A, input: 2000, cacheRead: 8000, cacheWrite5m: 0, cacheWrite1h: 0, output: 500 });
    expect(events[0].ts).toBe(Date.parse("2026-10-01T09:00:05.000Z"));
    // per-response numbers come from last_token_usage, not the running total
    expect(events[1]).toMatchObject({ input: 1000, cacheRead: 11000, output: 300 });
  });
  it("keys projects like Claude Code does so the same folder merges", () => {
    expect(events[0].project).toBe("-Users-alice-app-one");
    expect(events[0].projectLabel).toBe("app-one");
  });
  it("drops repeated totals, rollback replays, empty usage and rate-limit-only lines", () => {
    expect(c.warnings.duplicates).toBe(2);
    expect(c.warnings.malformedLines).toBe(1);
    expect(events.every((e) => e.input + e.output + e.cacheRead > 0)).toBe(true);
  });
  it("follows model switches and leaves unknown models unpriced", () => {
    expect(events[2]).toMatchObject({ model: "gpt-future-9", input: 3000, output: 100 });
    expect(costOfEvent(events[2])).toBeNull();
    // gpt-5.5: 2000*5 + 8000*0.5 + 500*30 = 29000 / 1e6
    expect(costOfEvent(events[0])).toBeCloseTo(0.029, 10);
  });
  it("never reads prompt or response content", () => {
    expect(JSON.stringify(events)).not.toContain("SECRET");
    expect(JSON.stringify(c.state)).not.toContain("SECRET");
  });
});

describe("parseCodexFile (token_usage_record, newer Codex)", () => {
  const c = ctxFor(fileB);
  const events = parseCodexFile(fileB, c);

  it("counts each response once: records by response_id, echoes skipped", () => {
    expect(events.map((e) => e.key)).toEqual(["codex:resp_1", "codex:resp_2", "codex:resp_3", expect.stringMatching(new RegExp(`^codex:${ID_B}:`))]);
    expect(c.warnings.duplicates).toBe(0);
    expect(events[0]).toMatchObject({ model: "gpt-5.6-sol", input: 50000, cacheRead: 250000, output: 1000, projectLabel: "codex-only" });
    // a later token_count with no record of its own (older CLI resumed the session) still counts
    expect(events[3]).toMatchObject({ input: 1000, cacheRead: 1000, output: 20 });
  });
  it("uses the long-context price above 272K prompt tokens", () => {
    // gpt-5.6-sol long context: 50000*8 + 250000*0.8 + 1000*30 = 630000 / 1e6
    expect(costOfEvent(events[0])).toBeCloseTo(0.63, 10);
    // short context: 1000*4 + 4000*0.4 + 50*20 = 6600 / 1e6
    expect(costOfEvent(events[1])).toBeCloseTo(0.0066, 10);
  });
  it("splits cache writes out of input when Codex reports them", () => {
    const c2 = ctxFor(fileB);
    c2.state.model = "gpt-6.1-sol";
    const ev = parseCodexLine(
      JSON.stringify({ timestamp: "2026-10-03T00:00:00Z", type: "token_usage_record", payload: { response_id: "resp_cw", usage: { input_tokens: 1000, cached_input_tokens: 600, cache_write_input_tokens: 300, output_tokens: 10, total_tokens: 1010 } } }),
      c2,
    );
    expect(ev).toMatchObject({ input: 100, cacheRead: 600, cacheWrite5m: 300, output: 10 });
    // gpt-6.1-sol: 100*2 + 600*0.1 + 300*2.5 + 10*10 = 1110 / 1e6
    expect(costOfEvent(ev!)).toBeCloseTo(0.00111, 10);
  });
});

describe("Codex discovery", () => {
  it("resolves the Codex home from --codex-dir, CODEX_HOME and home", () => {
    expect(resolveCodexHome({ dir: codexHome })).toBe(codexHome);
    expect(resolveCodexHome({ env: { CODEX_HOME: codexHome }, homedir: "/nope" })).toBe(codexHome);
    expect(resolveCodexHome({ env: {}, homedir: "/nope" })).toBe(path.join("/nope", ".codex"));
  });
  it("reads sessions/ and archived_sessions/, or a folder given directly", () => {
    expect(codexLogDirs(codexHome)).toEqual([path.join(codexHome, "sessions"), path.join(codexHome, "archived_sessions")]);
    expect(codexLogDirs(path.join(codexHome, "sessions"))).toEqual([path.join(codexHome, "sessions")]);
    const loose = tmp("tb-codex-");
    expect(codexLogDirs(loose, true)).toEqual([loose]);
    expect(codexLogDirs(loose, false)).toEqual([path.join(loose, "sessions"), path.join(loose, "archived_sessions")]);
    fs.rmSync(loose, { recursive: true, force: true });
  });
});

describe("UsageStore with Claude Code and Codex", () => {
  const load = () => {
    const s = new UsageStore(claudeFixtures, { codexDirs: codexLogDirs(codexHome) });
    s.loadAll();
    return s;
  };

  it("loads both sources side by side and combined", () => {
    const store = load();
    expect(store.fileCounts()).toEqual({ claude: 4, codex: 2 });
    expect(store.events.filter((e) => e.source === "claude")).toHaveLength(6);
    expect(store.events.filter((e) => e.source === "codex")).toHaveLength(7);
    const s = buildSummary(store.events, {}, Date.parse("2026-10-03T12:00:00"));
    expect(s.totals.requests).toBe(13);
    expect(s.sources.map((b) => b.key).sort()).toEqual(["claude", "codex"]);
    expect(s.sources.reduce((a, b) => a + b.total, 0)).toBe(s.totals.total);
    expect(s.sessions.find((x) => x.sessionId === ID_B)?.source).toBe("codex");
  });
  it("filters by source", () => {
    const store = load();
    expect(filterEvents(store.events, { sources: ["codex"] })).toHaveLength(7);
    expect(filterEvents(store.events, { sources: ["claude"] })).toHaveLength(6);
    expect(filterEvents(store.events, { sources: [] })).toHaveLength(13);
    const s = buildSummary(store.events, { sources: ["codex"] });
    expect(s.sources.map((b) => b.key)).toEqual(["codex"]);
  });
  it("merges a folder used with both tools into one project", () => {
    const s = buildSummary(load().events);
    const p = s.projects.find((x) => x.key === "-Users-alice-app-one")!;
    expect(p.label).toBe("app-one");
    expect(p.requests).toBe(3 + 3);
  });
  it("reports unknown Codex models next to unknown Claude ones", () => {
    expect(costOf(load().events).unknownModels).toEqual(["claude-future-9", "gpt-future-9"]);
  });
  it("counts a session once when the same rollout sits in sessions/ and archived_sessions/", () => {
    const home = tmp("tb-codex-home-");
    for (const d of ["sessions", "archived_sessions"]) {
      fs.mkdirSync(path.join(home, d));
      fs.copyFileSync(fileB, path.join(home, d, path.basename(fileB)));
    }
    const store = new UsageStore(path.join(home, "no-claude"), { codexDirs: codexLogDirs(home) });
    store.loadAll();
    expect(store.events).toHaveLength(4);
    fs.rmSync(home, { recursive: true, force: true });
  });
});

describe("live tailing and cache", () => {
  const linesB = fs.readFileSync(fileB, "utf8").split("\n").filter(Boolean);

  it("keeps model, session and echo state across appends and partial lines", () => {
    const home = tmp("tb-codex-live-");
    const sessions = path.join(home, "sessions");
    fs.mkdirSync(sessions);
    const f = path.join(sessions, path.basename(fileB));
    const store = new UsageStore(path.join(home, "no-claude"), { codexDirs: [sessions] });
    // meta, context and the first record; its echo arrives half-written
    fs.writeFileSync(f, linesB.slice(0, 3).join("\n") + "\n" + linesB[3].slice(0, 40));
    expect(store.loadFile(f).map((e) => e.key)).toEqual(["codex:resp_1"]);
    fs.appendFileSync(f, linesB[3].slice(40) + "\n");
    expect(store.loadFile(f)).toHaveLength(0);
    fs.appendFileSync(f, linesB.slice(4).join("\n") + "\n");
    const added = store.loadFile(f);
    expect(added).toHaveLength(3);
    expect(added.every((e) => e.model === "gpt-5.6-sol" && e.sessionId === ID_B)).toBe(true);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("resumes a Codex file from the cache without losing parser state", () => {
    const home = tmp("tb-codex-cache-");
    const sessions = path.join(home, "sessions");
    fs.mkdirSync(sessions);
    const env = { TOKENBURN_HOME: path.join(home, "tb") };
    const f = path.join(sessions, path.basename(fileB));
    fs.writeFileSync(f, linesB.slice(0, 3).join("\n") + "\n");
    const first = new UsageStore(path.join(home, "no-claude"), { codexDirs: [sessions], env });
    first.loadAll({ cache: true });
    expect(first.events).toHaveLength(1);
    // the echo of resp_1 and the rest arrive while TokenBurn is closed
    fs.appendFileSync(f, linesB.slice(3).join("\n") + "\n");
    const second = new UsageStore(path.join(home, "no-claude"), { codexDirs: [sessions], env });
    second.loadAll({ cache: true });
    const fresh = parseCodexFile(f, ctxFor(f));
    expect(second.events.map((e) => e.key)).toEqual(fresh.map((e) => e.key));
    expect(second.events.every((e) => e.model === "gpt-5.6-sol")).toBe(true);
    fs.rmSync(home, { recursive: true, force: true });
  });
});

describe("OpenAI pricing", () => {
  it("prices the Codex models found on the official page", () => {
    for (const m of ["gpt-5.5", "gpt-5.4", "gpt-5.2", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-6-sol", "gpt-6.1-sol", "gpt-6-astra"]) expect(priceFor(m)).not.toBeNull();
    expect(priceFor("gpt-future-9")).toBeNull();
    expect(normalizeModel("gpt-5-2025-08-07")).toBe("gpt-5");
  });
});

describe("cli --source", () => {
  it("filters summary/json by source", () => {
    const home = tmp("tb-cli-");
    const run = (...args: string[]) =>
      JSON.parse(
        execFileSync(process.execPath, ["--import", "tsx", "src/cli.ts", "--json", "--no-cache", "--dir", claudeFixtures, "--codex-dir", codexHome, ...args], {
          cwd: root,
          env: { ...process.env, TOKENBURN_HOME: home },
          encoding: "utf8",
        }),
      );
    const all = run();
    expect(all.summary.totals.requests).toBe(13);
    expect(all.files).toEqual({ claude: 4, codex: 2 });
    expect(run("--source", "codex").summary.totals.requests).toBe(7);
    expect(run("--source=claude").summary.totals.requests).toBe(6);
    fs.rmSync(home, { recursive: true, force: true });
  }, 30_000);
});
