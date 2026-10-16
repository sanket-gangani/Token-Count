import { useMemo } from "react";
import type { Footprint, LadderUnit } from "../api";
import { fmtLiters, fmtWh } from "../../../src/format";
import { useInView } from "../fx/motion";

// Deterministic pseudo-random so the sky never re-shuffles between renders.
const rnd = (i: number, n: number) => (((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1) + 1) % 1;
const STARS = Array.from({ length: 70 }, (_, i) => ({ x: rnd(i, 1) * 1200, y: rnd(i, 2) * 150, r: 0.5 + rnd(i, 3) * 1.2, d: rnd(i, 4) * 3.4 }));

// Scene geometry in viewBox units (1200 x 520). Wide so it can bleed edge to edge.
const RIM = 196;
const FULL_Y = 198;
const EMPTY_Y = 330;
const BASIN = "M330,196 C380,290 560,340 740,340 C920,340 1100,290 1150,196 Z";

function wavePath(): string {
  let d = "M-120,0";
  for (let x = -120; x < 1400; x += 60) d += " q15,-4.5 30,0 q15,4.5 30,0";
  return d + " V30 H-120 Z";
}

export function Lake({ fp, ladder, onWhy }: { fp: Footprint | null; ladder: LadderUnit[]; onWhy: () => void }) {
  const [ref, inView] = useInView<HTMLElement>({ threshold: 0.35 });
  // Start full, then drain to the real level once the lake is actually on screen.
  const level = inView ? fp?.lakeLevel ?? 1 : 1;
  const waterY = FULL_Y + (1 - level) * (EMPTY_Y - FULL_Y);
  const shift = waterY - FULL_Y;
  const wave = useMemo(wavePath, []);
  const ticks = useMemo(() => Array.from({ length: 11 }, (_, i) => FULL_Y + (i / 10) * (EMPTY_Y - FULL_Y)), []);

  const stage = fp?.water.stage ?? 0;
  const next = ladder[stage + 1];
  const liters = fp?.liters ?? 0;
  const toGo = next ? Math.max(0, next.size - liters) : 0;
  const progress = inView ? (next ? Math.min(1, liters / next.size) : 1) : 0;
  const reading = fp?.water.text ?? "";
  // "≈ 9.8 buckets" -> number + unit for mixed type setting
  const m = reading.match(/^≈\s*([\d.,]+)\s+(.*)$/);

  return (
    <section ref={ref} className="lake" aria-label="Estimated water footprint">
      <div className="lake-scene" data-parallax="0.12">
        <svg className="lake-svg" viewBox="0 0 1200 520" preserveAspectRatio="xMidYMid slice" role="img" aria-label={fp ? `Illustrated lake, ${Math.round(level * 100)} percent full. ${fp.water.text} of water.` : "Illustrated lake"}>
          <defs>
            <linearGradient id="lk-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: "var(--sky-1)" }} />
              <stop offset="1" style={{ stopColor: "var(--sky-2)" }} />
            </linearGradient>
            <linearGradient id="lk-water" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: "var(--water-1)" }} />
              <stop offset="0.3" style={{ stopColor: "var(--water-2)" }} />
              <stop offset="1" style={{ stopColor: "var(--water-3)" }} />
            </linearGradient>
            <linearGradient id="lk-bed" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: "var(--bed-1)" }} />
              <stop offset="1" style={{ stopColor: "var(--bed-2)" }} />
            </linearGradient>
            <radialGradient id="lk-glow">
              <stop offset="0" style={{ stopColor: "var(--moon-glow)" }} />
              <stop offset="1" stopColor="#000" stopOpacity="0" />
            </radialGradient>
            <clipPath id="lk-basin">
              <path d={BASIN} />
            </clipPath>
          </defs>

          {/* sky */}
          <rect width="1200" height="520" fill="url(#lk-sky)" />
          {STARS.map((s, i) => (
            <circle key={i} className="star" cx={s.x} cy={s.y} r={s.r} style={{ fill: "var(--ink)", animationDelay: `${s.d}s` }} />
          ))}
          <circle cx="960" cy="86" r="80" fill="url(#lk-glow)" />
          <circle cx="960" cy="86" r="19" style={{ fill: "var(--moon)" }} />

          {/* mountains, far to near */}
          <path d="M0,170 L90,120 L170,150 L270,88 L370,140 L450,104 L540,146 L640,92 L740,136 L840,106 L930,146 L1020,112 L1110,150 L1200,128 V300 H0 Z" style={{ fill: "var(--mtn-3)" }} />
          <path d="M0,190 C100,166 180,176 260,156 C350,134 420,164 520,160 C620,156 690,138 800,150 C900,160 1000,172 1100,166 C1140,164 1170,170 1200,172 V320 H0 Z" style={{ fill: "var(--mtn-2)" }} />
          <path d="M0,206 C80,198 160,194 240,200 L560,206 L960,202 C1040,196 1120,196 1200,206 V520 H0 Z" style={{ fill: "var(--mtn-1)" }} />

          {/* basin: dry bed, cracks, pier posts, then the water on top */}
          <g clipPath="url(#lk-basin)">
            <rect x="300" y={RIM - 4} width="900" height="180" fill="url(#lk-bed)" />

            <g className="water-level" style={{ transform: `translateY(${shift}px)` }}>
              <rect x="300" y={FULL_Y} width="900" height="180" fill="url(#lk-water)" />
              <path className="wave" d={wave} transform={`translate(0 ${FULL_Y - 2})`} fill="#ffffff" opacity="0.16" />
              <path className="wave2" d={wave} transform={`translate(0 ${FULL_Y + 1})`} fill="#ffffff" opacity="0.1" />
              <rect className="shimmer" x="936" y={FULL_Y + 10} width="48" height="2.5" rx="1.25" fill="#fff6d8" />
              <rect className="shimmer" x="946" y={FULL_Y + 20} width="28" height="2" rx="1" fill="#fff6d8" style={{ animationDelay: "0.6s" }} />
              <rect className="shimmer" x="954" y={FULL_Y + 29} width="12" height="1.6" rx="0.8" fill="#fff6d8" style={{ animationDelay: "1.2s" }} />
            </g>

            {level < 0.985 && <line className="hwm" x1="300" x2="1200" y1={FULL_Y + 0.5} y2={FULL_Y + 0.5} stroke="#ffffff" strokeOpacity="0.45" />}
          </g>

          {/* depth gauge */}
          <g>
            <rect x="600" y={RIM - 18} width="2" height={EMPTY_Y - RIM + 22} rx="1.5" style={{ fill: "var(--gauge)" }} opacity="0.85" />
            {ticks.map((y, i) => (
              <rect key={i} x="602" y={y - 0.6} width={i % 5 === 0 ? 10 : 5} height="1.2" style={{ fill: "var(--gauge)" }} />
            ))}
            <text x="616" y={FULL_Y + 3} fontSize="12" fontWeight="500" letterSpacing="0.08em" style={{ fill: "var(--gauge)" }} fontFamily="var(--mono)">100</text>
            <text x="616" y={(FULL_Y + EMPTY_Y) / 2 + 3} fontSize="12" fontWeight="500" letterSpacing="0.08em" style={{ fill: "var(--gauge)" }} fontFamily="var(--mono)">50</text>
            <text x="616" y={EMPTY_Y + 3} fontSize="12" fontWeight="500" letterSpacing="0.08em" style={{ fill: "var(--gauge)" }} fontFamily="var(--mono)">0</text>
          </g>

          {/* near shore */}
          <path d="M0,340 C160,322 320,350 600,350 C880,350 1040,322 1200,340 V520 H0 Z" style={{ fill: "var(--shore)" }} />
        </svg>
      </div>
      <div className="lake-scrim" />

      <div className="wrap lake-inner">
        <div className="lake-copy">
          <div className="kicker" data-reveal>
            The lake <span className="dim">· estimate · {Math.round(level * 100)}% full</span>
          </div>
          <div className="reading" data-reveal data-reveal-delay="80">
            {m ? (
              <>
                ≈ {m[1]} <span className="serif">{m[2]}</span>
              </>
            ) : (
              reading || "…"
            )}
          </div>
          <div className="quip" data-reveal data-reveal-delay="160">
            {fp?.water.quip ?? ""}
          </div>
          {next ? (
            <div className="next" data-reveal data-reveal-delay="220">
              <div className="row">
                <span>
                  next stop · <b>{next.singular}</b>
                </span>
                <span>{fmtLiters(toGo)} to go</span>
              </div>
              <div className="bar">
                <i style={{ width: `${progress * 100}%` }} />
              </div>
            </div>
          ) : (
            <div className="next" data-reveal data-reveal-delay="220">
              <div className="row">
                <span>Peak lake reached</span>
              </div>
            </div>
          )}
          <div className="facts" data-reveal data-reveal-delay="280">
            <span>
              <b>{fp ? fmtLiters(fp.liters) : "…"}</b> estimated water
            </span>
            <span>
              <b>{fp ? fmtWh(fp.wh) : "…"}</b> {fp ? fp.energy.text : "energy"}
            </span>
          </div>
          <div className="how" data-reveal data-reveal-delay="340">
            <button className="linkbtn" onClick={onWhy}>
              How is this calculated
            </button>
          </div>
        </div>
        <div className="ladder" data-reveal="fade" data-reveal-delay="1400" aria-hidden="true">
          {[...ladder].reverse().map((u) => {
            const i = ladder.indexOf(u);
            return (
              <span key={u.id} className={i < stage ? "done" : i === stage ? "now" : ""}>
                {u.plural}
              </span>
            );
          })}
        </div>
      </div>
    </section>
  );
}
