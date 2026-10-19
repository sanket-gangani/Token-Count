import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEMO, fetchSummary, useLive, type Filters, type PeriodCard, type SummaryResponse } from "./api";
import { RollingDigits, useTween } from "./components/RollingNumber";
import { CountUp } from "./components/Motion";
import { Lake } from "./components/Lake";
import { DailyBurn, HourOfDay, MoneySplit, Ranked } from "./components/Charts";
import { FilterBar, presetRange, type RangePreset } from "./components/Filters";
import { SettingsDrawer } from "./components/Settings";
import { Sessions } from "./components/Sessions";
import { useFire } from "./fx/fire";
import { Marquee, useParallax, useReveal } from "./fx/motion";
import { fmtTokens, fmtUSD } from "../../src/format";
import { modelLabel } from "../../src/models";

const FLAME_PATH =
  "M33 8c2 9-6 12-7 19-1-4-3-6-6-8-4 6-7 12-7 19 0 11 8 18 19 18s19-7 19-18c0-12-9-17-18-30zm-1 44c-5 0-9-4-9-9 0-4 3-6 4-9 1 2 3 3 4 3 3 0 4-3 3-6 4 3 7 7 7 12 0 5-4 9-9 9z";

function Flame({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id="flame-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd27a" />
          <stop offset=".55" stopColor="#ff5a1f" />
          <stop offset="1" stopColor="#c92d0a" />
        </linearGradient>
      </defs>
      <path fill="url(#flame-g)" d={FLAME_PATH} />
    </svg>
  );
}

const Icon = {
  sun: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4" /></svg>,
  moon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>,
  sliders: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>,
};

/** The fire mounts with the hero so the canvas exists when the WebGL hook runs. */
function FireLayer({ intensity, burstRef }: { intensity: number; burstRef: React.MutableRefObject<((strength?: number) => void) | null> }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const fire = useFire(ref, intensity);
  const [lit, setLit] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setLit(true), 400);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    burstRef.current = fire.burst;
    return () => {
      burstRef.current = null;
    };
  }, [fire.burst, burstRef]);
  return <canvas ref={ref} className={"hero-fire" + (lit ? " lit" : "")} aria-hidden="true" style={{ opacity: fire.supported && lit ? 1 : 0 }} />;
}

function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try {
      const t = localStorage.getItem("tokenburn.theme");
      if (t === "light" || t === "dark") return t;
    } catch {
      /* storage blocked */
    }
    return "dark";
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("tokenburn.theme", theme);
    } catch {
      /* storage blocked */
    }
  }, [theme]);
  return [theme, setTheme] as const;
}

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Scroll-linked hero exit: writes --hero-p (0..1) as the hero leaves the viewport. */
function useHeroProgress() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || window.matchMedia("(pointer: coarse)").matches) return;
    let raf = 0;
    const on = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const p = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 0.7)));
        document.documentElement.style.setProperty("--hero-p", p.toFixed(3));
      });
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => {
      window.removeEventListener("scroll", on);
      cancelAnimationFrame(raf);
    };
  }, []);
}

function useScrolled(threshold = 24) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > threshold);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [threshold]);
  return scrolled;
}

const ago = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

const longDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "long" });

function PulseCell({ p, delay }: { p: PeriodCard; delay: number }) {
  return (
    <div className="cell" data-reveal data-reveal-delay={String(delay)}>
      <div className="lbl">
        <span>{p.label}</span>
        {p.topModel && (
          <span className="chip" title={`Most-used model: ${p.topModel}`}>
            <i />
            {modelLabel(p.topModel)}
          </span>
        )}
      </div>
      <div className="big">
        <CountUp value={p.total} />
      </div>
      <div className="line">
        <b>
          <CountUp value={p.usd} kind="usd" />
        </b>{" "}
        API-eq · <CountUp value={p.requests} kind="int" /> requests
      </div>
    </div>
  );
}

