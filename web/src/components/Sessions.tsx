import { useState } from "react";
import type { SessionSummary } from "../api";
import { fmtDuration, fmtTokens, fmtUSD } from "../../../src/format";
import { modelLabel } from "../../../src/models";
import { useMounted } from "./Motion";

const when = (ts: number) => {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ", " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
};

export function Sessions({ rows, freshSince }: { rows: SessionSummary[]; freshSince: number | null }) {
  const [limit, setLimit] = useState(12);
  const shown = rows.slice(0, limit);
  const peak = Math.max(1, ...rows.map((r) => r.total));
  const mounted = useMounted(700);
  return (
    <div className="table-scroll">
      <table className="sessions">
        <thead>
          <tr>
            <th>Project</th>
            <th>Model</th>
            <th className="hide-sm">Last active</th>
            <th className="r hide-sm">Duration</th>
            <th className="r hide-sm">Requests</th>
            <th className="r">Tokens</th>
            <th className="r">API-eq</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((s) => (
            <tr key={s.sessionId} className={freshSince && s.end >= freshSince ? "fresh" : ""}>
              <td className="proj" title={s.projectLabel}>
                {s.projectLabel}
              </td>
              <td>
                <span className="chip">
                  <i />
                  {modelLabel(s.model)}
                  {s.models.length > 1 && <span style={{ color: "var(--ink-3)" }}>+{s.models.length - 1}</span>}
                </span>
              </td>
              <td className="when hide-sm">{when(s.end)}</td>
              <td className="r hide-sm">{fmtDuration(s.durationMs)}</td>
              <td className="r hide-sm">{s.requests.toLocaleString()}</td>
              <td className="r">
                <div className="tok">
                  <span className="mini hide-sm">
                    <i style={{ width: mounted ? `${(s.total / peak) * 100}%` : "0%" }} />
                  </span>
                  {fmtTokens(s.total)}
                </div>
              </td>
              <td className="r">{s.unknownTokens > 0 && s.usd === 0 ? <span style={{ color: "var(--ink-3)" }}>unknown</span> : fmtUSD(s.usd)}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={7}>
                <div className="empty">No sessions in this range.</div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {rows.length > limit && (
        <div className="more">
          <button onClick={() => setLimit((l) => l + 12)}>More sessions</button>
        </div>
      )}
    </div>
  );
}
