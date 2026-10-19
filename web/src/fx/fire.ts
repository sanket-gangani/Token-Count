import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Control handle returned by {@link mountFire}.
 */
export interface FireHandle {
  /** Set the target flame intensity (0..1). The visible value springs toward it. */
  setIntensity(v: number): void;
  /** Trigger a transient surge that decays over ~1.6s. `strength` defaults to 1. */
  burst(strength?: number): void;
  /** Tear down observers, the render loop and the WebGL context. */
  destroy(): void;
}

/**
 * Options accepted by {@link mountFire}.
 */
export interface FireOptions {
  /** Initial flame intensity (0..1). Defaults to 1. */
  intensity?: number;
  /** RGB multiplier applied to the colour ramp. Defaults to [1, 1, 1]. */
  tint?: [number, number, number];
}

const VERTEX_SHADER = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// highp keeps u_time and the hash stable over long sessions; mediump (10-bit
// mantissa on some mobile GPUs) would make the flames stutter after minutes.
const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform float u_time;
uniform vec2 u_res;
uniform float u_intensity;
uniform float u_burst;
uniform vec3 u_tint;

float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  v += amp * vnoise(p); p *= 2.02; amp *= 0.5;
  v += amp * vnoise(p); p *= 2.03; amp *= 0.5;
  v += amp * vnoise(p); p *= 2.01; amp *= 0.5;
  v += amp * vnoise(p); p *= 2.04; amp *= 0.5;
  v += amp * vnoise(p);
  return v;
}

