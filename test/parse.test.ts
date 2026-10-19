import { describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { newWarnings, parseFile, parseFileIncremental, parseLine } from "../src/parse.js";
import { UsageStore } from "../src/store.js";
import { listJsonlFiles, projectKeyForFile, resolveProjectsDir } from "../src/discover.js";

const fixtures = path.join(__dirname, "fixtures", "projects");
const ctx = () => ({ project: "-Users-alice-app-one", seen: new Set<string>(), warnings: newWarnings() });

describe("parseLine", () => {
  it("reads usage fields and derives project label from cwd", () => {
    const c = ctx();
    const ev = parseLine(
      JSON.stringify({ type: "assistant", uuid: "x", sessionId: "s", requestId: "r", timestamp: "2026-10-01T00:00:00Z", cwd: "/a/b/my-proj", message: { id: "m", model: "claude-opus-5-5", usage: { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 3, cache_read_input_tokens: 4 } } }),
      c,
    );
    expect(ev).toMatchObject({ input: 1, output: 2, cacheWrite5m: 3, cacheWrite1h: 0, cacheRead: 4, projectLabel: "my-proj", model: "claude-opus-5-5" });
  });
  it("splits cache writes by TTL when the breakdown is present", () => {
    const c = ctx();
    const ev = parseLine(
      JSON.stringify({ type: "assistant", requestId: "r", timestamp: "2026-10-01T00:00:00Z", message: { id: "m", model: "x", usage: { input_tokens: 0, output_tokens: 1, cache_creation_input_tokens: 10, cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 4, ephemeral_1h_input_tokens: 6 } } } }),
      c,
    );
    expect(ev?.cacheWrite5m).toBe(4);
    expect(ev?.cacheWrite1h).toBe(6);
  });
  it("ignores non-assistant lines and malformed json", () => {
    const c = ctx();
    expect(parseLine('{"type":"user"}', c)).toBeNull();
    expect(parseLine("nope", c)).toBeNull();
    expect(parseLine("[1,2]", c)).toBeNull();
    expect(parseLine("", c)).toBeNull();
    expect(c.warnings.malformedLines).toBe(2);
  });
  it("never reads message content", () => {
    const c = ctx();
    const ev = parseLine(
      JSON.stringify({ type: "assistant", requestId: "r", timestamp: "2026-10-01T00:00:00Z", message: { id: "m", model: "x", content: [{ type: "text", text: "SECRET" }], usage: { output_tokens: 1 } } }),
      c,
    );
    expect(JSON.stringify(ev)).not.toContain("SECRET");
  });
});

describe("parseFile", () => {
  it("de-duplicates repeated message lines and skips synthetic + malformed", () => {
    const c = ctx();
    const events = parseFile(path.join(fixtures, "-Users-alice-app-one", "sess-1.jsonl"), c);
    expect(events.map((e) => e.key)).toEqual(["msg_1:req_1", "msg_3:req_3", "msg_4:req_4"]);
    expect(c.warnings.duplicates).toBe(2);
    expect(c.warnings.skippedSynthetic).toBe(1);
    expect(c.warnings.malformedLines).toBe(2);
    expect(events[0]).toMatchObject({ input: 10, output: 100, cacheWrite5m: 400, cacheWrite1h: 600, cacheRead: 5000 });
  });
  it("handles a file with no trailing newline", () => {
    const c = { ...ctx(), project: "-Users-alice-app-two" };
    const events = parseFile(path.join(fixtures, "-Users-alice-app-two", "sess-3-no-trailing-newline.jsonl"), c);
    expect(events).toHaveLength(1);
    expect(events[0].model).toBe("claude-opus-5");
  });
  it("tails incrementally and keeps a partial line until it completes", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tb-"));
    const f = path.join(tmp, "live.jsonl");
    const line = (id: string) =>
      JSON.stringify({ type: "assistant", requestId: id, timestamp: "2026-10-01T00:00:00Z", message: { id, model: "m", usage: { output_tokens: 5 } } });
    const c = ctx();
    fs.writeFileSync(f, line("a") + "\n" + line("b").slice(0, 20));
    let r = parseFileIncremental(f, c, 0, "");
    expect(r.events).toHaveLength(1);
    expect(r.remainder.length).toBe(20);
    fs.appendFileSync(f, line("b").slice(20) + "\n");
    r = parseFileIncremental(f, c, r.offset, r.remainder);
    expect(r.events).toHaveLength(1);
    expect(r.events[0].key).toBe("b:b");
    expect(r.remainder).toBe("");
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe("UsageStore + discover", () => {
  it("finds nested subagent files and assigns project keys", () => {
    const files = listJsonlFiles(fixtures);
    expect(files.some((f) => f.includes("subagents"))).toBe(true);
    expect(projectKeyForFile(fixtures, files.find((f) => f.includes("subagents"))!)).toBe("-Users-alice-app-two");
  });
  it("de-dupes across files globally", () => {
    const store = new UsageStore(fixtures);
    const n = store.loadAll();
    expect(n).toBe(4);
    const keys = store.events.map((e) => e.key);
    expect(keys.filter((k) => k === "msg_1:req_1")).toHaveLength(1);
    expect(store.events).toHaveLength(6);
    expect(store.events.find((e) => e.isSidechain)?.model).toBe("claude-haiku-5-5");
  });
  it("resolves projects dir from --dir, CLAUDE_CONFIG_DIR and home", () => {
    expect(resolveProjectsDir({ dir: fixtures })).toBe(fixtures);
    expect(resolveProjectsDir({ dir: path.dirname(fixtures) })).toBe(fixtures);
    expect(resolveProjectsDir({ env: { CLAUDE_CONFIG_DIR: path.dirname(fixtures) }, homedir: "/nope" })).toBe(fixtures);
    expect(resolveProjectsDir({ env: {}, homedir: "/nope" })).toBe(path.join("/nope", ".claude", "projects"));
    // --dir pointing straight at a folder of project folders with any name
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), "tb-logs-"));
    fs.mkdirSync(path.join(copy, "-Users-a-app"));
    expect(resolveProjectsDir({ dir: copy })).toBe(copy);
    fs.rmSync(copy, { recursive: true, force: true });
  });
});
