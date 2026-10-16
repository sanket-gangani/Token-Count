import { useEffect, useRef, useState } from "react";

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Tween a number toward `value` with an ease-out curve. Respects prefers-reduced-motion. */
export function useTween(value: number, duration = 1400): number {
  const [shown, setShown] = useState(0);
  const fromRef = useRef(0);
  const raf = useRef<number>(0);
  useEffect(() => {
    if (reduced()) {
      setShown(value);
      fromRef.current = value;
      return;
    }
    const from = fromRef.current;
    const to = value;
    const start = performance.now();
    cancelAnimationFrame(raf.current);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - t, 5);
      const v = Math.round(from + (to - from) * e);
      fromRef.current = v;
      setShown(v);
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    // Safety net: if frames are throttled (background tab, emulators), land on the final value anyway.
    const done = window.setTimeout(() => {
      cancelAnimationFrame(raf.current);
      fromRef.current = to;
      setShown(to);
    }, duration + 300);
    return () => {
      cancelAnimationFrame(raf.current);
      window.clearTimeout(done);
    };
  }, [value, duration]);
  return shown;
}

/** Renders an already-tweened number with each digit on a rolling strip. */
export function RollingDigits({ value, className }: { value: number; className?: string }) {
  const text = Math.max(0, value).toLocaleString("en-US");
  return (
    <span className={"roll " + (className ?? "")} aria-label={text}>
      {text.split("").map((ch, i) =>
        /\d/.test(ch) ? (
          <span className="digit" key={text.length - i}>
            <span className="strip" style={{ transform: `translateY(-${Number(ch)}em)` }}>
              {Array.from({ length: 10 }, (_, d) => (
                <span key={d}>{d}</span>
              ))}
            </span>
          </span>
        ) : (
          <span className="sep" key={"s" + (text.length - i)}>
            {ch}
          </span>
        ),
      )}
    </span>
  );
}

/** Convenience: tween + digits in one component. */
export function RollingNumber({ value, duration, className }: { value: number; duration?: number; className?: string }) {
  const shown = useTween(value, duration);
  return <RollingDigits value={shown} className={className} />;
}