float fbm3(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  v += amp * vnoise(p); p *= 2.02; amp *= 0.5;
  v += amp * vnoise(p); p *= 2.03; amp *= 0.5;
  v += amp * vnoise(p);
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;

  float drive = clamp(u_intensity + u_burst * 0.6, 0.0, 1.4);
  float speed = 0.45 + drive * 0.75;

  float height = 0.12 + drive * 0.43;
  if (uv.y > height * 1.35) { gl_FragColor = vec4(0.0); return; }

  vec2 p = vec2(uv.x * aspect * 3.0, uv.y * 3.0 - u_time * speed);
  vec2 warp = vec2(
    fbm3(p * 0.7 + vec2(0.0, u_time * 0.25)),
    fbm3(p * 0.7 + vec2(5.2, 1.3 - u_time * 0.2))
  );
  float turb = 0.35 + drive * 0.45;
  float n = fbm(p + (warp - 0.5) * turb * 2.0);

  float edge = uv.y / max(height, 0.001);
  float grad = 1.0 - smoothstep(0.0, 1.0, edge);
  float base = smoothstep(0.0, 0.08, uv.y) * 0.3 + 0.7;

  float flame = n * (1.1 + drive * 0.5) * grad * base - edge * 0.25;
  flame = clamp(flame, 0.0, 1.0);

  // Warm ramp: dark red -> ember -> orange -> gold. No pale tips: a pale
  // yellow dimmed by the page vignette reads as grey smoke, not flame.
  vec3 deep = vec3(0.36, 0.03, 0.0);
  vec3 ember = vec3(1.0, 0.30, 0.04);
  vec3 hot = vec3(1.0, 0.56, 0.10);
  vec3 tip = vec3(1.0, 0.80, 0.36);
  vec3 col = mix(deep, ember, smoothstep(0.22, 0.55, flame));
  col = mix(col, hot, smoothstep(0.55, 0.80, flame));
  col = mix(col, tip, smoothstep(0.86, 1.0, flame));
  // Surges brighten the flame but are capped at gold: letting green clip
  // alongside red turns the hottest cores lime.
  col = min(col * u_tint * (1.0 + drive * 0.25), vec3(1.0, 0.8, 0.46));

  float alpha = smoothstep(0.18, 0.74, flame);
  alpha *= 1.0 - smoothstep(0.75, 1.0, edge);

  gl_FragColor = vec4(col * alpha, alpha);
}
`;

let warned = false;

function warnOnce(message: string, detail?: string | null): void {
  if (warned) {
    return;
  }
  warned = true;
  console.warn(`[fire] ${message}`, detail ?? "");
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) {
    warnOnce("createShader failed");
    return null;
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    warnOnce("shader compile failed", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vs || !fs) {
    if (vs) {
      gl.deleteShader(vs);
    }
    if (fs) {
      gl.deleteShader(fs);
    }
    return null;
  }
  const program = gl.createProgram();
  if (!program) {
    warnOnce("createProgram failed");
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    warnOnce("program link failed", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0;
}

const BURST_DURATION_MS = 1600;
/** Angular frequency for a critically damped spring settling in roughly 0.6s. */
const SPRING_OMEGA = 10;

/** GL objects that must be rebuilt whenever the context is (re)created. */
interface GlResources {
  program: WebGLProgram;
  buffer: WebGLBuffer;
  uTime: WebGLUniformLocation | null;
  uRes: WebGLUniformLocation | null;
  uIntensity: WebGLUniformLocation | null;
  uBurst: WebGLUniformLocation | null;
}

/**
 * `getExtension` may return null on a lost context, so remember the
 * WEBGL_lose_context extension per canvas. A remount on a canvas whose
 * context was lost by `destroy()` (React StrictMode) needs it to restore.
 */
const loseExtensions = new WeakMap<HTMLCanvasElement, WEBGL_lose_context>();

/**
 * Mount a WebGL fire effect on a canvas.
 *
 * Returns `null` when WebGL is unavailable or the shaders fail to build,
 * so callers can fall back to hiding the canvas.
 */
export function mountFire(canvas: HTMLCanvasElement, opts: FireOptions = {}): FireHandle | null {
  if (typeof window === "undefined") {
    return null;
  }

  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
    }) as WebGLRenderingContext | null;
  } catch {
    gl = null;
  }
  if (!gl) {
    return null;
  }
  const ctx: WebGLRenderingContext = gl;

  const loseExt =
    loseExtensions.get(canvas) ?? (ctx.getExtension("WEBGL_lose_context") as WEBGL_lose_context | null);
  if (loseExt) {
    loseExtensions.set(canvas, loseExt);
  }

  const tint = opts.tint ?? [1, 1, 1];
  const reducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let res: GlResources | null = null;
  let target = clamp01(opts.intensity ?? 1);
  let current = reducedMotion ? target : 0;
  let velocity = 0;
  let burstStart = -Infinity;
  let burstStrength = 0;
  let destroyed = false;
  let frame = 0;
  let lastTs = 0;
  let visible = true;
  let hidden = typeof document !== "undefined" && document.hidden;
  let sizeDirty = true;
  let restoreTimer = 0;
  const startTime = performance.now();

  function build(): boolean {
    const program = createProgram(ctx);
    if (!program) {
      return false;
    }
    const buffer = ctx.createBuffer();
    if (!buffer) {
      warnOnce("createBuffer failed");
      ctx.deleteProgram(program);
      return false;
    }
    ctx.bindBuffer(ctx.ARRAY_BUFFER, buffer);
    ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), ctx.STATIC_DRAW);

    ctx.useProgram(program);
    const aPos = ctx.getAttribLocation(program, "a_pos");
    ctx.enableVertexAttribArray(aPos);
    ctx.vertexAttribPointer(aPos, 2, ctx.FLOAT, false, 0, 0);

    ctx.uniform3f(ctx.getUniformLocation(program, "u_tint"), tint[0], tint[1], tint[2]);
    ctx.disable(ctx.DEPTH_TEST);
    ctx.disable(ctx.BLEND);
    ctx.clearColor(0, 0, 0, 0);
    ctx.viewport(0, 0, canvas.width, canvas.height);

    res = {
      program,
      buffer,
      uTime: ctx.getUniformLocation(program, "u_time"),
      uRes: ctx.getUniformLocation(program, "u_res"),
      uIntensity: ctx.getUniformLocation(program, "u_intensity"),
      uBurst: ctx.getUniformLocation(program, "u_burst"),
    };
    return true;
  }

  function release(): void {
    if (res) {
      ctx.deleteBuffer(res.buffer);
      ctx.deleteProgram(res.program);
      res = null;
    }
  }

  function resize(): boolean {
    if (!sizeDirty) {
      return false;
    }
    sizeDirty = false;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * 0.6;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      ctx.viewport(0, 0, w, h);
      return true;
    }
    return false;
  }

  function burstValue(now: number): number {
    const t = (now - burstStart) / BURST_DURATION_MS;
    if (t < 0 || t >= 1) {
      return 0;
    }
    const eased = 1 - (1 - t) * (1 - t) * (1 - t);
    return burstStrength * (1 - eased);
  }

  function step(dt: number): void {
    if (dt <= 0) {
      return;
    }
    const d = current - target;
    const accel = -SPRING_OMEGA * SPRING_OMEGA * d - 2 * SPRING_OMEGA * velocity;
    velocity += accel * dt;
    current += velocity * dt;
    if (Math.abs(current - target) < 0.0005 && Math.abs(velocity) < 0.0005) {
      current = target;
      velocity = 0;
    }
  }

  function draw(now: number): void {
    if (!res || ctx.isContextLost()) {
      return;
    }
    resize();
    ctx.clear(ctx.COLOR_BUFFER_BIT);
    ctx.uniform1f(res.uTime, (now - startTime) / 1000);
    ctx.uniform2f(res.uRes, canvas.width, canvas.height);
    ctx.uniform1f(res.uIntensity, clamp01(current));
    ctx.uniform1f(res.uBurst, burstValue(now));
    ctx.drawArrays(ctx.TRIANGLES, 0, 3);
  }

  function shouldRun(): boolean {
    return !destroyed && !reducedMotion && visible && !hidden && res !== null;
  }

  function loop(ts: number): void {
    frame = 0;
    if (!shouldRun()) {
      return;
    }
    const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.1) : 0;
    lastTs = ts;
    step(dt);
    draw(ts);
    frame = requestAnimationFrame(loop);
  }

  function start(): void {
    if (frame || !shouldRun()) {
      return;
    }
    lastTs = 0;
    frame = requestAnimationFrame(loop);
  }

  function stop(): void {
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  }

  function renderOnce(): void {
    if (destroyed) {
      return;
    }
    current = target;
    velocity = 0;
    draw(performance.now());
  }

  function run(): void {
    if (reducedMotion) {
      renderOnce();
    } else {
      start();
    }
  }

  const onVisibility = (): void => {
    hidden = document.hidden;
    if (hidden) {
      stop();
    } else {
      start();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  // Browsers only allow restoreContext() after the lost event was
  // default-prevented and dispatched, so the restore request is deferred.
  const onContextLost = (event: Event): void => {
    event.preventDefault();
    stop();
    res = null;
    if (loseExt && !restoreTimer) {
      restoreTimer = window.setTimeout(() => {
        restoreTimer = 0;
        if (!destroyed) {
          loseExt.restoreContext();
        }
      }, 0);
    }
  };
  const onContextRestored = (): void => {
    if (destroyed) {
      return;
    }
    sizeDirty = true;
    if (build()) {
      run();
    }
  };
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);

  function teardown(): void {
    document.removeEventListener("visibilitychange", onVisibility);
    canvas.removeEventListener("webglcontextlost", onContextLost);
    canvas.removeEventListener("webglcontextrestored", onContextRestored);
    if (restoreTimer) {
      clearTimeout(restoreTimer);
      restoreTimer = 0;
    }
  }

  if (ctx.isContextLost()) {
    // Remount on a canvas whose context a previous destroy() lost (StrictMode).
    if (!loseExt) {
      teardown();
      return null;
    }
    loseExt.restoreContext();
  } else if (!build()) {
    teardown();
    return null;
  }

  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      sizeDirty = true;
      if (resize() && reducedMotion) {
        renderOnce();
      }
    });
    resizeObserver.observe(canvas);
  }

  let intersectionObserver: IntersectionObserver | null = null;
  if (typeof IntersectionObserver !== "undefined") {
    intersectionObserver = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) {
        return;
      }
      visible = entry.isIntersecting;
      if (visible) {
        start();
      } else {
        stop();
      }
    });
    intersectionObserver.observe(canvas);
  }

  resize();
  run();

  return {
    setIntensity(v: number): void {
      target = clamp01(v);
      run();
    },
    burst(strength = 1): void {
      if (reducedMotion) {
        return;
      }
      burstStrength = clamp01(strength);
      burstStart = performance.now();
      start();
    },
    destroy(): void {
      if (destroyed) {
        return;
      }
      destroyed = true;
      stop();
      teardown();
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      release();
      if (loseExt && !ctx.isContextLost()) {
        // Allow a later mount on the same canvas to restore the context.
        canvas.addEventListener("webglcontextlost", (event) => event.preventDefault(), { once: true });
        loseExt.loseContext();
      }
    },
  };
}

/**
 * React hook that mounts {@link mountFire} on a canvas ref, keeps intensity
 * in sync with the prop and destroys the effect on unmount.
 *
 * Returns a stable `burst` function and `supported`, which becomes `false`
 * when WebGL is unavailable so the caller can hide the canvas.
 */
export function useFire(
  ref: React.RefObject<HTMLCanvasElement | null>,
  intensity: number,
): { burst: (strength?: number) => void; supported: boolean } {
  const handleRef = useRef<FireHandle | null>(null);
  const intensityRef = useRef(intensity);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) {
      setSupported(false);
      return;
    }
    const handle = mountFire(canvas, { intensity: intensityRef.current });
    handleRef.current = handle;
    setSupported(handle !== null);
    return () => {
      handle?.destroy();
      handleRef.current = null;
    };
  }, [ref]);

  useEffect(() => {
    intensityRef.current = intensity;
    handleRef.current?.setIntensity(intensity);
  }, [intensity]);

  const burst = useCallback((strength?: number) => {
    handleRef.current?.burst(strength);
  }, []);

  return { burst, supported };
}
