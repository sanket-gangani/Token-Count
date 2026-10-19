import type { Bucket, Source } from "../api";
import { CountUp } from "./Motion";

const LABEL: Record<Source, string> = { claude: "Claude Code", codex: "Codex" };
const ORDER: Source[] = ["claude", "codex"];

/** Claude Code and Codex side by side: one hairline split by tokens. Click a side to show only that tool. */
export function SourceSplit({ rows, onPick }: { rows: Bucket[]; onPick: (s: Source) => void }) {
  const total = rows.reduce((a, r) => a + r.total, 0);
  const sides = ORDER.map((k) => rows.find((r) => r.key === k)).filter((r): r is Bucket => !!r && r.total > 0);
  if (sides.length < 2 || !total) return null;
  return (
    <div className="source-split">
      <div className="source-split-bar" aria-hidden="true">
        {sides.map((r) => (
          <i key={r.key} className={r.key} style={{ width: `${(r.total / total) * 100}%` }} />
        ))}
      </div>
      <div className="source-split-legend">
        {sides.map((r) => {
          const key = r.key as Source;
          return (
            <button key={key} className={"source-split-item " + key} onClick={() => onPick(key)} title={`Show only ${LABEL[key]}`}>
              <span className="k">
                <i />
                {LABEL[key]}
                <em>{Math.round((r.total / total) * 100)}%</em>
              </span>
              <span className="v">
                <CountUp value={r.total} /> <span className="c">· <CountUp value={r.usd} kind="usd" /></span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
