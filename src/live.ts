import { tokenTotals } from "./aggregate.js";
import { costOf } from "./cost.js";
import { footprintOf, type FootprintConfig } from "./footprint.js";
import type { UsageEvent } from "./types.js";

/** All-time totals plus the last hour, as pushed over SSE. `events` must be sorted by ts. */
export function liveSnapshot(all: readonly UsageEvent[], footprint: FootprintConfig, now = Date.now()) {
  const t = tokenTotals(all);
  const c = costOf(all);
  // events are sorted by ts, so walk back from the end for the last hour
  const hourAgo = now - 3_600_000;
  let i = all.length;
  while (i > 0 && all[i - 1].ts >= hourAgo) i--;
  const recent = all.slice(i);
  const lt = tokenTotals(recent);
  const lc = costOf(recent);
  return {
    totals: { ...t, usd: c.usd, unknownTokens: c.unknownTokens, requests: all.length },
    footprint: footprintOf(t, footprint),
    lastHour: { total: lt.total, output: lt.output, usd: lc.usd, requests: recent.length },
    lastEventTs: all.length ? all[all.length - 1].ts : null,
  };
}