export function App() {
  const [theme, setTheme] = useTheme();
  const [preset, setPreset] = useState<RangePreset>("all");
  const [filters, setFilters] = useState<Filters>({ projects: [], models: [] });
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [kick, setKick] = useState(0);
  const [pops, setPops] = useState<{ id: number; v: number }[]>([]);
  const live = useLive();
  const now = useNow();
  const scrolled = useScrolled();
  const refetchTimer = useRef<number | null>(null);
  const burstRef = useRef<((strength?: number) => void) | null>(null);

  useReveal();
  useParallax();
  useHeroProgress();

  const effective = useMemo<Filters>(() => {
    if (preset === "custom") return filters;
    const r = presetRange(preset);
    return { ...filters, from: r.from, to: r.to };
  }, [preset, filters]);

  const load = useCallback(async () => {
    try {
      setData(await fetchSummary(effective));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [effective]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = preset !== "all" || filters.projects.length > 0 || filters.models.length > 0;
  const s = data?.summary;
  const meta = data?.meta ?? null;
  const snap = live.snapshot ?? data?.allTime ?? null;
  const heroTotal = !filtered && snap ? snap.totals.total : s?.totals.total ?? 0;
  const heroUsd = !filtered && snap ? snap.totals.usd : s?.totals.usd ?? 0;
  const fp = !filtered && snap ? snap.footprint : data?.footprint ?? null;
  const heroShown = useTween(heroTotal, 1800);
  // While the opening tween drives the digits, strips follow it nearly 1:1; afterwards they flap.
  const [landing, setLanding] = useState(true);
  const hasTotal = heroTotal > 0 ? 1 : 0;
  useEffect(() => {
    setLanding(true);
    const t = window.setTimeout(() => setLanding(false), 2200);
    return () => window.clearTimeout(t);
  }, [hasTotal]);

  const lastTs = snap?.lastEventTs ?? null;
  const burning = live.connected && lastTs !== null && now - lastTs < 120_000;
  const fireIntensity = burning ? 0.85 : live.connected ? 0.4 : 0.25;

  // Live usage: surge the fire, kick the counter, float a delta, refetch so everything else follows.
  useEffect(() => {
    if (!live.tick) return;
    if (refetchTimer.current) window.clearTimeout(refetchTimer.current);
    refetchTimer.current = window.setTimeout(load, 700);
    if (live.lastDelta > 0) {
      const id = Date.now();
      setKick(id);
      burstRef.current?.(Math.min(1, 0.55 + live.lastDelta / 200_000));
      setPops((p) => [...p.slice(-2), { id, v: live.lastDelta }]);
      window.setTimeout(() => setPops((p) => p.filter((x) => x.id !== id)), 1900);
      window.setTimeout(() => setKick(0), 600);
    }
  }, [live.tick, live.lastDelta, load]);

  const statusText = !live.connected ? "offline · reconnecting" : burning ? `burning · ${ago(now - (lastTs ?? now))}` : lastTs ? `idle · last burn ${ago(now - lastTs)}` : "watching for usage";
  const rangeLabel = preset === "all" ? "all time" : preset === "custom" ? "custom range" : `last ${preset.replace("d", " days")}`;
  const who = DEMO ? "this demo team has" : "you have";
  const since =
    preset === "all" && !filtered && s?.first ? `Since ${longDate(s.first)}, ${who} burned` : preset === "all" ? `In this selection, ${who} burned` : `In the ${rangeLabel}, ${who} burned`;
  const noData = s && s.totals.requests === 0 && !filtered;

  const tickerItems = s
    ? [
        ["API-eq", fmtUSD(s.totals.usd)],
        ["requests", s.totals.requests.toLocaleString()],
        ["sessions", s.totals.sessions.toLocaleString()],
        ["output tokens", fmtTokens(s.totals.output)],
        ["cache reads", s.totals.total ? Math.round((s.totals.cacheRead / s.totals.total) * 100) + "%" : "0%"],
        ["without the cache", fmtUSD(s.totals.usd + s.costByKind.cacheSavings)],
        ["top model", s.models[0] ? modelLabel(s.models[0].key) : "none"],
        ["water", fp ? fp.water.text.replace(/^≈\s*/, "") : "…"],
      ]
    : [];

  return (
    <>
      <header className={"nav" + (scrolled ? " scrolled" : "")}>
        <a className="brand" href="./" aria-label="TokenBurn home">
          <Flame />
          <span className="word">
            Token<em>Burn</em>
          </span>
        </a>
        <span className="meta">{DEMO ? "demo · fictional usage · run npx burntokens for yours" : "local · read-only · nothing leaves this machine"}</span>
        <span className="spacer" />
        <span className={"status " + (burning ? "burning" : live.connected ? "idle" : "")} data-reveal="fade" data-reveal-delay="1800">
          <span className="dot" />
          <span className="txt">{statusText}</span>
        </span>
        <button className="iconbtn" title={theme === "dark" ? "Light mode" : "Dark mode"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle theme">
          {theme === "dark" ? Icon.sun : Icon.moon}
        </button>
        <button className="iconbtn" title="Estimate settings" onClick={() => setSettings(true)} aria-label="Settings">
          {Icon.sliders}
        </button>
      </header>

      {error && (
        <div className="wrap">
          <div className="err">Can't reach the TokenBurn server ({error}). Is it still running in your terminal?</div>
        </div>
      )}

      {!s && !error && (
        <div className="loading">
          <div>
            <Flame className="flame" />
            Reading your logs
          </div>
        </div>
      )}

      {noData && (
        <div className="wrap nothing">
          <Flame className="flame" />
          <h3>Nothing burned yet</h3>
          <p>
            No Claude Code usage found in <code>{meta?.projectsDir}</code>. Use Claude Code and this page lights up live.
          </p>
        </div>
      )}

      {s && !noData && (
        <main>
          <section className="hero">
            <div className="hero-grid" />
            <FireLayer intensity={fireIntensity} burstRef={burstRef} />
            <div className="hero-vignette" />
            <div className="scroll-cue" data-reveal="fade" data-reveal-delay="1800">scroll</div>
            <div className="wrap hero-inner">
              <div className="hero-eyebrow" data-reveal>
                <span className="serif">{since}</span>
                {DEMO && <span className="mono">demo data</span>}
              </div>
              <div className="counter-wrap" data-reveal data-reveal-delay="350">
                <div className={"counter" + (kick ? " kick" : "")} data-landing={landing || undefined}>
                  <RollingDigits value={heroShown} />
                </div>
                {pops.map((p) => (
                  <span key={p.id} className="delta-pop">
                    +{fmtTokens(p.v)} tokens
                  </span>
                ))}
              </div>
              <div className="hero-row" data-reveal data-reveal-delay="1300">
                <div className="hero-cost">
                  tokens. That is <b><CountUp value={heroUsd} kind="usd" duration={2200} /></b> <span className="serif">at API list prices.</span>
                </div>
                <div className="hero-kv">
                  <div className="kv">
                    <div className="v">{rangeLabel}</div>
                    <div className="k">range</div>
                  </div>
                  {!filtered && snap && (
                    <div className="kv">
                      <div className="v"><CountUp value={snap.lastHour.total} /></div>
                      <div className="k">last hour</div>
                    </div>
                  )}
                  <div className="kv">
                    <div className="v"><CountUp value={s.totals.requests} kind="int" /></div>
                    <div className="k">requests</div>
                  </div>
                  <div className="kv">
                    <div className="v"><CountUp value={s.totals.sessions} kind="int" /></div>
                    <div className="k">sessions</div>
                  </div>
                  <div className="kv">
                    <div className="v"><CountUp value={s.totals.output} /></div>
                    <div className="k">output tokens</div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div className="ticker" aria-hidden="true">
            <Marquee speed={46} pauseOnHover>
              {tickerItems.map(([k, v]) => (
                <span className="item" key={k}>
                  <span>{k}</span>
                  <b>{v}</b>
                </span>
              ))}
            </Marquee>
          </div>

          <section className="section">
            <div className="wrap">
              <div className="section-head" data-reveal>
                <div className="title">
                  <span className="no">01</span>
                  <h2>
                    The pulse <span className="serif">right now</span>
                  </h2>
                </div>
                <FilterBar meta={meta} filters={filters} preset={preset} onPreset={setPreset} onChange={setFilters} />
              </div>
              <div className="pulse">
                <PulseCell p={s.periods.today} delay={0} />
                <PulseCell p={s.periods.week} delay={90} />
                <PulseCell p={s.periods.month} delay={180} />
                <div className="cell" data-reveal data-reveal-delay="270">
                  <div className="lbl">
                    <span>Without the cache</span>
                  </div>
                  <div className="big">
                    <CountUp value={s.totals.usd + s.costByKind.cacheSavings} kind="usd" />
                  </div>
                  <div className="line">
                    what <b>{fmtTokens(s.totals.cacheRead)}</b> re-read tokens cost at full input price. You paid <b>{fmtUSD(s.totals.usd)}</b>.
                  </div>
                </div>
              </div>
            </div>
          </section>

          <Lake fp={fp} ladder={meta?.waterLadder ?? []} onWhy={() => setSettings(true)} />

          <section className="section">
            <div className="wrap">
              <div className="section-head" data-reveal>
                <div className="title">
                  <span className="no">02</span>
                  <h2>
                    Burn <span className="serif">history</span>
                  </h2>
                </div>
              </div>
              <div data-reveal>
                <DailyBurn days={s.days} />
              </div>
            </div>
          </section>

          <section className="section">
            <div className="wrap">
              <div className="section-head" data-reveal>
                <div className="title">
                  <span className="no">03</span>
                  <h2>
                    Anatomy <span className="serif">of a burn</span>
                  </h2>
                </div>
                <p className="sub">
                  <b>{Math.round((s.totals.cacheRead / Math.max(1, s.totals.total)) * 100)}%</b> of everything you burned was re-reading your own conversation.
                </p>
              </div>
              <div className="twoup">
                <div data-reveal>
                  <MoneySplit s={s} />
                </div>
                <div data-reveal data-reveal-delay="120">
                  <HourOfDay hours={s.hours} />
                </div>
              </div>
            </div>
          </section>

          <section className="section">
            <div className="wrap">
              <div className="section-head" data-reveal>
                <div className="title">
                  <span className="no">04</span>
                  <h2>
                    The <span className="serif">leaderboard</span>
                  </h2>
                </div>
                <p className="sub">
                  <b>{s.projects[0]?.label ?? "One project"}</b> is {Math.round(((s.projects[0]?.usd ?? 0) / Math.max(1, s.totals.usd)) * 100)}% of the bill.
                </p>
              </div>
              <div className="twoup">
                <div data-reveal>
                  <Ranked title="By model" rows={s.models.map((m) => ({ ...m, label: modelLabel(m.key) }))} />
                </div>
                <div data-reveal data-reveal-delay="120">
                  <Ranked title="By project" rows={s.projects} />
                </div>
              </div>
            </div>
          </section>

          <section className="section">
            <div className="wrap">
              <div className="section-head" data-reveal>
                <div className="title">
                  <span className="no">05</span>
                  <h2>
                    Recent <span className="serif">sessions</span>
                  </h2>
                </div>
                <p className="sub">
                  <b>{s.totals.sessions.toLocaleString()}</b> sessions. New ones flash in as they happen.
                </p>
              </div>
              <div data-reveal>
                <Sessions rows={s.sessions} freshSince={live.lastEventAt ? live.lastEventAt - 5000 : null} />
              </div>
            </div>
          </section>
        </main>
      )}

      <footer className="foot">
        <div className="wrap">
          <div className="wordmark" aria-hidden="true">
            <RollingDigits value={heroShown} /> <span className="serif">tokens, and counting.</span>
          </div>
          <div className="cols">
            <div>
              <b>Privacy</b>
              {DEMO && "This preview runs on made-up usage generated in your browser. The real thing, npx burntokens, runs on your machine. "}
              Reads your Claude Code logs only. Never writes to them, never reads prompt or response text. The server binds to 127.0.0.1 and sends nothing anywhere.
            </div>
            <div>
              <b>Numbers</b>
              Dollar figures are what these tokens would cost at Anthropic's API list prices, checked {meta?.pricing.checked ?? "…"}. On a subscription you paid less. Water and energy use third-party estimates.
            </div>
            <div>
              <b>TokenBurn v{meta?.version ?? "…"}</b>
              Open source, MIT. Not affiliated with Anthropic.
              <span className="mono-line">{DEMO ? "demo data · no logs read" : `${meta?.files ?? 0} log files · read-only`}</span>
            </div>
          </div>
        </div>
      </footer>
      {settings && <SettingsDrawer meta={meta} onClose={() => setSettings(false)} onSaved={load} />}
    </>
  );
}
