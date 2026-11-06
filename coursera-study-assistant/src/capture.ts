// Capture study material (video transcript, reading text) into local notes.
// Every capture re-checks the guard against the URL the browser is on *right
// now*, so content of an assessment page is never read even if the learner
// navigated there between commands.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';
import { COURSERA_ORIGIN, type Config } from './config.ts';
import { classifyItem, itemDisplayType, parseItemPath, type CourseItem } from './course.ts';
import { guardFor } from './guard.ts';

export interface CaptureResult {
  method: string;
  text: string;
}

// ---------- pure helpers ----------

export function vttToText(vtt: string): string {
  const lines = vtt.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line === 'WEBVTT' || /^(NOTE|STYLE|REGION)\b/.test(line)) continue;
    if (/^\d+$/.test(line)) continue; // cue number
    if (/-->/.test(line)) continue; // timing line
    const text = line.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    if (text && out[out.length - 1] !== text) out.push(text);
  }
  return joinSentences(out);
}

/** Captions arrive as short fragments; join them into readable paragraphs. */
function joinSentences(fragments: string[]): string {
  const paragraphs: string[] = [];
  let current = '';
  for (const fragment of fragments) {
    current = current ? `${current} ${fragment}` : fragment;
    if (/[.!?]["')\]]?$/.test(fragment) && current.length > 400) {
      paragraphs.push(current);
      current = '';
    }
  }
  if (current) paragraphs.push(current);
  return paragraphs.join('\n\n');
}

const UI_NOISE = [
  /^mark as completed$/i,
  /^completed$/i,
  /^go to next item$/i,
  /^(like|dislike|report an issue|save note|share|transcript|notes|files|downloads)$/i,
  /^interactive transcript.*$/i,
  /^play video starting at .*$/i,
];

export function cleanPageText(text: string): string {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim());
  const kept: string[] = [];
  for (const line of lines) {
    if (UI_NOISE.some((pattern) => pattern.test(line))) continue;
    if (!line && (kept.length === 0 || kept[kept.length - 1] === '')) continue;
    kept.push(line);
  }
  return kept.join('\n').trim();
}

const AI_START = '<!-- ai-notes:start -->';
const AI_END = '<!-- ai-notes:end -->';

/** Replace (or append) the AI section of a notes file, keeping the learner's own notes. */
export function upsertAiSection(markdown: string, aiMarkdown: string): string {
  const block = `${AI_START}\n${aiMarkdown.trim()}\n${AI_END}`;
  const start = markdown.indexOf(AI_START);
  const end = markdown.indexOf(AI_END);
  if (start !== -1 && end > start) {
    return `${markdown.slice(0, start)}${block}${markdown.slice(end + AI_END.length)}`;
  }
  return `${markdown.trimEnd()}\n\n${block}\n`;
}

export function slugify(text: string, max = 60): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/, '') || 'item'
  );
}

export function notesFileFor(config: Config, item: CourseItem): string {
  const moduleDir = `module-${String(item.module).padStart(2, '0')}`;
  const file = `${String(item.order).padStart(2, '0')}-${slugify(item.title)}.md`;
  return path.join(config.notesDir, moduleDir, file);
}

export function sourceFileFor(config: Config, item: CourseItem): string {
  return path.join(config.sourcesDir, `m${String(item.module).padStart(2, '0')}-${item.id}.txt`);
}

// ---------- browser capture ----------

export class GuardBlockedError extends Error {}

/** Throws unless the page the browser shows right now is this item and the guard allows reading it. */
export function assertCaptureAllowed(pageUrl: string, item: CourseItem): void {
  const ref = parseItemPath(pageUrl);
  if (!ref || ref.id !== item.id) {
    throw new GuardBlockedError('Trang trên Chrome không còn là item này. Bấm [f] để cập nhật item hiện tại.');
  }
  // Re-derive the kind from the live URL as well as the stored item; the stricter one wins.
  const liveKind = classifyItem(ref.segment, item.typeLabel);
  if (!guardFor(liveKind).allowCapture || !guardFor(item.kind).allowCapture) {
    throw new GuardBlockedError(`Guard chặn capture cho loại ${item.kind}: assistant không đọc nội dung bài này.`);
  }
}

