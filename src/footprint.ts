import footprintJson from "./footprint.json" with { type: "json" };
import type { TokenTotals } from "./types.js";

export interface FootprintConfig {
  whPerMillionOutputTokens: number;
  tokenWeights: { input: number; output: number; cacheWrite: number; cacheRead: number };
  litersPerKWh: number;
}

export const defaultFootprint: FootprintConfig = {
  whPerMillionOutputTokens: footprintJson.whPerMillionOutputTokens,
  tokenWeights: { ...footprintJson.tokenWeights },
  litersPerKWh: footprintJson.litersPerKWh,
};

export const footprintSources = footprintJson.sources;

/** Watt-hours, weighting each token kind relative to an output token. */
export function energyWh(t: TokenTotals, cfg: FootprintConfig = defaultFootprint): number {
  const w = cfg.tokenWeights;
  const weighted = t.input * w.input + t.output * w.output + t.cacheWrite * w.cacheWrite + t.cacheRead * w.cacheRead;
  return (weighted / 1_000_000) * cfg.whPerMillionOutputTokens;
}

export function waterLiters(wh: number, cfg: FootprintConfig = defaultFootprint): number {
  return (wh / 1000) * cfg.litersPerKWh;
}

export interface LadderUnit {
  id: string;
  singular: string;
  plural: string;
  /** size of one unit in the base measure (liters or Wh) */
  size: number;
  quip: string;
}

/** Water ladder, in liters. Playful on purpose; sizes are everyday approximations. */
export const waterLadder: LadderUnit[] = [
  { id: "sip", singular: "sip", plural: "sips", size: 0.015, quip: "Barely wet your lips." },
  { id: "cup", singular: "cup of water", plural: "cups of water", size: 0.25, quip: "One cup. The kettle used more." },
  { id: "bottle", singular: "water bottle", plural: "water bottles", size: 0.5, quip: "Gym-bag sized. Respectable." },
  { id: "bucket", singular: "bucket", plural: "buckets", size: 10, quip: "Enough to mop the floor. You shipped a feature instead." },
  { id: "bathtub", singular: "bathtub", plural: "bathtubs", size: 150, quip: "A long soak. Several of them were refactors." },
  { id: "hot-tub", singular: "hot tub", plural: "hot tubs", size: 1500, quip: "A hot tub. Bubbles not included." },
  { id: "pool", singular: "backyard pool", plural: "backyard pools", size: 50_000, quip: "A backyard pool. Nobody swam." },
  { id: "olympic", singular: "Olympic pool", plural: "Olympic pools", size: 2_500_000, quip: "An Olympic pool. No medals." },
  { id: "lake", singular: "small lake", plural: "small lakes", size: 100_000_000, quip: "A small lake. Congratulations, probably." },
];

/** Energy ladder, in watt-hours. */
export const energyLadder: LadderUnit[] = [
  { id: "led-minute", singular: "LED-bulb minute", plural: "LED-bulb minutes", size: 0.15, quip: "A flicker." },
  { id: "phone", singular: "phone charge", plural: "phone charges", size: 12, quip: "Your phone would have been full." },
  { id: "laptop-hour", singular: "laptop hour", plural: "laptop hours", size: 50, quip: "Enough to run the laptop that asked." },
  { id: "microwave", singular: "microwave dinner", plural: "microwave dinners", size: 200, quip: "Ding." },
  { id: "dishwasher", singular: "dishwasher cycle", plural: "dishwasher cycles", size: 1500, quip: "Sparkling clean. Sparkling expensive." },
  { id: "home-day", singular: "household-day of electricity", plural: "household-days of electricity", size: 30_000, quip: "A whole house, for a whole day." },
  { id: "ev-cross-country", singular: "EV coast-to-coast trip", plural: "EV coast-to-coast trips", size: 900_000, quip: "Road trip, but it never left the terminal." },
];

export interface LadderReading {
  unit: LadderUnit;
  count: number;
  /** "≈ 3.2 bathtubs" */
  text: string;
  quip: string;
  /** index into the ladder */
  stage: number;
}

export function readLadder(value: number, ladder: LadderUnit[]): LadderReading {
  let stage = 0;
  for (let i = 0; i < ladder.length; i++) {
    if (value >= ladder[i].size) stage = i;
  }
  const unit = ladder[stage];
  const count = value / unit.size;
  const n = count >= 100 ? Math.round(count).toLocaleString("en-US") : count >= 10 ? count.toFixed(0) : count.toFixed(1);
  const label = Math.abs(count - 1) < 0.05 ? unit.singular : unit.plural;
  return { unit, count, text: `≈ ${n} ${label}`, quip: unit.quip, stage };
}

export const describeWater = (liters: number) => readLadder(liters, waterLadder);
export const describeEnergy = (wh: number) => readLadder(wh, energyLadder);

/**
 * Lake level 1 (full) -> 0 (empty) on a log scale from one sip to one small lake,
 * so the water visibly moves from the first session and bottoms out at "a small lake".
 */
export function lakeLevel(liters: number): number {
  const lo = Math.log10(waterLadder[0].size);
  const hi = Math.log10(waterLadder[waterLadder.length - 1].size);
  if (liters <= waterLadder[0].size) return 1;
  const p = (Math.log10(liters) - lo) / (hi - lo);
  return Math.max(0, Math.min(1, 1 - p));
}

export interface Footprint {
  wh: number;
  liters: number;
  water: LadderReading;
  energy: LadderReading;
  lakeLevel: number;
  config: FootprintConfig;
}

export function footprintOf(t: TokenTotals, cfg: FootprintConfig = defaultFootprint): Footprint {
  const wh = energyWh(t, cfg);
  const liters = waterLiters(wh, cfg);
  return { wh, liters, water: describeWater(liters), energy: describeEnergy(wh), lakeLevel: lakeLevel(liters), config: cfg };
}
