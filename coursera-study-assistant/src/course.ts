// Pure course-model logic: URL parsing, item classification, outline row parsing.
// No browser access here so every rule is unit-testable.

/** What the assistant is allowed to do is decided by this kind (see guard.ts). */
export type ItemKind = 'VIDEO' | 'READING' | 'PRACTICE' | 'GRADED' | 'OTHER';

export type LocalStatus = 'new' | 'studied' | 'skipped' | 'manual_pending';

export interface ItemRef {
  courseSlug: string;
  segment: string;
  id: string;
  slug: string | null;
  urlPath: string;
}

export interface CourseItem {
  id: string;
  urlPath: string;
  segment: string;
  title: string;
  typeLabel: string | null;
  minutes: number | null;
  module: number;
  order: number;
  kind: ItemKind;
  courseraCompleted: boolean;
  locked: boolean;
  localStatus: LocalStatus;
  sourcePath: string | null;
  notesPath: string | null;
}

/** Raw data pulled from one item link on a module page (see outline.ts). */
export interface RawItemRow {
  path: string;
  anchorText: string;
  rowText: string;
  ariaLabel: string | null;
  hintText: string;
}

const VIDEO_SEGMENTS = new Set(['lecture']);
const READING_SEGMENTS = new Set(['supplement']);
const ASSESSMENT_SEGMENTS = new Set([
  'quiz',
  'exam',
  'assignment-submission',
  'peer',
  'review',
  'give-feedback',
  'gradedLab',
  'gradedLti',
  'gradedWidget',
  'gradedProgramming',
  'programming',
  'staffGraded',
  'practice-quiz',
]);
const NON_ITEM_SEGMENTS = new Set(['home', 'resources', 'forum', 'discussions', 'course-inbox', 'info', 'grades']);

export function parseItemPath(pathOrUrl: string): ItemRef | null {
  let pathname: string;
  try {
    pathname = new URL(pathOrUrl, 'https://www.coursera.org').pathname;
  } catch {
    return null;
  }
  const match = /^\/learn\/([^/]+)\/([A-Za-z-]+)\/([A-Za-z0-9_-]+)(?:\/([^/?#]+))?\/?$/.exec(pathname);
  if (!match) return null;
  const [, courseSlug, segment, id, slug] = match as unknown as [string, string, string, string, string | undefined];
  if (NON_ITEM_SEGMENTS.has(segment)) return null;
  return {
    courseSlug,
    segment,
    id,
    slug: slug ?? null,
    urlPath: `/learn/${courseSlug}/${segment}/${id}${slug ? `/${slug}` : ''}`,
  };
}

/**
 * Fail-closed classification. Anything that might be an assessment and is not
 * clearly labelled "practice" is GRADED; unknown item types are OTHER. Both
 * mean "the human does it, the assistant stays out".
 */
export function classifyItem(segment: string, typeLabel: string | null): ItemKind {
  const label = typeLabel ?? '';
  const saysPractice = /\bpractice\b/i.test(label);
  const saysGraded = /\b(graded|peer)\b/i.test(label) && !/\bungraded\b/i.test(label);

  if (VIDEO_SEGMENTS.has(segment)) return 'VIDEO';
  if (READING_SEGMENTS.has(segment)) return 'READING';
  if (ASSESSMENT_SEGMENTS.has(segment)) {
    if (segment === 'exam' || segment === 'peer') return 'GRADED';
    return saysPractice && !saysGraded ? 'PRACTICE' : 'GRADED';
  }
  if (saysGraded) return 'GRADED';
  return 'OTHER';
}

// A label only counts when followed by a non-letter (separator such as • · | :
// —, a digit, a bracket) or the end of the line, so a title such as
// "Reading the signals" is not mistaken for a label.
const label = (source: string): RegExp => new RegExp(`^(?:${source})(?=\\s*(?:[^\\p{L}\\s]|$))`, 'iu');

const TYPE_LABEL_PATTERNS: Array<[RegExp, string]> = [
  [label('video'), 'Video'],
  [label('reading'), 'Reading'],
  [label('practice (?:assignment|quiz)'), 'Practice Assignment'],
  [label('graded (?:assignment|quiz|app item|plugin|lab)'), 'Graded Assignment'],
  [label('peer[- ]graded assignment|peer review'), 'Peer-graded Assignment'],
  [label('quiz|exam'), 'Graded Assignment'],
  [label('ungraded (?:plugin|lab|app item|widget)'), 'Ungraded Plugin'],
  [label('discussion prompt'), 'Discussion Prompt'],
  [label('lab|notebook'), 'Lab'],
];

function matchTypeLabel(line: string): { label: string; rest: string } | null {
  for (const [pattern, label] of TYPE_LABEL_PATTERNS) {
    const match = pattern.exec(line);
    if (match) return { label, rest: line.slice(match[0].length) };
  }
  return null;
}

function parseMinutes(text: string): number | null {
  const hours = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/i.exec(text);
  const minutes = /(\d+)\s*(?:m|min|mins|minute|minutes)\b/i.exec(text);
  if (!hours && !minutes) return null;
  return Math.round((hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0));
}

const STATUS_LINE = /^(completed|in progress|not started|started|locked|overdue|due\b.*|optional|passed|failed)$/i;

export function detectCompleted(text: string): boolean {
  if (/\b(not completed|incomplete|not started)\b/i.test(text)) return false;
  return /\b(completed|passed)\b/i.test(text);
}

export interface ParsedRow {
  title: string;
  typeLabel: string | null;
  minutes: number | null;
  completed: boolean;
  locked: boolean;
}

/** Turn the visible text of an item row into structured fields (heuristic, English UI). */
export function parseItemRow(row: Pick<RawItemRow, 'anchorText' | 'rowText' | 'ariaLabel' | 'hintText'>): ParsedRow {
  const sourceText = row.rowText.trim() || row.anchorText;
  const lines = sourceText
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  let typeLabel: string | null = null;
  let minutes: number | null = null;
  let title: string | null = null;

  for (const line of lines) {
    const typed = matchTypeLabel(line);
    if (typed) {
      typeLabel ??= typed.label;
      minutes ??= parseMinutes(typed.rest);
      // "Video: Some title" style (aria-label like) lines carry the title too.
      const inlineTitle = /^\s*:\s*(.+)$/.exec(typed.rest)?.[1];
      if (inlineTitle && !title && parseMinutes(inlineTitle) === null) title = inlineTitle.trim();
      continue;
    }
    if (STATUS_LINE.test(line)) continue;
    if (/^[•·.\s]*\d+\s*(?:min|mins|minutes|h|hr|hours)\b/i.test(line)) {
      minutes ??= parseMinutes(line);
      continue;
    }
    title ??= line;
  }

  const allText = [row.rowText, row.anchorText, row.ariaLabel ?? '', row.hintText].join(' \n ');
  if (!typeLabel && row.ariaLabel) typeLabel = matchTypeLabel(row.ariaLabel)?.label ?? null;

  return {
    title: title ?? (row.anchorText.trim() || '(untitled)'),
    typeLabel,
    minutes,
    completed: detectCompleted(allText),
    locked: /\blocked\b/i.test(allText) && !/\bunlocked\b/i.test(allText),
  };
}

export function itemDisplayType(item: Pick<CourseItem, 'kind' | 'typeLabel'>): string {
  return item.typeLabel ?? item.kind;
}
