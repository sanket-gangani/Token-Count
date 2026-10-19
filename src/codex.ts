import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ParseWarnings, UsageEvent } from "./types.js";
import { projectKeyFromCwd } from "./discover.js";
import { forEachNewLine, type IncrementalResult } from "./parse.js";

// OpenAI Codex writes one JSONL "rollout" per session. See docs/log-format.md
// for the observed shape. Only usage, model, timestamp, id and cwd fields are
// read; response items (prompts, replies, tool output) are never parsed.

export interface CodexDiscoverOptions {
  /** explicit --codex-dir override: the Codex home, or a folder of rollout files */
  dir?: string;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
}

/** The Codex home: --codex-dir, else $CODEX_HOME, else ~/.codex. */
export function resolveCodexHome(opts: CodexDiscoverOptions = {}): string {
  const env = opts.env ?? process.env;
  if (opts.dir) return path.resolve(opts.dir);
  if (env.CODEX_HOME) return path.resolve(env.CODEX_HOME);
  return path.join(opts.homedir ?? os.homedir(), ".codex");
}

/**
 * Folders that hold rollout files: <home>/sessions and <home>/archived_sessions.
 * Pointing straight at either of those works too, and so does (for an explicit
 * --codex-dir) any existing folder of rollouts whatever it is called.
 */
export function codexLogDirs(home: string, explicit = false): string[] {
  const base = path.basename(home);
  if (base === "sessions" || base === "archived_sessions") return [home];
  const dirs = [path.join(home, "sessions"), path.join(home, "archived_sessions")];
  if (explicit && !dirs.some((d) => fs.existsSync(d)) && fs.existsSync(home)) return [home];
  return dirs;
}

/** Parser state that carries from one line to the next within a rollout file. JSON-safe so the cache can keep it. */
export interface CodexFileState {
  sessionId: string;
  hasMeta: boolean;
  /** from the latest turn_context */
  model: string;
  cwd: string;
  /** total_token_usage of the previous token_count line, to drop repeats */
  lastTotal: string;
  /** usage of the latest token_usage_record, until its token_count echo arrives */
  pendingRecord: string;
}

const UUID_TAIL = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

export function newCodexState(file: string): CodexFileState {
  const m = path.basename(file).match(UUID_TAIL);
  return { sessionId: m ? m[1] : path.basename(file, ".jsonl"), hasMeta: false, model: "", cwd: "", lastTotal: "", pendingRecord: "" };
}

