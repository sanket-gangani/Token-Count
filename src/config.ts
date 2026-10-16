import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultFootprint, type FootprintConfig } from "./footprint.js";

export interface UserConfig {
  footprint: FootprintConfig;
  theme?: "dark" | "light";
}

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.TOKENBURN_HOME ?? path.join(os.homedir(), ".tokenburn");
}

export function configPath(env?: NodeJS.ProcessEnv): string {
  return path.join(configDir(env), "config.json");
}

export function loadConfig(env?: NodeJS.ProcessEnv): UserConfig {
  const base: UserConfig = { footprint: structuredClone(defaultFootprint), theme: "dark" };
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(env), "utf8"));
    return mergeConfig(base, raw);
  } catch {
    return base;
  }
}

export function mergeConfig(base: UserConfig, patch: any): UserConfig {
  const out: UserConfig = structuredClone(base);
  if (patch && typeof patch === "object") {
    const fp = patch.footprint;
    if (fp && typeof fp === "object") {
      if (typeof fp.whPerMillionOutputTokens === "number" && fp.whPerMillionOutputTokens >= 0) out.footprint.whPerMillionOutputTokens = fp.whPerMillionOutputTokens;
      if (typeof fp.litersPerKWh === "number" && fp.litersPerKWh >= 0) out.footprint.litersPerKWh = fp.litersPerKWh;
      if (fp.tokenWeights && typeof fp.tokenWeights === "object") {
        for (const k of ["input", "output", "cacheWrite", "cacheRead"] as const) {
          const v = fp.tokenWeights[k];
          if (typeof v === "number" && v >= 0) out.footprint.tokenWeights[k] = v;
        }
      }
    }
    if (patch.theme === "dark" || patch.theme === "light") out.theme = patch.theme;
  }
  return out;
}

export function saveConfig(cfg: UserConfig, env?: NodeJS.ProcessEnv): void {
  const dir = configDir(env);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath(env), JSON.stringify(cfg, null, 2) + "\n");
}
