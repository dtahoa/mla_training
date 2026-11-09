// npm run summary — AI revision notes from the card text you saved: one
// summary per course, then one for the whole program. Only your notes are
// sent to the AI provider (never knowledge checks, the exam or account data),
// and only when AI_PROVIDER is set.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config.ts';
import { createLlmFromEnv, type CompletionRequest, type LlmClient } from './ai.ts';
import { ProgressStore } from './store.ts';
import { AuditLog } from './audit.ts';

export interface CardNote {
  title: string;
  position: number | null;
  total: number | null;
  text: string;
}

export interface CourseNotes {
  /** Program step number, from the file name ("01-…md" → 1). */
  index: number;
  file: string;
  course: string;
  cards: CardNote[];
}

const SECTION = /^## (.+?)(?: \((\d+)\/(\d+)\))?\s*$/;

/**
 * Parse a notes file written by notes.ts. Cards come back in course order
 * (backfill can append earlier cards after later ones); a card saved twice
 * keeps its first copy.
 */
export function parseNotes(markdown: string): { course: string; cards: CardNote[] } {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const course = (lines.find((line) => line.startsWith('# ')) ?? '# ').slice(2).trim();
  const cards: CardNote[] = [];
  let current: CardNote | null = null;
  const body: string[] = [];
  const flush = () => {
    if (current) cards.push({ ...current, text: body.join('\n').trim() });
    body.length = 0;
  };
  for (const line of lines) {
    const match = SECTION.exec(line);
    if (match) {
      flush();
      current = {
        title: (match[1] as string).trim(),
        position: match[2] ? Number(match[2]) : null,
        total: match[3] ? Number(match[3]) : null,
        text: '',
      };
    } else if (current) {
      body.push(line);
    }
  }
  flush();

  const seen = new Set<string>();
  const unique = cards.filter((card) => {
    const key = `${card.position ?? ''}|${card.title}`;
    if (seen.has(key) || !card.text) return false;
    seen.add(key);
    return true;
  });
  return {
    course,
    cards: unique
      .map((card, order) => ({ card, order }))
      .sort((a, b) => (a.card.position ?? Infinity) - (b.card.position ?? Infinity) || a.order - b.order)
      .map(({ card }) => card),
  };
}

export async function listCourseNotes(notesDir: string): Promise<CourseNotes[]> {
  const files = await readdir(notesDir).catch(() => [] as string[]);
  const courses: CourseNotes[] = [];
  for (const name of files.sort()) {
    const match = /^(\d+)-.+\.md$/.exec(name);
    if (!match) continue;
    const file = path.join(notesDir, name);
    const parsed = parseNotes(await readFile(file, 'utf8'));
    if (parsed.cards.length) courses.push({ index: Number(match[1]), file, ...parsed });
  }
  return courses;
}

const MAX_CONTEXT_CHARS = 80_000;

function languageRule(language: string): string {
  return `Write in ${language}. Keep OpenAI product names and important English technical terms in English (add a short translation in parentheses the first time).`;
}

/** Cards under a size budget; every card keeps at least its beginning. */
export function buildContext(cards: CardNote[], maxChars = MAX_CONTEXT_CHARS): string {
  if (cards.length === 0) return '';
  const perCard = Math.floor(maxChars / cards.length);
  return cards
    .map((card) => {
      const body = card.text.length > perCard ? `${card.text.slice(0, perCard)}\n[...truncated]` : card.text;
      return `### [C${card.position ?? '?'}] ${card.title}\n${body}`;
    })
    .join('\n\n');
}

export function courseSummaryPrompt(program: string, course: CourseNotes, language: string): CompletionRequest {
  return {
    system: [
      `You are a study coach for the "${program}" program on OpenAI PartnerU, which trains partner engineers and consultants to shape OpenAI solutions with customers.`,
      'Turn the lesson cards of one course into revision notes the learner will study from.',
      'Use only the provided cards; if something is unclear in them, say so instead of inventing it. Cite cards like [C3] Card title for each main point.',
      languageRule(language),
      'Output GitHub Markdown with exactly these sections:',
      '## Big picture — 3-5 sentences: what this course teaches and why it matters in customer work.',
      '## Key concepts — "**term** — explanation" bullets.',
      '## Frameworks & decision guides — every model, checklist, routing rule or step sequence taught, as numbered steps or a table.',
      '## Pitfalls — mistakes the course warns about (e.g. overclaiming) and how to avoid them.',
      '## Apply it — 2 short customer scenarios showing the ideas in use.',
      '## Review questions — 5 open questions; put suggested answers inside one <details><summary>Answers</summary> ... </details> block.',
    ].join('\n'),
    user: `# Course ${course.index}: ${course.course}\n\n${buildContext(course.cards)}`,
    maxTokens: 4000,
  };
}

