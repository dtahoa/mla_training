// Course notes: the text of every content / video card you go through, one
// Markdown file per course (.data/programs/<id>/notes/01-<course>.md). Used
// later for AI summaries and review. Exercise cards are never saved.

import { appendFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config.ts';
import type { CardInfo } from './card.ts';
import type { ProgramStep } from './program.ts';

export function slugify(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'course'
  );
}

export function notesFile(config: Config, step: Pick<ProgramStep, 'index' | 'title'>): string {
  return path.join(config.notesDir, `${String(step.index).padStart(2, '0')}-${slugify(step.title)}.md`);
}

export function noteSection(card: Pick<CardInfo, 'title' | 'position' | 'total'>, text: string): string {
  const where = card.position ? ` (${card.position}/${card.total ?? '?'})` : '';
  return `\n## ${card.title}${where}\n\n${text.trim()}\n`;
}

export async function appendCardNote(file: string, courseTitle: string, card: CardInfo, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const exists = await stat(file).then(
    () => true,
    () => false,
  );
  const header = exists ? '' : `# ${courseTitle}\n\nGhi chú tự động từ các thẻ bài học (không gồm knowledge check / exam).\n`;
  await appendFile(file, header + noteSection(card, text), 'utf8');
}
