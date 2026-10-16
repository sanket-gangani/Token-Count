import { useEffect, useState } from "react";
import { useTween } from "./RollingNumber";
import { fmtTokens, fmtUSD } from "../../../src/format";

/** True one frame after mount, so CSS transitions can animate from their start state. */
export function useMounted(delayMs = 60): boolean {
  const [m, setM] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setM(true), delayMs);
    return () => window.clearTimeout(t);
  }, [delayMs]);
  return m;
}

/** Count-up number, formatted. */
export function CountUp({ value, kind = "tokens", duration = 1300 }: { value: number; kind?: "tokens" | "usd" | "int"; duration?: number }) {
  const v = useTween(kind === "usd" ? Math.round(value * 100) : value, duration);
  const text = kind === "usd" ? fmtUSD(v / 100) : kind === "int" ? Math.round(v).toLocaleString() : fmtTokens(v);
  return <span className="num">{text}</span>;
}

const rnd = (i: number, n: number) => (((Math.sin(i * 91.17 + n * 47.31) * 24634.6345) % 1) + 1) % 1;
const EMBERS = Array.from({ length: 26 }, (_, i) => ({
  left: 4 + rnd(i, 1) * 92,
  size: 2 + rnd(i, 2) * 4,
  dur: 4.5 + rnd(i, 3) * 5,
  delay: -rnd(i, 4) * 9,
  drift: (rnd(i, 5) - 0.5) * 70,
  rise: 220 + rnd(i, 6) * 240,
  hot: rnd(i, 7) > 0.6,
}));

/** Sparks rising from the bottom of the hero. Pure CSS; hidden under prefers-reduced-motion. */
export function Embers({ intensity = 1 }: { intensity?: number }) {
  const n = Math.max(6, Math.round(EMBERS.length * Math.min(1, intensity)));
  return (
    <div className="embers" aria-hidden="true">
      {EMBERS.slice(0, n).map((e, i) => (
        <span
          key={i}
          className={"ember" + (e.hot ? " hot" : "")}
          style={
            {
              left: `${e.left}%`,
              width: e.size,
              height: e.size,
              animationDuration: `${e.dur / Math.max(0.6, intensity)}s`,
              animationDelay: `${e.delay}s`,
              "--drift": `${e.drift}px`,
              "--rise": `${-e.rise}px`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
