// Prompts and response parsing for the AI study helper. Inputs are only text
// the learner captured from videos/readings plus their own questions.

import type { CompletionRequest } from './ai.ts';

export interface StudySource {
  module: number;
  title: string;
  type: string;
  text: string;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  answer: number;
  explanation: string;
}

const MAX_CONTEXT_CHARS = 60_000;

function languageRule(language: string): string {
  return `Write in ${language}. Keep important English course terms in English (add a short translation in parentheses the first time).`;
}

/** Concatenate sources under a size budget; every source keeps at least its beginning. */
export function buildContext(sources: StudySource[], maxChars = MAX_CONTEXT_CHARS): string {
  if (sources.length === 0) return '';
  const perSource = Math.floor(maxChars / sources.length);
  return sources
    .map((source) => {
      const body = source.text.length > perSource ? `${source.text.slice(0, perSource)}\n[...truncated]` : source.text;
      return `### [M${source.module}] ${source.title} (${source.type})\n${body}`;
    })
    .join('\n\n');
}

export function itemNotesPrompt(source: StudySource, language: string): CompletionRequest {
  return {
    system: [
      'You are a study coach helping a learner understand a course item they are studying (IBM "The AI Transformation Advisor").',
      'Use only the provided source. If something is not in the source, say so instead of inventing it.',
      languageRule(language),
      'Output GitHub Markdown with exactly these sections:',
      '### Summary — 3-6 bullets with the core ideas.',
      '### Key concepts — "**term** — explanation" bullets.',
      '### Apply it — 1-2 short examples of using the idea in a real enterprise AI advisory engagement.',
      '### Self-check — 3 open questions that test understanding; put suggested answers inside one <details><summary>Answers</summary> ... </details> block.',
    ].join('\n'),
    user: buildContext([source]),
    maxTokens: 3000,
  };
}

export function quizPrompt(sources: StudySource[], count: number, language: string): CompletionRequest {
  return {
    system: [
      'You write practice questions so a learner can check their own understanding of course material they studied.',
      'Test understanding and application, not trivia or exact wording. Use only the provided sources.',
      languageRule(language),
      `Return JSON only, no prose: {"questions":[{"question":string,"options":[string,string,string,string],"answer":<0-based index>,"explanation":string}]} with ${count} questions.`,
    ].join('\n'),
    user: buildContext(sources),
    maxTokens: 4000,
  };
}

export function askPrompt(sources: StudySource[], question: string, language: string): CompletionRequest {
  return {
    system: [
      'You are a study coach. Answer the learner question using the course sources below and cite item titles like [M1] Title.',
      'If the sources do not cover it, say so clearly, then give a brief general answer labelled as general knowledge.',
      languageRule(language),
    ].join('\n'),
    user: `${buildContext(sources)}\n\n---\nQuestion: ${question}`,
    maxTokens: 2000,
  };
}

/** Extract and validate quiz JSON from a model reply. Drops malformed questions. */
export function parseQuiz(reply: string): QuizQuestion[] {
  const cleaned = reply.replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('Không tìm thấy JSON trong phản hồi AI.');
  const data = JSON.parse(cleaned.slice(start, end + 1)) as { questions?: unknown };
  const list = Array.isArray(data.questions) ? data.questions : [];
  const questions = list.filter((raw): raw is QuizQuestion => {
    const q = raw as Partial<QuizQuestion>;
    return (
      typeof q.question === 'string' &&
      Array.isArray(q.options) &&
      q.options.length >= 2 &&
      q.options.length <= 6 &&
      q.options.every((option) => typeof option === 'string') &&
      Number.isInteger(q.answer) &&
      (q.answer as number) >= 0 &&
      (q.answer as number) < q.options.length &&
      typeof q.explanation === 'string'
    );
  });
  if (questions.length === 0) throw new Error('Phản hồi AI không có câu hỏi hợp lệ.');
  return questions;
}
