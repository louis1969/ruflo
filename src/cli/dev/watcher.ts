import { watch, existsSync } from 'fs';
import { join, relative } from 'path';
import type { FSWatcher } from 'fs';

const IGNORED_RE = /node_modules|\.ruflo[/\\]|dist[/\\]|\.git[/\\]/;
const WATCHED_EXTS = new Set(['.ts', '.js', '.json', '.env', '.mjs', '.cjs']);

export interface WatcherOptions {
  dirs:       string[];
  files:      string[];            // explicit extra files to watch
  debounceMs: number;
}

export class FileWatcher {
  private watchers: FSWatcher[]   = [];
  private timer:    ReturnType<typeof setTimeout> | null = null;
  private onChange: (path: string) => void;
  private debounceMs: number;

  constructor(opts: WatcherOptions, onChange: (changedPath: string) => void) {
    this.onChange   = onChange;
    this.debounceMs = opts.debounceMs;
    this.start(opts.dirs, opts.files);
  }

  private start(dirs: string[], files: string[]): void {
    // Watch directories recursively.
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      try {
        const w = watch(dir, { recursive: true }, (_evt, filename) => {
          if (!filename) return;
          if (IGNORED_RE.test(filename)) return;
          const ext = '.' + filename.split('.').pop()!;
          if (!WATCHED_EXTS.has(ext)) return;
          this.debounce(join(dir, filename));
        });
        this.watchers.push(w);
      } catch { /* non-fatal — dir may not support recursive watch */ }
    }

    // Watch explicit files.
    for (const file of files) {
      if (!existsSync(file)) continue;
      try {
        const w = watch(file, () => this.debounce(file));
        this.watchers.push(w);
      } catch { /* non-fatal */ }
    }
  }

  private debounce(path: string): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.onChange(path);
    }, this.debounceMs);
  }

  close(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    for (const w of this.watchers) {
      try { w.close(); } catch { /* ignore */ }
    }
    this.watchers = [];
  }
}

export function relPath(from: string, to: string): string {
  return relative(from, to).replace(/\\/g, '/');
}