export interface CourseSummary {
  index: number;
  course: string;
  markdown: string;
}

export function programSummaryPrompt(program: string, courses: CourseSummary[], language: string): CompletionRequest {
  return {
    system: [
      `You are a study coach. Combine the per-course revision notes of the "${program}" program into one summary the learner can review in 15 minutes.`,
      'Use only the provided notes; do not add outside facts. Refer to courses as C1, C2, ...',
      languageRule(language),
      'Output GitHub Markdown with exactly these sections:',
      '## The program in one page — the core ideas in 6-10 bullets.',
      '## How the courses connect — how each course builds on the previous ones.',
      '## Cheat sheet — a table: Decision / framework | When to use | Key points | Course.',
      '## Glossary — the 10-20 most important terms, one line each.',
      '## Final review — 8 questions that mix several courses; suggested answers inside one <details><summary>Answers</summary> ... </details> block.',
    ].join('\n'),
    user: [`Program: ${program}`, ...courses.map((c) => `# Course ${c.index}: ${c.course}\n${c.markdown.trim()}`)].join('\n\n'),
    maxTokens: 5000,
  };
}

/** Cards the course has (from "(n/total)") vs cards you have notes for. */
export function coverage(course: CourseNotes): { saved: number; total: number | null } {
  const totals = course.cards.map((card) => card.total).filter((total): total is number => total !== null);
  return { saved: course.cards.length, total: totals.length ? Math.max(...totals) : null };
}

export function summaryFile(config: Pick<Config, 'summariesDir'>, course: Pick<CourseNotes, 'file'>): string {
  return path.join(config.summariesDir, path.basename(course.file));
}

export async function runSummary(config: Config, options: { course?: number; llm?: LlmClient | null } = {}): Promise<void> {
  const llm = options.llm === undefined ? createLlmFromEnv() : options.llm;
  if (!llm) {
    console.log('✖ Chưa bật AI. Thêm vào .env: AI_PROVIDER=openai, AI_MODEL=<model>, OPENAI_API_KEY=<key> (xem .env.example).');
    process.exitCode = 1;
    return;
  }
  const all = await listCourseNotes(config.notesDir);
  const courses = options.course ? all.filter((course) => course.index === options.course) : all;
  if (courses.length === 0) {
    console.log('Chưa có ghi chú nào. Chạy `npm run study` (hoặc `npm run backfill` cho thẻ đã học) trước.');
    return;
  }
  const store = await ProgressStore.open(config.progressPath, config.programId);
  const program = store.data.outline?.name || 'OpenAI Technical Practitioner';
  const audit = new AuditLog(config.auditPath);
  await mkdir(config.summariesDir, { recursive: true });

  const summaries: CourseSummary[] = [];
  for (const course of courses) {
    const { saved, total } = coverage(course);
    const partial = total !== null && saved < total ? `/${total} (knowledge check và thẻ chỉ có tiêu đề không có ghi chú)` : '';
    console.log(`🧠 Course ${course.index}: ${course.course} — ghi chú từ ${saved}${partial} thẻ`);
    const markdown = await llm.complete(courseSummaryPrompt(program, course, config.studyLanguage));
    const file = summaryFile(config, course);
    const header = `# Tóm tắt — ${course.course}\n\n_Từ ${saved}${total ? `/${total}` : ''} thẻ · ${llm.provider}/${llm.model} · ${new Date().toISOString()}_\n\n`;
    await writeFile(file, header + markdown.trim() + '\n', 'utf8');
    summaries.push({ index: course.index, course: course.course, markdown });
    await audit.log('summary', { course: course.index, cards: saved, model: llm.model });
    console.log(`   → ${file}`);
  }

  if (!options.course && summaries.length >= 2) {
    console.log(`🧠 Cả program (${summaries.length} course)`);
    const markdown = await llm.complete(programSummaryPrompt(program, summaries, config.studyLanguage));
    const file = path.join(config.summariesDir, 'program.md');
    await writeFile(file, `# Tóm tắt — ${program}\n\n_${summaries.length} course · ${llm.provider}/${llm.model}_\n\n${markdown.trim()}\n`, 'utf8');
    await audit.log('summary', { program: true, courses: summaries.length, model: llm.model });
    console.log(`   → ${file}`);
  }
}
