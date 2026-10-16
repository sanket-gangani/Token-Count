export function fmtTokens(n: number): string {
  const abs = Math.abs(n);
  if (abs < 1000) return String(Math.round(n));
  if (abs < 1e6) return (n / 1e3).toFixed(abs < 1e4 ? 1 : 0) + "K";
  if (abs < 1e9) return (n / 1e6).toFixed(abs < 1e7 ? 2 : 1) + "M";
  return (n / 1e9).toFixed(2) + "B";
}

export function fmtUSD(n: number): string {
  if (n < 0.01 && n > 0) return "<$0.01";
  if (n >= 1000) return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return "$" + n.toFixed(2);
}

export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function fmtWh(wh: number): string {
  if (wh < 1000) return `${wh.toFixed(wh < 10 ? 2 : 0)} Wh`;
  if (wh < 1e6) return `${(wh / 1000).toFixed(2)} kWh`;
  return `${(wh / 1e6).toFixed(2)} MWh`;
}

export function fmtLiters(l: number): string {
  if (l < 1) return `${(l * 1000).toFixed(0)} mL`;
  if (l < 1000) return `${l.toFixed(1)} L`;
  return `${(l / 1000).toFixed(2)} m³`;
}

const useColor = () => process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code: string) => (s: string) => (useColor() ? `\x1b[${code}m${s}\x1b[0m` : s);
export const c = {
  bold: wrap("1"),
  dim: wrap("2"),
  ember: wrap("38;5;208"),
  blue: wrap("38;5;75"),
  green: wrap("38;5;114"),
  gray: wrap("38;5;245"),
};
