// Local progress store (JSON) + append-only audit log (JSONL).
// The audit log records what the assistant did, never page content.

import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CourseItem } from './course.ts';

export interface ModuleInfo {
  number: number;
  title: string | null;
  itemCount: number;
}

export interface Checkpoint {
  itemId: string | null;
  state: string;
  at: string;
}

export interface Progress {
  version: 1;
  courseSlug: string;
  syncedAt: string | null;
  modules: ModuleInfo[];
  items: CourseItem[];
  checkpoint: Checkpoint | null;
}

export type OutlineItem = Omit<CourseItem, 'localStatus' | 'sourcePath' | 'notesPath'>;

export function emptyProgress(courseSlug: string): Progress {
  return { version: 1, courseSlug, syncedAt: null, modules: [], items: [], checkpoint: null };
}

/** Fresh outline wins for everything Coursera owns; local study data is kept. */
export function mergeOutline(existing: CourseItem[], fresh: OutlineItem[]): CourseItem[] {
  const byId = new Map(existing.map((item) => [item.id, item]));
  return fresh.map((item) => {
    const previous = byId.get(item.id);
    return {
      ...item,
      localStatus: previous?.localStatus ?? 'new',
      sourcePath: previous?.sourcePath ?? null,
      notesPath: previous?.notesPath ?? null,
    };
  });
}

export function sortItems(items: CourseItem[]): CourseItem[] {
  return [...items].sort((a, b) => a.module - b.module || a.order - b.order);
}

export function isOpen(item: CourseItem): boolean {
  return !item.locked && !item.courseraCompleted && item.localStatus === 'new';
}

export function pickNextItem(items: CourseItem[]): CourseItem | null {
  return sortItems(items).find(isOpen) ?? null;
}

/** Resume at the checkpointed item while it is still open, else the next open one. */
export function resumeTarget(progress: Progress): CourseItem | null {
  const checkpointed = progress.items.find((item) => item.id === progress.checkpoint?.itemId);
  if (checkpointed && isOpen(checkpointed)) return checkpointed;
  return pickNextItem(progress.items);
}

export class ProgressStore {
  readonly filePath: string;
  data: Progress;

  private constructor(filePath: string, data: Progress) {
    this.filePath = filePath;
    this.data = data;
  }

  static async open(filePath: string, courseSlug: string): Promise<ProgressStore> {
    try {
      const data = JSON.parse(await readFile(filePath, 'utf8')) as Progress;
      if (data.version !== 1 || data.courseSlug !== courseSlug) {
        throw new Error(`Progress file ${filePath} belongs to another course/version`);
      }
      return new ProgressStore(filePath, data);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return new ProgressStore(filePath, emptyProgress(courseSlug));
      }
      throw error;
    }
  }

  hasOutline(): boolean {
    return this.data.items.length > 0;
  }

  find(id: string): CourseItem | undefined {
    return this.data.items.find((item) => item.id === id);
  }

  applyOutline(modules: ModuleInfo[], fresh: OutlineItem[]): void {
    this.data.items = mergeOutline(this.data.items, fresh);
    this.data.modules = modules;
    this.data.syncedAt = new Date().toISOString();
  }

  /** Insert an item seen in the browser that the last sync did not know about. */
  upsert(item: CourseItem): CourseItem {
    const existing = this.find(item.id);
    if (existing) return existing;
    this.data.items.push(item);
    return item;
  }

  update(id: string, patch: Partial<CourseItem>): void {
    const item = this.find(id);
    if (item) Object.assign(item, patch);
  }

  setCheckpoint(itemId: string | null, state: string): void {
    this.data.checkpoint = { itemId, state, at: new Date().toISOString() };
  }

  async save(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
    await rename(tmp, this.filePath);
  }
}

export class AuditLog {
  readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async log(event: string, detail: Record<string, unknown> = {}): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify({ ts: new Date().toISOString(), event, ...detail })}\n`, 'utf8');
  }
}
