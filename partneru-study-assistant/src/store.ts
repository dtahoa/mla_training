// Local progress store: .data/programs/<id>/progress.json. Holds the last
// synced outline and what the tool saw per card (title, kind, whether its text
// is saved to notes). Written atomically (temp file + rename).

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ProgramOutline } from './program.ts';

export type CardKind = 'CONTENT' | 'VIDEO' | 'EXERCISE';

export interface CardRecord {
  courseId: string;
  /** Language edition the card belongs to (/s/<edition>/…); lets backfill open the card directly. */
  editionId?: string;
  /** Position in the course ("3/37"). */
  position: number | null;
  total: number | null;
  title: string;
  kind: CardKind;
  /** Card text saved to the course's notes file. */
  captured: boolean;
  /** You finished it on PartnerU (Sana marked it completed). */
  completed: boolean;
  seenAt: string;
}

export interface ProgressData {
  programId: string;
  syncedAt: string | null;
  outline: ProgramOutline | null;
  cards: Record<string, CardRecord>;
}

export class ProgressStore {
  readonly filePath: string;
  data: ProgressData;

  private constructor(filePath: string, data: ProgressData) {
    this.filePath = filePath;
    this.data = data;
  }

  static async open(filePath: string, programId: string): Promise<ProgressStore> {
    try {
      const data = JSON.parse(await readFile(filePath, 'utf8')) as ProgressData;
      if (data.programId === programId) return new ProgressStore(filePath, { ...data, cards: data.cards ?? {} });
    } catch {
      // first run, or unreadable file: start fresh
    }
    return new ProgressStore(filePath, { programId, syncedAt: null, outline: null, cards: {} });
  }

  setOutline(outline: ProgramOutline): void {
    this.data.outline = outline;
    this.data.syncedAt = new Date().toISOString();
  }

  card(cardId: string): CardRecord | undefined {
    return this.data.cards[cardId];
  }

  upsertCard(cardId: string, record: Omit<CardRecord, 'seenAt' | 'captured' | 'completed'> & Partial<CardRecord>): CardRecord {
    const previous = this.data.cards[cardId];
    const next: CardRecord = {
      captured: false,
      completed: false,
      ...previous,
      ...record,
      seenAt: new Date().toISOString(),
    };
    this.data.cards[cardId] = next;
    return next;
  }

  async save(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    await writeFile(temp, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
    await rename(temp, this.filePath);
  }
}
