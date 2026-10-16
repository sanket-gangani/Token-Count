import { useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Bucket, Summary } from "../api";
import { fmtTokens, fmtUSD } from "../../../src/format";
import { CountUp } from "./Motion";
import { useInView } from "../fx/motion";

export const KINDS = [
  { key: "output", label: "Output", color: "var(--s-output)", desc: "What the model wrote" },
  { key: "input", label: "Input", color: "var(--s-input)", desc: "Fresh, uncached prompt tokens" },
  { key: "cacheWrite", label: "Cache write", color: "var(--s-cachew)", desc: "Storing context for reuse" },
  { key: "cacheRead", label: "Cache read", color: "var(--s-cacher)", desc: "Re-reading the conversation each turn" },
] as const;

const dayLabel = (k: string) => new Date(k + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
const axisTick = { fill: "var(--ink-3)", fontSize: 11, fontFamily: "var(--mono)" };

/* ---------- daily burn ---------- */
function DailyTip({ active, payload, metric, withCache }: any) {
  if (!active || !payload?.length) return null;
  const b: Bucket = payload[0].payload;
  const kinds = KINDS.filter((k) => withCache || k.key !== "cacheRead");
  return (
    <div className="tip">
      <div className="t">{dayLabel(b.key)}</div>
      <div className="r">
        <span>{metric === "usd" ? "API-eq" : "tokens"}</span>
        <b>{metric === "usd" ? fmtUSD(b.usd) : fmtTokens(withCache ? b.total : b.total - b.cacheRead)}</b>
      </div>
      <div className="sep" />
      {kinds.map((k) => (
        <div className="r" key={k.key}>
          <span>
            <i style={{ background: k.color }} />
            {k.label.toLowerCase()}
          </span>
          <b>{fmtTokens(b[k.key])}</b>
        </div>
      ))}
      <div className="sep" />
      <div className="r">
        <span>requests</span>
        <b>{b.requests.toLocaleString()}</b>
      </div>
    </div>
  );
}

export function DailyBurn({ days }: { days: Bucket[] }) {
  const [metric, setMetric] = useState<"tokens" | "usd">("tokens");
  const [withCache, setWithCache] = useState(true);
  const data = useMemo(() => days.map((d) => ({ ...d, v: metric === "usd" ? d.usd : withCache ? d.total : d.total - d.cacheRead })), [days, metric, withCache]);
  const active = data.filter((d) => d.v > 0);
  const avg = active.length ? active.reduce((a, d) => a + d.v, 0) / active.length : 0;
  const peak = data.reduce<(typeof data)[number] | null>((p, d) => (!p || d.v > p.v ? d : p), null);
  const fmt = metric === "usd" ? fmtUSD : fmtTokens;
  const [ref, inView] = useInView<HTMLDivElement>({ threshold: 0.3 });
  return (
    <div>
      <div className="chart-head">
        <p className="lead">
          {peak && peak.v > 0 ? (
            <>
              Hottest day was <b>{dayLabel(peak.key)}</b> at <b>{fmt(peak.v)}</b>. On days you showed up, you averaged <b>{fmt(avg)}</b>.
            </>
          ) : (
            "No usage in this range yet."
          )}
        </p>
        <div className="head-tools">
          {metric === "tokens" && (
            <label className="toggle">
              <input type="checkbox" checked={withCache} onChange={(e) => setWithCache(e.target.checked)} />
              <span className="sw" />
              include cache reads
            </label>
          )}
          <div className="seg sm">
            <button className={metric === "tokens" ? "active" : ""} onClick={() => setMetric("tokens")}>
              tokens
            </button>
            <button className={metric === "usd" ? "active" : ""} onClick={() => setMetric("usd")}>
              dollars
            </button>
          </div>
        </div>
      </div>
      <div className="chart" ref={ref}>
        {days.length ? (
          <ResponsiveContainer>
            <AreaChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="burn-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="var(--ember)" stopOpacity={0.28} />
                  <stop offset="1" stopColor="var(--ember)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="key" tickFormatter={dayLabel} tick={axisTick} axisLine={false} tickLine={false} minTickGap={44} interval="preserveStartEnd" />
              <YAxis tickFormatter={(v) => (metric === "usd" ? "$" + Math.round(v) : fmtTokens(v).replace(/\.0(?=[A-Z])/, ""))} tick={axisTick} axisLine={false} tickLine={false} width={40} tickCount={3} />
              <Tooltip content={<DailyTip metric={metric} withCache={withCache} />} cursor={{ stroke: "var(--hair-2)" }} />
              {avg > 0 && <ReferenceLine y={avg} stroke="var(--ink-3)" strokeDasharray="3 5" label={{ value: "avg", position: "left", dx: 32, fill: "var(--ink-3)", fontSize: 10, fontFamily: "var(--mono)" }} />}
              <Area key={inView ? "live" : "idle"} type="linear" dataKey="v" stroke="var(--ember)" strokeWidth={1.2} fill="url(#burn-fill)" isAnimationActive={inView} animationDuration={1600} animationBegin={120} animationEasing="ease-in-out" dot={false} activeDot={{ r: 4, fill: "var(--ember)", stroke: "var(--bg)", strokeWidth: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="empty">No usage in this range.</div>
        )}
      </div>
    </div>
  );
}

/* ---------- where the money went ---------- */
export function MoneySplit({ s }: { s: Summary }) {
  const [ref, inView] = useInView<HTMLDivElement>({ threshold: 0.4 });
  const k = s.costByKind;
  const total = k.input + k.output + k.cacheWrite + k.cacheRead;
  const rows = KINDS.map((x) => ({ ...x, usd: k[x.key], tokens: s.totals[x.key] }));
  return (
    <div>
      <div className="block-head">
        <h3 className="block-title">Where the money went</h3>
        <p className="block-sub">API-equivalent cost by token type.</p>
      </div>
      {total > 0 ? (
        <>
          <div className="split" role="img" aria-label="Share of cost by token type" ref={ref}>
            {rows.map((r) => (
              <i key={r.key} style={{ width: inView ? `${(r.usd / total) * 100}%` : "0%", background: r.color }} title={`${r.label}: ${fmtUSD(r.usd)}`} />
            ))}
          </div>
          <div className="split-list">
            {rows.map((r) => (
              <div className="split-row" key={r.key}>
                <span className="sw" style={{ background: r.color }} />
                <div>
                  <div className="name">{r.label}</div>
                  <div className="desc">
                    {fmtTokens(r.tokens)} tokens · {r.desc}
                  </div>
                </div>
                <div className="usd">
                  <CountUp value={r.usd} kind="usd" />
                </div>
                <div className="pct">{Math.round((r.usd / total) * 100)}%</div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="empty">No priced usage in this range.</div>
      )}
    </div>
  );
}

/* ---------- when you burn ---------- */
const hourLabel = (h: number) => (h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`);
const hourLong = (h: number) => {
  const f = (x: number) => (x % 24 === 0 ? "12 am" : x % 24 < 12 ? `${x % 24} am` : x % 24 === 12 ? "12 pm" : `${(x % 24) - 12} pm`);
  return `${f(h)} – ${f(h + 1)}`;
};

export function HourOfDay({ hours }: { hours: Bucket[] }) {
  const data = hours.map((h) => ({ ...h, hour: Number(h.key) }));
  const peak = data.reduce((p, d) => (d.total > p.total ? d : p), data[0]);
  const any = data.some((d) => d.total > 0);
  const [ref, inView] = useInView<HTMLDivElement>({ threshold: 0.3 });
  const peakIndex = data.indexOf(peak);
  return (
    <div>
      <div className="block-head">
        <h3 className="block-title">When you burn</h3>
        <p className="block-sub">{any ? `Tokens by hour of day, local time. Your peak hour is ${hourLong(peak.hour)}.` : "No usage in this range yet."}</p>
      </div>
      <div className="chart sm" ref={ref}>
        {any ? (
          <ResponsiveContainer>
            <BarChart data={data} margin={{ top: 22, right: 8, left: 0, bottom: 0 }} barCategoryGap={1}>
              <XAxis dataKey="hour" tickFormatter={hourLabel} ticks={[0, 6, 12, 18, 23]} tick={axisTick} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ fill: "var(--grid)" }}
                content={({ active, payload }: any) =>
                  active && payload?.length ? (
                    <div className="tip">
                      <div className="t">{hourLong(payload[0].payload.hour)}</div>
                      <div className="r">
                        <span>tokens</span>
                        <b>{fmtTokens(payload[0].payload.total)}</b>
                      </div>
                      <div className="r">
                        <span>API-eq</span>
                        <b>{fmtUSD(payload[0].payload.usd)}</b>
                      </div>
                      <div className="r">
                        <span>requests</span>
                        <b>{payload[0].payload.requests.toLocaleString()}</b>
                      </div>
                    </div>
                  ) : null
                }
              />
              <Bar key={inView ? "live" : "idle"} dataKey="total" radius={0} isAnimationActive={inView} animationDuration={900} animationBegin={80} animationEasing="ease-out">
                {data.map((d) => (
                  <Cell key={d.hour} fill={d.hour === peak.hour ? "var(--ember)" : "var(--ember-a)"} stroke="none" />
                ))}
                <LabelList
                  dataKey="total"
                  content={({ x, y, width, value, index }: any) =>
                    index === peakIndex ? (
                      <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={11} fontFamily="var(--mono)" fill="var(--ink)">
                        {fmtTokens(value)}
                      </text>
                    ) : null
                  }
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="empty">Nothing yet.</div>
        )}
      </div>
    </div>
  );
}

/* ---------- ranked list ---------- */
export function Ranked({ title, rows, max = 7 }: { title: string; rows: { key: string; label: string; total: number; usd: number; unknownTokens: number }[]; max?: number }) {
  const top = rows.slice(0, max);
  const rest = rows.slice(max);
  const other = rest.length
    ? { key: "__other", label: `${rest.length} more`, total: rest.reduce((a, r) => a + r.total, 0), usd: rest.reduce((a, r) => a + r.usd, 0), unknownTokens: rest.reduce((a, r) => a + r.unknownTokens, 0) }
    : null;
  const list = other ? [...top, other] : top;
  const peak = Math.max(1, ...top.map((r) => r.total));
  const [ref, inView] = useInView<HTMLDivElement>({ threshold: 0.3 });
  return (
    <div>
      <div className="block-head">
        <h3 className="block-title">{title}</h3>
      </div>
      <div className="ranks" ref={ref}>
        {list.length ? (
          list.map((r, i) => {
            const unknown = r.unknownTokens > 0 && r.usd === 0;
            return (
              <div className={"rank" + (r.key === "__other" ? " other" : "")} key={r.key} title={r.label}>
                <div className="idx">{r.key === "__other" ? "+" : String(i + 1).padStart(2, "0")}</div>
                <div className="name">{r.label}</div>
                <div className="v">
                  <CountUp value={r.total} />
                </div>
                <div className={"c" + (unknown ? " unk" : "")}>{unknown ? "unknown" : <CountUp value={r.usd} kind="usd" />}</div>
                <div className="track">
                  <i style={{ width: inView ? `${Math.min(100, (r.total / peak) * 100)}%` : "0%" }} />
                </div>
              </div>
            );
          })
        ) : (
          <div className="empty">Nothing here yet.</div>
        )}
      </div>
    </div>
  );
}
