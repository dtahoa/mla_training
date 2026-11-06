// Offline review commands. They only use what is already on disk (progress
// + captured sources) and never touch Coursera.

import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config.ts';
import { itemDisplayType } from './course.ts';
import { guardFor } from './guard.ts';
import { ProgressStore, pickNextItem, sortItems } from './store.ts';
import { readSourceText } from './capture.ts';
import { createLlmFromEnv, type LlmClient } from './ai.ts';
import { askPrompt, parseQuiz, quizPrompt, type StudySource } from './study-ai.ts';
import { createPrompt, INTERRUPTED } from './prompt.ts';

export type ModuleFilter = number | 'all' | undefined;

const pad = (value: string | number, width: number) => String(value).padEnd(width);

export async function printStatus(config: Config): Promise<void> {
  const store = await ProgressStore.open(config.progressPath, config.courseSlug);
  const { items, modules, syncedAt, checkpoint } = store.data;
  if (items.length === 0) {
    console.log('Chưa có outline. Chạy `npm run sync` (hoặc `npm run study`).');
    return;
  }
  const checkpointItem = checkpoint?.itemId ? store.find(checkpoint.itemId) : undefined;
  console.log(`Course: ${config.courseSlug} · synced: ${syncedAt ?? '—'}`);
  console.log(`Checkpoint: ${checkpointItem ? `[M${checkpointItem.module}] ${checkpointItem.title}` : '—'}\n`);
  console.log(`${pad('Module', 8)}${pad('Title', 44)}${pad('Items', 7)}${pad('Done✓', 7)}${pad('Studied', 9)}${pad('Notes', 7)}${pad('Manual', 8)}Locked`);
  const numbers = [...new Set([...modules.map((m) => m.number), ...items.map((i) => i.module)])].sort((a, b) => a - b);
  for (const number of numbers) {
    const inModule = items.filter((i) => i.module === number);
    const title = modules.find((m) => m.number === number)?.title ?? (number === 0 ? '(ngoài outline)' : '');
    console.log(
      pad(`M${number}`, 8) +
        pad(title.length > 42 ? `${title.slice(0, 41)}…` : title, 44) +
        pad(inModule.length, 7) +
        pad(inModule.filter((i) => i.courseraCompleted).length, 7) +
        pad(inModule.filter((i) => i.localStatus === 'studied').length, 9) +
        pad(inModule.filter((i) => i.sourcePath).length, 7) +
        pad(inModule.filter((i) => i.localStatus === 'manual_pending').length, 8) +
        inModule.filter((i) => i.locked).length,
    );
  }
  const next = pickNextItem(items);
  console.log(`\nTiếp theo: ${next ? `[M${next.module} · ${next.order}] ${next.title} (${itemDisplayType(next)})` : '—'}`);
  const manual = sortItems(items).filter((i) => i.localStatus === 'manual_pending' && !i.courseraCompleted);
  if (manual.length) {
    console.log('\nCần tự làm (assessment / manual):');
    for (const item of manual) console.log(`  - [M${item.module}] ${item.title} (${itemDisplayType(item)})`);
  }
}

async function loadSources(config: Config, store: ProgressStore, filter: ModuleFilter): Promise<StudySource[]> {
  const sources: StudySource[] = [];
  for (const item of sortItems(store.data.items)) {
    if (!item.sourcePath || !guardFor(item.kind).allowAi) continue;
    if (typeof filter === 'number' && item.module !== filter) continue;
    try {
      sources.push({ module: item.module, title: item.title, type: itemDisplayType(item), text: await readSourceText(item.sourcePath) });
    } catch {
      // source file deleted by hand — skip
    }
  }
  return sources;
}

function defaultModule(store: ProgressStore): number | 'all' {
  const checkpointItem = store.data.checkpoint?.itemId ? store.find(store.data.checkpoint.itemId) : undefined;
  return checkpointItem?.module || 'all';
}

function requireLlm(): LlmClient | null {
  try {
    const llm = createLlmFromEnv();
    if (!llm) console.log('AI chưa bật. Đặt AI_PROVIDER + API key trong .env (xem .env.example).');
    return llm;
  } catch (error) {
    console.log(`⚠ ${(error as Error).message}`);
    return null;
  }
}

export async function runQuiz(config: Config, options: { module?: ModuleFilter; count?: number }): Promise<void> {
  const llm = requireLlm();
  if (!llm) return;
  const store = await ProgressStore.open(config.progressPath, config.courseSlug);
  const module = options.module ?? defaultModule(store);
  const sources = await loadSources(config, store, module);
  if (sources.length === 0) {
    console.log(`Chưa có nội dung đã capture cho ${module === 'all' ? 'course' : `module ${module}`}. Dùng [c] trong \`npm run study\`.`);
    return;
  }
  const count = options.count ?? 5;
  const chars = sources.reduce((sum, s) => sum + s.text.length, 0);
  console.log(`… tạo ${count} câu hỏi từ ${sources.length} bài (${chars} ký tự) bằng ${llm.provider}/${llm.model}`);
  const questions = parseQuiz(await llm.complete(quizPrompt(sources, count, config.studyLanguage)));

  const prompt = createPrompt();
  const answers: Array<{ question: string; chosen: number | null; correct: number }> = [];
  try {
    for (const [index, q] of questions.entries()) {
      console.log(`\nCâu ${index + 1}/${questions.length}: ${q.question}`);
      q.options.forEach((option, i) => console.log(`  ${String.fromCharCode(65 + i)}. ${option}`));
      const input = await prompt.ask('Đáp án (A/B/C/D, Enter để bỏ qua, q để dừng): ');
      if (input === INTERRUPTED || input.toLowerCase() === 'q') break;
      const chosen = input ? input.toUpperCase().charCodeAt(0) - 65 : null;
      const valid = chosen !== null && chosen >= 0 && chosen < q.options.length ? chosen : null;
      answers.push({ question: q.question, chosen: valid, correct: q.answer });
      console.log(valid === q.answer ? '✓ Đúng' : `✗ Đáp án: ${String.fromCharCode(65 + q.answer)}`);
      console.log(`  ${q.explanation}`);
    }
  } finally {
    prompt.close();
  }
  const score = answers.filter((a) => a.chosen === a.correct).length;
  console.log(`\nKết quả: ${score}/${answers.length}`);
  await mkdir(path.dirname(config.quizLogPath), { recursive: true });
  await appendFile(
    config.quizLogPath,
    `${JSON.stringify({ ts: new Date().toISOString(), module, model: `${llm.provider}/${llm.model}`, score, answered: answers.length, answers })}\n`,
    'utf8',
  );
}

export async function runAsk(config: Config, question: string, options: { module?: ModuleFilter }): Promise<void> {
  if (!question.trim()) {
    console.log('Cách dùng: npm run ask -- "câu hỏi của bạn" [--module 2|all]');
    return;
  }
  const llm = requireLlm();
  if (!llm) return;
  const store = await ProgressStore.open(config.progressPath, config.courseSlug);
  const module = options.module ?? defaultModule(store);
  const sources = await loadSources(config, store, module);
  if (sources.length === 0) console.log('ℹ Chưa có nội dung đã capture — AI sẽ trả lời bằng kiến thức chung.');
  console.log(`… hỏi ${llm.provider}/${llm.model} với ${sources.length} bài làm ngữ cảnh\n`);
  console.log(await llm.complete(askPrompt(sources, question, config.studyLanguage)));
}
