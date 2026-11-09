// Program outline from the GraphQL response the program page loads by itself
// (GetLearnerProgram): the steps (courses, final exam, feedback), their order,
// unlock rule and your progress. The tool only reads that response; it never
// sends its own API requests.

import type { Page } from 'playwright';

export type StepKind = 'COURSE' | 'EXAM' | 'FEEDBACK';

export interface ProgramStep {
  /** 1-based position in the program ("1. Technical Fluency Orientation"). */
  index: number;
  courseId: string;
  title: string;
  duration: string | null;
  kind: StepKind;
  /** Progress as Sana reports it: a 0–1 fraction (0.032 = 3%). */
  progress: number | null;
  startedAt: string | null;
  passedAt: string | null;
  /** Opens only after the previous step is passed. */
  unlockOnPrevious: boolean;
}

export interface ProgramOutline {
  id: string;
  name: string;
  progress: number | null;
  passedAt: string | null;
  nextCourseId: string | null;
  steps: ProgramStep[];
}

/** The tool studies COURSE steps only; the final exam and the feedback survey are yours. */
export function classifyStep(title: string): StepKind {
  if (/\b(exams?|assessments?|certification|quiz(zes)?|tests?)\b/i.test(title)) return 'EXAM';
  if (/\b(feedback|survey)\b/i.test(title)) return 'FEEDBACK';
  return 'COURSE';
}

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * Builds the outline from GetLearnerProgram. Enrollment steps (yours, with
 * progress) give the order; program steps add the unlock rule. Email steps
 * (reminders) are not part of the outline.
 */
export function parseProgram(body: unknown): ProgramOutline {
  const data = obj(obj(body).data);
  const program = obj(data.program);
  const enrollment = obj(obj(data.me).enrollment);

  const rules = new Map<string, boolean>();
  for (const step of list(program.steps).map(obj)) {
    const courseId = str(step.courseId) ?? str(obj(step.course).courseId);
    if (courseId) rules.set(courseId, obj(step.schedule).__typename === 'OnCompletionOfPrevious');
  }

  const source = list(enrollment.steps).length ? list(enrollment.steps) : list(program.steps);
  const steps: ProgramStep[] = [];
  for (const raw of source.map(obj)) {
    const courseId = str(raw.courseId) ?? str(obj(raw.course).courseId);
    if (!courseId) continue;
    const content = obj(raw.content);
    const title = str(content.title) ?? str(obj(raw.course).title) ?? str(raw.title) ?? courseId;
    const progress = obj(raw.progress);
    steps.push({
      index: steps.length + 1,
      courseId,
      title,
      duration: str(content.duration),
      kind: classifyStep(title),
      progress: num(progress.progress),
      startedAt: str(progress.startedAt),
      passedAt: str(progress.passedAt),
      unlockOnPrevious: rules.get(courseId) ?? false,
    });
  }

  const overall = obj(enrollment.progress);
  return {
    id: str(program.id) ?? '',
    name: str(program.name) ?? str(program.localizedName) ?? '',
    progress: num(overall.progress),
    passedAt: str(overall.passedAt),
    nextCourseId: str(obj(enrollment.nextStep).courseId),
    steps,
  };
}

/** GetLearnerProgram reports progress as a 0–1 fraction (verified: course 1 at 3% = 0.032). */
export function progressPercent(progress: number | null): number | null {
  if (progress === null) return null;
  return Math.min(100, Math.max(0, Math.round(progress * 100)));
}

/** "PT19M4.333S" → "19 min", "PT1H5M" → "1 h 5 min". Anything else is shown as is. */
export function formatDuration(iso: string | null): string {
  if (!iso) return '?';
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/.exec(iso);
  if (!match) return iso;
  const total = Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0) + Math.round(Number(match[3] ?? 0) / 60);
  const hours = Math.floor(total / 60);
  return hours ? `${hours} h ${total % 60} min` : `${total} min`;
}

export function isDone(step: ProgramStep): boolean {
  return Boolean(step.passedAt) || progressPercent(step.progress) === 100;
}

/** Locked = waits for the previous step, which is not done yet. */
export function isLocked(steps: ProgramStep[], step: ProgramStep): boolean {
  const previous = steps[step.index - 2];
  return step.unlockOnPrevious && previous !== undefined && !isDone(previous);
}

/** The step to work on: the first one not done. */
export function nextStep(outline: ProgramOutline): ProgramStep | null {
  return outline.steps.find((step) => !isDone(step)) ?? null;
}

/** Open the program page and read its own GetLearnerProgram response. */
export async function loadProgram(page: Page, programUrl: string): Promise<ProgramOutline> {
  const response = page.waitForResponse((r) => r.url().includes('/graphql/operation/GetLearnerProgram') && r.ok(), {
    timeout: 30_000,
  });
  await page.goto(programUrl, { waitUntil: 'domcontentloaded' });
  return parseProgram(await (await response).json());
}
