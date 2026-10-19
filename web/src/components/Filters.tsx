import { useEffect, useRef, useState } from "react";
import type { Filters, Meta, Source } from "../api";
import { fmtTokens } from "../../../src/format";

export type RangePreset = "7d" | "30d" | "90d" | "all" | "custom";

function MultiSelect({ label, options, value, onChange }: { label: string; options: { key: string; label: string; total: number }[]; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
    };
  }, [open]);
  const toggle = (k: string) => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k]);
  return (
    <div className={"dd" + (open ? " open" : "")} ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {label}
        {value.length > 0 && <span className="count">{value.length}</span>}
        <span aria-hidden="true">+</span>
      </button>
      {open && (
        <div className="menu">
          <div className="tools">
            <button onClick={() => onChange([])}>Clear</button>
            <button onClick={() => onChange(options.map((o) => o.key))}>All</button>
          </div>
          {options.map((o) => (
            <label key={o.key}>
              <input type="checkbox" checked={value.includes(o.key)} onChange={() => toggle(o.key)} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
              <span className="n">{fmtTokens(o.total)}</span>
            </label>
          ))}
          {!options.length && <div className="empty" style={{ height: 50 }}>none</div>}
        </div>
      )}
    </div>
  );
}

const DAY = 86_400_000;
export function presetRange(p: RangePreset, now = Date.now()): { from?: number; to?: number } {
  if (p === "all" || p === "custom") return {};
  const n = p === "7d" ? 7 : p === "30d" ? 30 : 90;
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return { from: d.getTime() - (n - 1) * DAY };
}

const toInput = (ts?: number) => (ts ? new Date(ts).toISOString().slice(0, 10) : "");

export function FilterBar({ meta, filters, preset, onPreset, onChange }: { meta: Meta | null; filters: Filters; preset: RangePreset; onPreset: (p: RangePreset) => void; onChange: (f: Filters) => void }) {
  const active = filters.projects.length + filters.models.length + filters.sources.length > 0 || preset !== "all";
  // Only worth a control once both Claude Code and Codex have usage.
  const sources = meta?.sources ?? [];
  return (
    <div className="filters">
      <div className="seg">
        {(["7d", "30d", "90d", "all"] as RangePreset[]).map((p) => (
          <button key={p} className={preset === p ? "active" : ""} onClick={() => onPreset(p)}>
            <span className="lg-label">{p === "all" ? "All time" : p.replace("d", " days")}</span>
            <span className="sm-label">{p === "all" ? "All" : p}</span>
          </button>
        ))}
        <button className={preset === "custom" ? "active" : ""} onClick={() => onPreset("custom")}>
          Custom
        </button>
      </div>
      {preset === "custom" && (
        <div className="dateinputs">
          <input type="date" value={toInput(filters.from)} onChange={(e) => onChange({ ...filters, from: e.target.value ? new Date(e.target.value + "T00:00").getTime() : undefined })} />
          <span style={{ color: "var(--muted)" }}>to</span>
          <input type="date" value={toInput(filters.to ? filters.to - 1 : undefined)} onChange={(e) => onChange({ ...filters, to: e.target.value ? new Date(e.target.value + "T00:00").getTime() + DAY : undefined })} />
        </div>
      )}
      <MultiSelect label="Projects" options={meta?.projects ?? []} value={filters.projects} onChange={(v) => onChange({ ...filters, projects: v })} />
      <MultiSelect label="Models" options={meta?.models ?? []} value={filters.models} onChange={(v) => onChange({ ...filters, models: v })} />
      {sources.length > 1 && <MultiSelect label="Sources" options={sources} value={filters.sources} onChange={(v) => onChange({ ...filters, sources: v as Source[] })} />}
      {active && (
        <button
          className="reset"
          onClick={() => {
            onPreset("all");
            onChange({ projects: [], models: [], sources: [] });
          }}
        >
          Reset
        </button>
      )}
    </div>
  );
}
