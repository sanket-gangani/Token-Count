import fs from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { ParseWarnings, UsageEvent } from "./types.js";
import { labelFromProjectKey } from "./discover.js";

export interface ParseContext {
  project: string;
  /** shared across files so duplicates across files are dropped */
  seen: Set<string>;
  warnings: ParseWarnings;
}

export function newWarnings(): ParseWarnings {
  return { malformedLines: 0, skippedSynthetic: 0, duplicates: 0 };
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Parse a single JSONL line into a UsageEvent, or null when the line carries no
 * usage (non-assistant lines), is a duplicate, or is malformed.
 * Only usage/model/timestamp/id fields are read; message content is never touched.
 */
export function parseLine(line: string, ctx: ParseContext): UsageEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let obj: any;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    ctx.warnings.malformedLines++;
    return null;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    ctx.warnings.malformedLines++;
    return null;
  }
  if (obj.type !== "assistant") return null;
  const msg = obj.message;
  if (!msg || typeof msg !== "object") return null;
  const usage = msg.usage;
  if (!usage || typeof usage !== "object") return null;

  const model = typeof msg.model === "string" ? msg.model : "unknown";
  if (model === "<synthetic>") {
    ctx.warnings.skippedSynthetic++;
    return null;
  }

  const messageId = typeof msg.id === "string" ? msg.id : "";
  const requestId = typeof obj.requestId === "string" ? obj.requestId : "";
  // Fall back to the line uuid only when both ids are missing (very old logs).
  const key = messageId || requestId ? `${messageId}:${requestId}` : `uuid:${obj.uuid ?? ""}`;
  if (ctx.seen.has(key)) {
    ctx.warnings.duplicates++;
    return null;
  }

  const ts = Date.parse(obj.timestamp);
  if (!Number.isFinite(ts)) {
    ctx.warnings.malformedLines++;
    return null;
  }

  const input = num(usage.input_tokens);
  const output = num(usage.output_tokens);
  const cacheRead = num(usage.cache_read_input_tokens);
  const cacheWriteTotal = num(usage.cache_creation_input_tokens);
  const cc = usage.cache_creation;
  let cacheWrite5m: number;
  let cacheWrite1h: number;
  if (cc && typeof cc === "object") {
    cacheWrite5m = num(cc.ephemeral_5m_input_tokens);
    cacheWrite1h = num(cc.ephemeral_1h_input_tokens);
    // Guard against breakdown not summing to the total (older/partial entries).
    const diff = cacheWriteTotal - (cacheWrite5m + cacheWrite1h);
    if (diff > 0) cacheWrite5m += diff;
  } else {
    cacheWrite5m = cacheWriteTotal;
    cacheWrite1h = 0;
  }

  if (input + output + cacheRead + cacheWrite5m + cacheWrite1h === 0) return null;

  ctx.seen.add(key);
  const cwd = typeof obj.cwd === "string" ? obj.cwd : "";
  return {
    key,
    source: "claude",
    ts,
    model,
    project: ctx.project,
    projectLabel: cwd ? path.basename(cwd) || cwd : labelFromProjectKey(ctx.project),
    sessionId: typeof obj.sessionId === "string" ? obj.sessionId : "unknown",
    isSidechain: obj.isSidechain === true,
    input,
    output,
    cacheWrite5m,
    cacheWrite1h,
    cacheRead,
  };
}

export interface IncrementalResult {
  events: UsageEvent[];
  /** byte offset after the last complete line */
  offset: number;
  /** trailing partial line, to be prepended next time */
  remainder: string;
}

const CHUNK_BYTES = 16 * 1024 * 1024;

/**
 * Read a file from `offset` and call `onLine` for each complete line. The
 * trailing partial line comes back as `remainder` so live writes that land
 * mid-line are handled. Reads in chunks, so files bigger than the largest
 * possible JS string (Codex rollouts reach hundreds of MB) are fine.
 * Returns null when the file cannot be opened.
 */
export function forEachNewLine(
  file: string,
  offset: number,
  remainder: string,
  onLine: (line: string) => void,
  chunkBytes = CHUNK_BYTES,
): { offset: number; remainder: string } | null {
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return null;
  }
  try {
    const size = fs.fstatSync(fd).size;
    if (size < offset) {
      // truncated / rewritten: start over
      offset = 0;
      remainder = "";
    }
    if (size <= offset) return { offset, remainder };
    const buf = Buffer.alloc(Math.min(chunkBytes, size - offset));
    const decoder = new StringDecoder("utf8");
    let carry = remainder;
    let pos = offset;
    while (pos < size) {
      const n = fs.readSync(fd, buf, 0, Math.min(buf.length, size - pos), pos);
      if (n <= 0) break;
      pos += n;
      const text = carry + decoder.write(buf.subarray(0, n));
      let start = 0;
      let nl: number;
      while ((nl = text.indexOf("\n", start)) !== -1) {
        onLine(text.slice(start, nl));
        start = nl + 1;
      }
      carry = text.slice(start);
    }
    return { offset: pos, remainder: carry + decoder.end() };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Read a file from `offset`, parse complete lines, return new events and the
 * new offset. Partial trailing lines are kept in `remainder` so live writes
 * that land mid-line are handled.
 */
export function parseFileIncremental(
  file: string,
  ctx: ParseContext,
  offset = 0,
  remainder = "",
): IncrementalResult {
  const events: UsageEvent[] = [];
  const r = forEachNewLine(file, offset, remainder, (line) => {
    // Cheap pre-filter: only assistant lines carry usage. Avoids JSON.parse on
    // huge tool-result lines. Lines that are not JSON objects still get counted
    // as malformed below when they slip through.
    if (line.length && !line.includes('"assistant"') && line.charCodeAt(0) === 123 /* { */) return;
    const ev = parseLine(line, ctx);
    if (ev) events.push(ev);
  });
  if (!r) return { events: [], offset, remainder };
  return { events, offset: r.offset, remainder: r.remainder };
}

/** Parse a whole file from the beginning. */
export function parseFile(file: string, ctx: ParseContext): UsageEvent[] {
  const r = parseFileIncremental(file, ctx, 0, "");
  // A final line without a trailing newline is still a complete line once EOF is reached.
  if (r.remainder.trim()) {
    const ev = parseLine(r.remainder, ctx);
    if (ev) r.events.push(ev);
  }
  return r.events;
}
