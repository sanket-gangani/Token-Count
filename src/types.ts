/** Which coding agent wrote the log. */
export type Source = "claude" | "codex";

/** One de-duplicated API response with its token usage. Never holds message content. */
export interface UsageEvent {
  /** Claude: `${messageId}:${requestId}`. Codex: `codex:...` (see src/codex.ts) */
  key: string;
  source: Source;
  /** epoch milliseconds */
  ts: number;
  model: string;
  /** stable project key: Claude's folder name under projects/ (cwd with non-alphanumerics as "-") */
  project: string;
  /** human label: basename(cwd) when known */
  projectLabel: string;
  sessionId: string;
  isSidechain: boolean;
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

export interface ParseWarnings {
  malformedLines: number;
  skippedSynthetic: number;
  duplicates: number;
}

export type TokenKind = "input" | "output" | "cacheWrite" | "cacheRead";

export interface TokenTotals {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  total: number;
}

export interface CostTotals {
  /** USD, API-equivalent, for events whose model has a known price */
  usd: number;
  /** tokens that could not be priced */
  unknownTokens: number;
  unknownModels: string[];
}

export interface Bucket extends TokenTotals {
  key: string;
  usd: number;
  unknownTokens: number;
  requests: number;
}

export interface SessionSummary extends TokenTotals {
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
