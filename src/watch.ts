import chokidar, { type FSWatcher } from "chokidar";

export interface Watcher {
  close(): Promise<void>;
}

/**
 * Watch the projects directory for new/changed .jsonl files. Calls `onChange`
 * per file, debounced so a burst of appends becomes one re-tail.
 */
export function watchProjects(projectsDir: string, onChange: (file: string) => void, debounceMs = 150): Watcher {
  const timers = new Map<string, NodeJS.Timeout>();
  const schedule = (file: string) => {
    if (!file.endsWith(".jsonl")) return;
    const t = timers.get(file);
    if (t) clearTimeout(t);
    timers.set(
      file,
      setTimeout(() => {
        timers.delete(file);
        onChange(file);
      }, debounceMs),
    );
  };
  const w: FSWatcher = chokidar.watch(projectsDir, {
    ignoreInitial: true,
    persistent: true,
    ignored: (p, stats) => !!stats && stats.isFile() && !p.endsWith(".jsonl"),
    awaitWriteFinish: false,
  });
  w.on("add", schedule).on("change", schedule);
  return {
    close: async () => {
      for (const t of timers.values()) clearTimeout(t);
      await w.close();
    },
  };
}
