import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface DiscoverOptions {
  /** explicit --dir override; can be the projects dir or the .claude dir */
  dir?: string;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
}

/** Resolve the directory that holds per-project transcript folders. */
export function resolveProjectsDir(opts: DiscoverOptions = {}): string {
  const env = opts.env ?? process.env;
  const home = opts.homedir ?? os.homedir();
  let base: string;
  if (opts.dir) {
    base = path.resolve(opts.dir);
  } else if (env.CLAUDE_CONFIG_DIR) {
    base = path.resolve(env.CLAUDE_CONFIG_DIR);
  } else {
    base = path.join(home, ".claude");
  }
  // Accept either ~/.claude or ~/.claude/projects.
  if (path.basename(base) === "projects") return base;
  return path.join(base, "projects");
}

/** Recursively list every .jsonl file under the projects dir. */
export function listJsonlFiles(projectsDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(p);
    }
  };
  walk(projectsDir);
  return out.sort();
}

/** The project key is the first folder under projects/. */
export function projectKeyForFile(projectsDir: string, file: string): string {
  const rel = path.relative(projectsDir, file);
  const first = rel.split(path.sep)[0];
  return first && first !== ".." ? first : "unknown";
}

/** Best-effort pretty label from the encoded folder name (used when no cwd is known). */
export function labelFromProjectKey(key: string): string {
  const trimmed = key.replace(/^-+/, "");
  const parts = trimmed.split("-");
  return parts.length > 1 ? parts.slice(-2).join("-") : trimmed;
}
