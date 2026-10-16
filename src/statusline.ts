import fs from "node:fs";
import { listJsonlFiles, projectKeyForFile } from "./discover.js";
import { newWarnings, parseFile } from "./parse.js";
import { startOfDay, tokenTotals, filterEvents } from "./aggregate.js";
import { costOf } from "./cost.js";
import { footprintOf } from "./footprint.js";
import { loadConfig } from "./config.js";
import { fmtTokens, fmtUSD } from "./format.js";
import type { UsageEvent } from "./types.js";

/**
 * Fast one-line summary for Claude Code's custom status line.
 * Only files modified since local midnight are read (plus the current
 * session's file when a session_id arrives on stdin), so this stays quick
 * even with gigabytes of history.
 */
export function statusLine(projectsDir: string, stdinJson: string | null, now = Date.now()): string {
  let sessionId: string | null = null;
  if (stdinJson) {
    try {
      const o = JSON.parse(stdinJson);
      sessionId = typeof o?.session_id === "string" ? o.session_id : null;
    } catch {
      /* ignore */
    }
  }
  const dayStart = startOfDay(now);
  const seen = new Set<string>();
  const warnings = newWarnings();
  const events: UsageEvent[] = [];
  for (const f of listJsonlFiles(projectsDir)) {
    let st: fs.Stats;
    try {
      st = fs.statSync(f);
    } catch {
      continue;
    }
    const isSession = sessionId !== null && f.includes(sessionId);
    if (st.mtimeMs < dayStart && !isSession) continue;
    events.push(...parseFile(f, { project: projectKeyForFile(projectsDir, f), seen, warnings }));
  }
  const cfg = loadConfig();
  const today = filterEvents(events, { from: dayStart });
  const t = tokenTotals(today);
  const cost = costOf(today);
  const fp = footprintOf(t, cfg.footprint);
  const parts = [`🔥 ${fmtTokens(t.total)} today`, `${fmtUSD(cost.usd)} api-eq`, fp.water.text.replace("≈ ", "≈")];
  if (sessionId) {
    const sess = events.filter((e) => e.sessionId === sessionId);
    if (sess.length) {
      const ts = tokenTotals(sess);
      parts.unshift(`${fmtTokens(ts.total)} session`);
    }
  }
  return parts.join(" · ");
}
