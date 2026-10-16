import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

/* ---------------------------------------------------------------------- */
/* Shared helpers                                                          */
/* ---------------------------------------------------------------------- */

const REVEAL_CLASS = "in";
const REVEAL_SELECTOR = "[data-reveal]";
const REVEAL_FALLBACK_MS = 2500;
const PARALLAX_SELECTOR = "[data-parallax]";
const MARQUEE_STYLE_ID = "marquee-style";

/** True when running in a browser with a DOM. */
function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

/** Media-query helper that is safe to call during SSR. */
function matches(query: string): boolean {
  return isBrowser() && typeof window.matchMedia === "function"
    ? window.matchMedia(query).matches
    : false;
}

/** Whether the user has asked for reduced motion. */
function prefersReducedMotion(): boolean {
  return matches("(prefers-reduced-motion: reduce)");
}

/** Whether the primary pointer is coarse (touch). */
function hasCoarsePointer(): boolean {
  return matches("(pointer: coarse)");
}

/** Isomorphic layout effect: useLayoutEffect in the browser, useEffect on the server. */
const useIsomorphicLayoutEffect = isBrowser() ? useLayoutEffect : useEffect;

/* ---------------------------------------------------------------------- */
/* useReveal                                                               */
/* ---------------------------------------------------------------------- */

/**
 * Reveal-on-scroll for every `[data-reveal]` element under `root`.
 *
 * When an element becomes at least 12% visible it receives the class `in`
 * (once) and is no longer observed. An optional `data-reveal-delay="120"`
 * attribute (milliseconds) is applied as `transitionDelay` before the class
 * is added. New `[data-reveal]` elements added later (React renders after
 * mount, lazy sections, etc.) are picked up by a MutationObserver.
 *
 * Safety nets:
 * - `prefers-reduced-motion`: everything is revealed immediately, no observers.
 * - Any element still hidden 2500ms after first being observed is revealed.
 * - Elements already in the viewport reveal on the first frame.
 *
 * @param root Optional ref to the subtree to observe. Defaults to `document.body`.
 */
export function useReveal(root?: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!isBrowser()) return;
    const scope: HTMLElement = root?.current ?? document.body;
    if (!scope) return;

    const reveal = (el: HTMLElement): void => {
      if (el.classList.contains(REVEAL_CLASS)) return;
      const delay = el.dataset.revealDelay;
      if (delay !== undefined) {
        const ms = Number(delay);
        if (Number.isFinite(ms) && ms > 0) el.style.transitionDelay = `${ms}ms`;
      }
      el.classList.add(REVEAL_CLASS);
    };

    const collect = (): HTMLElement[] => {
      const list = Array.from(scope.querySelectorAll<HTMLElement>(REVEAL_SELECTOR));
      if (scope.matches(REVEAL_SELECTOR)) list.unshift(scope);
      return list;
    };

    if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
      // Reveal everything now and keep revealing anything added later.
      collect().forEach(reveal);
      const mo =
        typeof MutationObserver !== "undefined"
          ? new MutationObserver(() => collect().forEach(reveal))
          : null;
      mo?.observe(scope, { childList: true, subtree: true });
      return () => mo?.disconnect();
    }

    const timers = new Map<Element, number>();
    const tracked = new WeakSet<Element>();

    const release = (el: Element): void => {
      io.unobserve(el);
      const t = timers.get(el);
      if (t !== undefined) {
        window.clearTimeout(t);
        timers.delete(el);
      }
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.12) continue;
          const el = entry.target as HTMLElement;
          reveal(el);
          release(el);
        }
      },
      { threshold: [0, 0.12, 1], rootMargin: "0px 0px -12% 0px" },
    );

    const track = (el: HTMLElement): void => {
      if (tracked.has(el) || el.classList.contains(REVEAL_CLASS)) return;
      tracked.add(el);
      io.observe(el);
      timers.set(
        el,
        window.setTimeout(() => {
          reveal(el);
          release(el);
        }, REVEAL_FALLBACK_MS),
      );
    };

    const scan = (): void => collect().forEach(track);

    // Elements already in the DOM (and already in the viewport) are observed
    // immediately; IntersectionObserver fires its first callback on the next
    // frame, so visible content reveals without a scroll.
    scan();
    const raf = window.requestAnimationFrame(scan);

    const mo = new MutationObserver((records) => {
      let dirty = false;
      for (const r of records) {
        if (r.addedNodes.length > 0) {
          dirty = true;
          break;
        }
      }
      if (dirty) scan();
    });
    mo.observe(scope, { childList: true, subtree: true });

    return () => {
      window.cancelAnimationFrame(raf);
      mo.disconnect();
      io.disconnect();
      timers.forEach((t) => window.clearTimeout(t));
      timers.clear();
    };
  }, [root]);
}

