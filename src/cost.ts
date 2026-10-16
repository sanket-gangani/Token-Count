import pricingJson from "./pricing.json" with { type: "json" };
import type { CostTotals, UsageEvent } from "./types.js";
import { normalizeModel, modelLabel } from "./models.js";
export { normalizeModel, modelLabel };

export interface PriceEntry {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  longContext?: PriceEntry & { thresholdInputTokens: number };
}

export interface PricingTable {
  source: string;
  checked: string;
  models: Record<string, PriceEntry>;
}

export const pricing: PricingTable = pricingJson as unknown as PricingTable;

export function priceFor(model: string): PriceEntry | null {
  return pricing.models[normalizeModel(model)] ?? null;
}

export interface KindCost {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

/**
 * API-equivalent USD per token kind for one event, plus what cache reads saved
 * versus paying the full input price. Null when the model is not in the table.
 */
export function costBreakdownOfEvent(ev: UsageEvent, table: PricingTable = pricing): (KindCost & { cacheSavings: number }) | null {
  let p = table.models[normalizeModel(ev.model)];
  if (!p) return null;
  if (p.longContext) {
    const promptTokens = ev.input + ev.cacheRead + ev.cacheWrite5m + ev.cacheWrite1h;
    if (promptTokens > p.longContext.thresholdInputTokens) p = p.longContext;
  }
  return {
    input: (ev.input * p.input) / 1_000_000,
    output: (ev.output * p.output) / 1_000_000,
    cacheWrite: (ev.cacheWrite5m * p.cacheWrite5m + ev.cacheWrite1h * p.cacheWrite1h) / 1_000_000,
    cacheRead: (ev.cacheRead * p.cacheRead) / 1_000_000,
    cacheSavings: (ev.cacheRead * Math.max(0, p.input - p.cacheRead)) / 1_000_000,
  };
}

/** API-equivalent USD for one event, or null when the model is not in the table. */
export function costOfEvent(ev: UsageEvent, table: PricingTable = pricing): number | null {
  const b = costBreakdownOfEvent(ev, table);
  return b === null ? null : b.input + b.output + b.cacheWrite + b.cacheRead;
}

export function costOf(events: Iterable<UsageEvent>, table: PricingTable = pricing): CostTotals {
  let usd = 0;
  let unknownTokens = 0;
  const unknown = new Set<string>();
  for (const ev of events) {
    const c = costOfEvent(ev, table);
    if (c === null) {
      unknownTokens += ev.input + ev.output + ev.cacheWrite5m + ev.cacheWrite1h + ev.cacheRead;
      unknown.add(ev.model);
    } else usd += c;
  }
  return { usd, unknownTokens, unknownModels: [...unknown].sort() };
}
