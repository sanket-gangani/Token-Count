/** Shared by CLI and dashboard. No JSON imports here so the browser bundle stays simple. */
export function normalizeModel(id: string): string {
  let m = id.trim().toLowerCase();
  m = m.replace(/^(?:us|eu|apac|global)\./, "").replace(/^anthropic\./, "");
  m = m.replace(/\[1m\]$/, "");
  m = m.replace(/-v\d+:\d+$/, "");
  m = m.replace(/@\d{8}$/, "");
  m = m.replace(/-\d{8}$/, "");
  m = m.replace(/-\d{4}-\d{2}-\d{2}$/, ""); // OpenAI snapshots: gpt-5-2025-08-07
  m = m.replace(/-latest$/, "");
  return m;
}

/** Short human label for a model id: claude-opus-5-5 -> Opus 5.5 */
export function modelLabel(id: string): string {
  const n = normalizeModel(id);
  const m = n.match(/^claude-(?:(\d+)-(\d+)-)?([a-z]+)(?:-(\d+)(?:-(\d+))?)?$/);
  if (!m) return id;
  const family = m[3].charAt(0).toUpperCase() + m[3].slice(1);
  const major = m[4] ?? m[1];
  const minor = m[5] ?? m[2];
  if (!major) return family;
  return `${family} ${major}${minor ? "." + minor : ""}`;
}