export interface CodexParseContext {
  state: CodexFileState;
  /** shared with the Claude parser so keys are de-duplicated across every file */
  seen: Set<string>;
  warnings: ParseWarnings;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Stable string for a usage object, used to spot repeats and echoes. */
function usageKey(u: Record<string, unknown>): string {
  return [u.input_tokens, u.cached_input_tokens, u.cache_write_input_tokens, u.output_tokens, u.reasoning_output_tokens, u.total_tokens].map(num).join(",");
}

function toEvent(obj: Record<string, unknown>, u: Record<string, unknown>, key: string, ctx: CodexParseContext): UsageEvent | null {
  if (ctx.seen.has(key)) {
    ctx.warnings.duplicates++;
    return null;
  }
  const ts = Date.parse(obj.timestamp as string);
  if (!Number.isFinite(ts)) {
    ctx.warnings.malformedLines++;
    return null;
  }
  // input_tokens covers every prompt token; cached and cache-write tokens are
  // subsets of it. output_tokens already includes reasoning tokens.
  const prompt = num(u.input_tokens);
  const cacheRead = Math.min(num(u.cached_input_tokens), prompt);
  const cacheWrite = Math.min(num(u.cache_write_input_tokens), prompt - cacheRead);
  const input = prompt - cacheRead - cacheWrite;
  const output = num(u.output_tokens);
  if (input + output + cacheRead + cacheWrite === 0) return null;
  ctx.seen.add(key);
  const { state } = ctx;
  return {
    key,
    source: "codex",
    ts,
    model: state.model || "unknown",
    project: state.cwd ? projectKeyFromCwd(state.cwd) : "codex",
    projectLabel: state.cwd ? path.basename(state.cwd) || state.cwd : "codex",
    sessionId: state.sessionId,
    isSidechain: false,
    input,
    output,
    cacheWrite5m: cacheWrite,
    cacheWrite1h: 0,
    cacheRead,
  };
}

/**
 * Parse one rollout line. Returns a UsageEvent for a model response, or null.
 *
 * Usage comes from two line types:
 * - `token_usage_record` (Codex 0.145+): one per API response, keyed by its
 *   response_id. It is followed by a `token_count` echoing the same usage,
 *   which is then skipped.
 * - `event_msg` / `token_count`: `last_token_usage` is the latest response.
 *   Older Codex versions only write these. The same totals can be written
 *   again (resumes, rate-limit updates), so a repeated `total_token_usage` is
 *   dropped.
 */
export function parseCodexLine(line: string, ctx: CodexParseContext): UsageEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    ctx.warnings.malformedLines++;
    return null;
  }
  if (!isObj(obj)) {
    ctx.warnings.malformedLines++;
    return null;
  }
  const p = obj.payload;
  if (!isObj(p)) return null;
  const st = ctx.state;
  switch (obj.type) {
    case "session_meta":
      if (!st.hasMeta) {
        st.hasMeta = true;
        if (typeof p.id === "string" && p.id) st.sessionId = p.id;
        if (typeof p.cwd === "string" && p.cwd && !st.cwd) st.cwd = p.cwd;
      }
      return null;
    case "turn_context":
      if (typeof p.model === "string" && p.model) st.model = p.model;
      if (typeof p.cwd === "string" && p.cwd) st.cwd = p.cwd;
      return null;
    case "token_usage_record": {
      if (!isObj(p.usage)) return null;
      const uk = usageKey(p.usage);
      st.pendingRecord = uk;
      const key = typeof p.response_id === "string" && p.response_id ? `codex:${p.response_id}` : `codex:${st.sessionId}:${obj.timestamp}:${uk}`;
      return toEvent(obj, p.usage, key, ctx);
    }
    case "event_msg": {
      if (p.type !== "token_count") return null;
      const info = p.info;
      // info is null on rate-limit-only updates
      if (!isObj(info) || !isObj(info.total_token_usage) || !isObj(info.last_token_usage)) return null;
      const total = usageKey(info.total_token_usage);
      const key = `codex:${st.sessionId}:${total}`;
      const repeat = total === st.lastTotal || ctx.seen.has(key);
      const echo = st.pendingRecord !== "" && st.pendingRecord === usageKey(info.last_token_usage);
      st.lastTotal = total;
      st.pendingRecord = "";
      if (repeat) {
        ctx.warnings.duplicates++;
        return null;
      }
      if (echo) {
        // already counted from its token_usage_record; remember the total so a replay is caught
        ctx.seen.add(key);
        return null;
      }
      return toEvent(obj, info.last_token_usage, key, ctx);
    }
    default:
      return null;
  }
}

// Only these line types matter; everything else (response items with content,
// world state, compaction history) is skipped without being parsed.
const USEFUL = /"(?:token_count|token_usage_record|turn_context|session_meta)"/;

/** Codex counterpart of parseFileIncremental: tail a rollout from `offset`. */
export function parseCodexFileIncremental(file: string, ctx: CodexParseContext, offset = 0, remainder = ""): IncrementalResult {
  const events: UsageEvent[] = [];
  const r = forEachNewLine(file, offset, remainder, (line) => {
    if (line.length && line.charCodeAt(0) === 123 /* { */ && !USEFUL.test(line)) return;
    const ev = parseCodexLine(line, ctx);
    if (ev) events.push(ev);
  });
  if (!r) return { events: [], offset, remainder };
  return { events, offset: r.offset, remainder: r.remainder };
}

/** Parse a whole rollout file from the beginning. */
export function parseCodexFile(file: string, ctx: CodexParseContext): UsageEvent[] {
  const r = parseCodexFileIncremental(file, ctx, 0, "");
  if (r.remainder.trim()) {
    const ev = parseCodexLine(r.remainder, ctx);
    if (ev) r.events.push(ev);
  }
  return r.events;
}
