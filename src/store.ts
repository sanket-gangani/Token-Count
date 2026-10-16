import fs from "node:fs";
import path from "node:path";
import { listJsonlFiles, projectKeyForFile } from "./discover.js";
import { newWarnings, parseFileIncremental, parseLine, type ParseContext } from "./parse.js";
import { configDir } from "./config.js";
import type { ParseWarnings, UsageEvent } from "./types.js";

interface FileState {
  offset: number;
  remainder: string;
  project: string;
  size: number;
  mtimeMs: number;
  events: UsageEvent[];
}

interface CacheFile {
  version: number;
  projectsDir: string;
  warnings?: ParseWarnings;
  files: Record<string, FileState>;
}

const CACHE_VERSION = 1;

/**
 * In-memory event store with global de-dupe and per-file offsets for live
 * tailing. Optionally persists per-file state to ~/.tokenburn/cache.json so
 * large histories load fast on the next start (only changed files are re-read).
 */
export class UsageStore {
  readonly warnings: ParseWarnings = newWarnings();
  private readonly seen = new Set<string>();
  private readonly files = new Map<string, FileState>();
  private flat: UsageEvent[] | null = null;
  private cacheTimer: NodeJS.Timeout | null = null;
  private cacheEnabled = false;

  constructor(readonly projectsDir: string, private readonly env: NodeJS.ProcessEnv = process.env) {}

  /** All events, sorted by timestamp. Memoized until the next change. */
  get events(): readonly UsageEvent[] {
    if (!this.flat) {
      const out: UsageEvent[] = [];
      for (const s of this.files.values()) out.push(...s.events);
      out.sort((a, b) => a.ts - b.ts);
      this.flat = out;
    }
    return this.flat;
  }

  get fileCount(): number {
    return this.files.size;
  }

  private ctxFor(project: string): ParseContext {
    return { project, seen: this.seen, warnings: this.warnings };
  }

  private cachePath(): string {
    return path.join(configDir(this.env), "cache.json");
  }

  /** Full scan of every .jsonl file. Returns count of files read. */
  loadAll(opts: { cache?: boolean } = {}): number {
    this.cacheEnabled = !!opts.cache;
    const files = listJsonlFiles(this.projectsDir);
    let cached: CacheFile | null = null;
    if (this.cacheEnabled) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.cachePath(), "utf8")) as CacheFile;
        if (raw.version === CACHE_VERSION && raw.projectsDir === this.projectsDir && raw.files) cached = raw;
      } catch {
        cached = null;
      }
    }
    if (cached?.warnings) Object.assign(this.warnings, cached.warnings);
    const toParse: string[] = [];
    // Reuse unchanged files first so their keys are in the de-dupe set before
    // anything else is parsed.
    for (const f of files) {
      const c = cached?.files[f];
      let st: fs.Stats;
      try {
        st = fs.statSync(f);
      } catch {
        continue;
      }
      if (c && c.size === st.size && c.mtimeMs === st.mtimeMs && Array.isArray(c.events)) {
        this.files.set(f, { ...c, events: c.events });
        for (const e of c.events) this.seen.add(e.key);
      } else toParse.push(f);
    }
    for (const f of toParse) this.loadFile(f);
    this.flat = null;
    if (this.cacheEnabled && (toParse.length || !cached)) this.saveCache();
    return files.length;
  }

  /** Load or re-tail a single file. Returns the newly added events. */
  loadFile(file: string): UsageEvent[] {
    const project = projectKeyForFile(this.projectsDir, file);
    let state = this.files.get(file);
    if (!state) {
      state = { offset: 0, remainder: "", project, size: 0, mtimeMs: 0, events: [] };
      this.files.set(file, state);
    }
    const ctx = this.ctxFor(project);
    const r = parseFileIncremental(file, ctx, state.offset, state.remainder);
    if (r.offset < state.offset) {
      // file was truncated and re-read from 0: drop its old events
      for (const e of state.events) this.seen.delete(e.key);
      state.events = [];
    }
    state.offset = r.offset;
    state.remainder = r.remainder;
    const added = r.events;
    // A trailing line with no newline may still be complete (file written without
    // a final "\n"). Only consume it when it is valid JSON; otherwise keep waiting.
    const tail = state.remainder.trim();
    if (tail) {
      let complete = false;
      try {
        JSON.parse(tail);
        complete = true;
      } catch {
        /* still being written */
      }
      if (complete) {
        const ev = parseLine(tail, ctx);
        if (ev) added.push(ev);
        state.remainder = "";
      }
    }
    try {
      const st = fs.statSync(file);
      state.size = st.size;
      state.mtimeMs = st.mtimeMs;
    } catch {
      /* file vanished between read and stat */
    }
    if (added.length) {
      state.events.push(...added);
      this.flat = null;
    }
    return added;
  }

  saveCache(): void {
    if (!this.cacheEnabled) return;
    try {
      const dir = configDir(this.env);
      fs.mkdirSync(dir, { recursive: true });
      const body: CacheFile = { version: CACHE_VERSION, projectsDir: this.projectsDir, warnings: this.warnings, files: Object.fromEntries(this.files) };
      const tmp = this.cachePath() + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(body));
      fs.renameSync(tmp, this.cachePath());
    } catch {
      /* cache is best-effort */
    }
  }

  /** Debounced cache write for live mode. */
  saveCacheSoon(delayMs = 5000): void {
    if (!this.cacheEnabled) return;
    if (this.cacheTimer) clearTimeout(this.cacheTimer);
    this.cacheTimer = setTimeout(() => {
      this.cacheTimer = null;
      this.saveCache();
    }, delayMs);
    this.cacheTimer.unref();
  }
}