/* ---------------------------------------------------------------------- */
/* useParallax                                                             */
/* ---------------------------------------------------------------------- */

/**
 * Vertical parallax for `[data-parallax="0.25"]` elements.
 *
 * Each element is translated by `(elementCenter - viewportCenter) * factor`
 * via `transform: translate3d(0, y, 0)`. Updates are rAF-throttled on
 * passive scroll and resize listeners, and only elements within 1.5x the
 * viewport height are processed. Skipped entirely under
 * `prefers-reduced-motion` or on coarse-pointer (touch) devices.
 */
export function useParallax(): void {
  useEffect(() => {
    if (!isBrowser()) return;
    if (prefersReducedMotion() || hasCoarsePointer()) return;

    let raf = 0;
    const touched = new Set<HTMLElement>();

    const update = (): void => {
      raf = 0;
      const vh = window.innerHeight;
      const center = vh / 2;
      const limit = vh * 1.5;
      const els = document.querySelectorAll<HTMLElement>(PARALLAX_SELECTOR);
      for (const el of els) {
        const factor = Number(el.dataset.parallax);
        if (!Number.isFinite(factor) || factor === 0) continue;
        const rect = el.getBoundingClientRect();
        const elCenter = rect.top + rect.height / 2;
        const offset = elCenter - center;
        if (Math.abs(offset) > limit) continue;
        // getBoundingClientRect already includes the current transform; use
        // the stored untransformed offset so the position does not drift.
        const prev = Number(el.dataset.parallaxY ?? "0");
        const y = Math.round((offset - prev) * factor * 100) / 100;
        el.dataset.parallaxY = String(y);
        el.style.transform = `translate3d(0, ${y}px, 0)`;
        el.style.willChange = "transform";
        touched.add(el);
      }
    };

    const schedule = (): void => {
      if (raf === 0) raf = window.requestAnimationFrame(update);
    };

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    schedule();

    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (raf !== 0) window.cancelAnimationFrame(raf);
      touched.forEach((el) => {
        el.style.transform = "";
        el.style.willChange = "";
        delete el.dataset.parallaxY;
      });
      touched.clear();
    };
  }, []);
}

/* ---------------------------------------------------------------------- */
/* useInView                                                               */
/* ---------------------------------------------------------------------- */

/** Options for {@link useInView}. */
export interface UseInViewOptions {
  /** Stop observing after the first intersection. Defaults to `true`. */
  once?: boolean;
  /** IntersectionObserver threshold. Defaults to `0`. */
  threshold?: number;
}

/**
 * Tracks whether the referenced element is in the viewport.
 *
 * @returns A tuple of `[ref, inView]`. Attach `ref` to the element you want
 * to observe. With `once` (the default) the value latches to `true` after the
 * first intersection and the observer disconnects.
 */
export function useInView<T extends HTMLElement>(
  options?: UseInViewOptions,
): [RefObject<T>, boolean] {
  const once = options?.once ?? true;
  const threshold = options?.threshold ?? 0;
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (!isBrowser()) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            if (once) io.disconnect();
          } else if (!once) {
            setInView(false);
          }
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once, threshold]);

  return [ref as RefObject<T>, inView];
}

/* ---------------------------------------------------------------------- */
/* useSpring                                                               */
/* ---------------------------------------------------------------------- */

/** Options for {@link useSpring}. */
export interface UseSpringOptions {
  /** Spring stiffness. Defaults to `170`. */
  stiffness?: number;
  /** Damping coefficient. Defaults to `26`. */
  damping?: number;
  /** Distance and velocity below which the spring snaps to target. Defaults to `0.01`. */
  precision?: number;
}

/**
 * Returns a value that follows `target` with a damped spring simulation.
 *
 * The simulation runs in `requestAnimationFrame` using real elapsed time
 * (clamped to 50ms per step). When both displacement and velocity fall
 * below `precision` the value snaps exactly to `target` and the loop stops.
 * Under `prefers-reduced-motion` the target is returned directly.
 */
export function useSpring(target: number, opts?: UseSpringOptions): number {
  const stiffness = opts?.stiffness ?? 170;
  const damping = opts?.damping ?? 26;
  const precision = opts?.precision ?? 0.01;

  const [reduced] = useState(() => prefersReducedMotion());
  const [value, setValue] = useState(target);
  const state = useRef({ value: target, velocity: 0 });

  useEffect(() => {
    if (!isBrowser() || reduced) return;

    let raf = 0;
    let last = 0;

    const step = (now: number): void => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const s = state.current;
      const displacement = s.value - target;
      const accel = -stiffness * displacement - damping * s.velocity;
      s.velocity += accel * dt;
      s.value += s.velocity * dt;

      if (Math.abs(s.value - target) < precision && Math.abs(s.velocity) < precision) {
        s.value = target;
        s.velocity = 0;
        setValue(target);
        raf = 0;
        return;
      }
      setValue(s.value);
      raf = window.requestAnimationFrame(step);
    };

    if (state.current.value === target && state.current.velocity === 0) {
      setValue(target);
      return;
    }

    raf = window.requestAnimationFrame((now) => {
      last = now;
      step(now);
    });

    return () => {
      if (raf !== 0) window.cancelAnimationFrame(raf);
    };
  }, [target, stiffness, damping, precision, reduced]);

  return reduced ? target : value;
}

