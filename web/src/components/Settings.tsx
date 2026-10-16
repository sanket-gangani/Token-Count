import { useEffect, useState } from "react";
import type { FootprintConfig, Meta } from "../api";
import { DEMO, saveConfig } from "../api";

const DEFAULTS: FootprintConfig = { whPerMillionOutputTokens: 600, tokenWeights: { input: 0.1, output: 1, cacheWrite: 0.1, cacheRead: 0.01 }, litersPerKWh: 2 };

export function SettingsDrawer({ meta, onClose, onSaved }: { meta: Meta | null; onClose: () => void; onSaved: () => void }) {
  const [cfg, setCfg] = useState<FootprintConfig>(meta?.config.footprint ?? DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  const num = (v: string) => (v === "" ? 0 : Math.max(0, Number(v)));
  const save = async (c: FootprintConfig) => {
    setBusy(true);
    setErr(null);
    try {
      await saveConfig({ footprint: c });
      onSaved();
      onClose();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="drawer-bg" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Estimate settings">
        <button className="iconbtn close" onClick={onClose} aria-label="Close settings">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
        <h2>How the lake is calculated</h2>
        <p>
          There is no official per-token energy or water figure from Anthropic. TokenBurn multiplies your tokens by third-party estimates below. Treat the result as satire with a
          footnote, not a measurement. Edit the factors if you have better numbers. {DEMO ? "In this demo, changes last until you reload." : <>Saved to <code>~/.tokenburn/config.json</code>.</>}
        </p>
        <div className="field">
          <label>Wh per million output tokens</label>
          <input type="number" step="1" value={cfg.whPerMillionOutputTokens} onChange={(e) => setCfg({ ...cfg, whPerMillionOutputTokens: num(e.target.value) })} />
          <div className="d">Energy for generated tokens. Other kinds are scaled by the weights below.</div>
        </div>
        <div className="field">
          <label>Token weights (relative to an output token)</label>
          <div className="weights">
            {(["input", "output", "cacheWrite", "cacheRead"] as const).map((k) => (
              <div key={k}>
                <div className="d" style={{ marginBottom: 4 }}>
                  {k === "cacheWrite" ? "cache write" : k === "cacheRead" ? "cache read" : k}
                </div>
                <input type="number" step="0.01" value={cfg.tokenWeights[k]} onChange={(e) => setCfg({ ...cfg, tokenWeights: { ...cfg.tokenWeights, [k]: num(e.target.value) } })} style={{ width: "100%" }} />
              </div>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Liters of water per kWh</label>
          <input type="number" step="0.1" value={cfg.litersPerKWh} onChange={(e) => setCfg({ ...cfg, litersPerKWh: num(e.target.value) })} />
          <div className="d">On-site cooling plus a share of power-generation water.</div>
        </div>
        {err && <div className="err">{err}</div>}
        <div className="btnrow">
          <button className="btn primary" disabled={busy} onClick={() => save(cfg)}>
            Save
          </button>
          <button className="btn" disabled={busy} onClick={() => setCfg(DEFAULTS)}>
            Reset to defaults
          </button>
        </div>
        <h3>Sources</h3>
        <ul className="sources">
          {(meta?.footprintSources ?? []).map((s, i) => (
            <li key={i}>
              {s.claim}{" "}
              <a href={s.url} target="_blank" rel="noreferrer">
                source
              </a>
            </li>
          ))}
        </ul>
        <h3>Pricing</h3>
        <p>
          Prices from{" "}
          <a href={meta?.pricing.source} target="_blank" rel="noreferrer">
            Anthropic's pricing page
          </a>
          , checked {meta?.pricing.checked}. Costs are API-equivalent: what pay-as-you-go would charge. Pro/Max subscribers are not billed per token.
        </p>
        <h3>Privacy</h3>
        <p>
          Reads <code>{meta?.projectsDir}</code> only. Never writes to it, never reads prompt or response text, never sends anything over the network. The server is bound to 127.0.0.1.
        </p>
      </aside>
    </>
  );
}