async function transcriptFromTrack(page: Page): Promise<string | null> {
  const vtt = await page.evaluate(async () => {
    const tracks = [...document.querySelectorAll<HTMLTrackElement>('video track')].filter((t) => t.src);
    const pick = tracks.find((t) => /^en/i.test(t.srclang)) ?? tracks[0];
    if (!pick) return null;
    const response = await fetch(pick.src, { credentials: 'include' });
    return response.ok ? response.text() : null;
  });
  // Validate by format, not length: a short transcript is still a transcript,
  // while an HTML error page served with 200 is not.
  if (!vtt || !/^﻿?WEBVTT/.test(vtt)) return null;
  return vttToText(vtt) || null;
}

async function transcriptFromPanel(page: Page): Promise<string | null> {
  const opener = page.getByRole('button', { name: /transcript/i }).or(page.getByRole('tab', { name: /transcript/i }));
  if (await opener.count()) {
    await opener.first().click().catch(() => undefined);
    await page.waitForTimeout(1500);
  }
  const text = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll<HTMLElement>('[class*="transcript" i], [data-testid*="transcript" i], [aria-label*="transcript" i]')];
    const best = candidates.map((el) => el.innerText ?? '').sort((a, b) => b.length - a.length)[0];
    return best && best.length > 200 ? best : null;
  });
  return text ? cleanPageText(text) : null;
}

async function readingText(page: Page): Promise<string | null> {
  const text = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>('main, [role="main"]') ?? document.body;
    const candidates = [...main.querySelectorAll<HTMLElement>('.rc-CML, [data-testid*="cml" i], [class*="cml" i], article')];
    const best = candidates.map((el) => el.innerText ?? '').sort((a, b) => b.length - a.length)[0];
    return best && best.length > 200 ? best : main.innerText;
  });
  const cleaned = text ? cleanPageText(text) : '';
  return cleaned.length > 100 ? cleaned : null;
}

export async function captureFromPage(page: Page, item: CourseItem): Promise<CaptureResult> {
  assertCaptureAllowed(page.url(), item);
  if (item.kind === 'VIDEO') {
    const fromTrack = await transcriptFromTrack(page).catch(() => null);
    if (fromTrack) return { method: 'video-captions-track', text: fromTrack };
    const fromPanel = await transcriptFromPanel(page).catch(() => null);
    if (fromPanel) return { method: 'transcript-panel', text: fromPanel };
    throw new Error('Không tìm thấy transcript (track/panel). Chạy `npm run probe` và gửi báo cáo để chỉnh selector.');
  }
  const text = await readingText(page);
  if (!text) throw new Error('Không đọc được nội dung reading. Chạy `npm run probe` để kiểm tra selector.');
  return { method: 'reading-main-content', text };
}

// ---------- local files ----------

function notesTemplate(item: CourseItem, moduleTitle: string | null): string {
  return [
    `# ${item.title}`,
    '',
    `- Module ${item.module}${moduleTitle ? ` — ${moduleTitle}` : ''}`,
    `- Loại: ${itemDisplayType(item)}${item.minutes ? ` (${item.minutes} min)` : ''}`,
    `- Coursera: ${COURSERA_ORIGIN}${item.urlPath}`,
    '',
    '## Ghi chú của mình',
    '',
    '- ',
    '',
  ].join('\n');
}

export async function saveSource(config: Config, item: CourseItem, capture: CaptureResult): Promise<string> {
  const file = sourceFileFor(config, item);
  await mkdir(path.dirname(file), { recursive: true });
  const header = `# ${item.title}\n# ${COURSERA_ORIGIN}${item.urlPath}\n# captured ${new Date().toISOString()} via ${capture.method}\n\n`;
  await writeFile(file, header + capture.text + '\n', 'utf8');
  return file;
}

export async function readSourceText(file: string): Promise<string> {
  const content = await readFile(file, 'utf8');
  return content.replace(/^(#.*\n)+\n/, '');
}

/** Create the notes file if needed and return its path. */
export async function ensureNotesFile(config: Config, item: CourseItem, moduleTitle: string | null): Promise<string> {
  const file = item.notesPath ?? notesFileFor(config, item);
  await mkdir(path.dirname(file), { recursive: true });
  try {
    await readFile(file, 'utf8');
  } catch {
    await writeFile(file, notesTemplate(item, moduleTitle), 'utf8');
  }
  return file;
}

export async function writeAiNotes(file: string, aiMarkdown: string): Promise<void> {
  const current = await readFile(file, 'utf8');
  await writeFile(file, upsertAiSection(current, aiMarkdown), 'utf8');
}