/* ---------------------------------------------------------------------- */
/* Marquee                                                                 */
/* ---------------------------------------------------------------------- */

/** Props for {@link Marquee}. */
export interface MarqueeProps {
  /** Items to scroll. Rendered twice for a seamless loop. */
  children: ReactNode;
  /** Scroll speed in pixels per second. Defaults to `60`. */
  speed?: number;
  /** Scroll right-to-left when `false` (default), left-to-right when `true`. */
  reverse?: boolean;
  /** Pause the animation while the pointer is over the strip. */
  pauseOnHover?: boolean;
  /** Extra class names for the outer `.marquee` wrapper. */
  className?: string;
}

const MARQUEE_CSS = `
.marquee{--marquee-gap:48px;position:relative;overflow:hidden;width:100%;}
.marquee-track{display:flex;flex-wrap:nowrap;align-items:center;gap:0;width:max-content;will-change:transform;}
.marquee-track>*{flex:0 0 auto;}
.marquee-track[data-animate="true"]{animation:marquee-scroll var(--marquee-duration,20s) linear infinite;}
.marquee-track[data-reverse="true"]{animation-direction:reverse;}
.marquee[data-pause-on-hover="true"]:hover .marquee-track{animation-play-state:paused;}
.marquee-copy{display:flex;flex-wrap:nowrap;align-items:center;gap:var(--marquee-gap);padding-right:var(--marquee-gap);flex:0 0 auto;}
.marquee-copy:only-child{padding-right:0;}
@keyframes marquee-scroll{from{transform:translateX(0);}to{transform:translateX(-50%);}}
@media (prefers-reduced-motion:reduce){.marquee-track{animation:none !important;}}
`;

/** Injects the marquee stylesheet into `<head>` once per document. */
function ensureMarqueeStyle(): void {
  if (!isBrowser()) return;
  if (document.getElementById(MARQUEE_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = MARQUEE_STYLE_ID;
  style.textContent = MARQUEE_CSS;
  document.head.appendChild(style);
}

/**
 * Horizontally scrolling strip that loops seamlessly.
 *
 * Renders `div.marquee > div.marquee-track` with the children duplicated
 * (the second copy is `aria-hidden`). The track width is measured with a
 * ResizeObserver so the animation duration is `loopDistance / speed` seconds
 * at any size, keeping the loop seamless. Each copy carries the same
 * `--marquee-gap` (default 48px) between its items and as trailing padding,
 * so the seam between the two copies is invisible.
 * Under `prefers-reduced-motion` only a single, static copy is rendered.
 */
export function Marquee({
  children,
  speed = 60,
  reverse = false,
  pauseOnHover = false,
  className,
}: MarqueeProps): JSX.Element {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [reduced, setReduced] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const id = useId();

  useIsomorphicLayoutEffect(() => {
    ensureMarqueeStyle();
    setReduced(prefersReducedMotion());
  }, []);

  useEffect(() => {
    if (!isBrowser() || reduced) return;
    const track = trackRef.current;
    if (!track) return;

    const measure = (): void => {
      // One loop travels translateX(-50%) = exactly one copy plus its trailing
      // gap, so divide half the track width by the px/s speed.
      const distance = track.scrollWidth / 2;
      const pxPerSec = speed > 0 ? speed : 60;
      if (distance > 0) setDuration(distance / pxPerSec);
    };

    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure, { passive: true });
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    for (const child of Array.from(track.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [speed, reduced, children]);

  const classes = className ? `marquee ${className}` : "marquee";
  const animate = !reduced && duration !== null;

  return (
    <div className={classes} data-pause-on-hover={pauseOnHover ? "true" : undefined}>
      <div
        ref={trackRef}
        className="marquee-track"
        data-animate={animate ? "true" : "false"}
        data-reverse={reverse ? "true" : undefined}
        style={animate ? { ["--marquee-duration" as string]: `${duration}s` } : undefined}
      >
        <div className="marquee-copy" key={`${id}-a`}>
          {children}
        </div>
        {!reduced && (
          <div className="marquee-copy" aria-hidden="true" key={`${id}-b`}>
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
