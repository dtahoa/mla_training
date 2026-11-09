// Pure helpers for the probe: turn URLs and API payloads into structure-only
// summaries, and decide which pages the probe may open. No browser here, so
// everything is unit-tested.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Route words Sana puts in front of an id: /program/<uuid>, /course/iZGYCxcGVQHf, /s/eVNFmFuELfeS/next … */
const ID_ROUTE = /^(s|programs?|courses?|paths?|lessons?|cards?|modules?|content|pages?|items?|steps?|chapters?|sections?)$/i;

/**
 * Random ids: UUIDs, or Sana's 12-character ids ("iZGYCxcGVQHf", "8YfMYfV1Ro98"),
 * which have a digit or a run of capitals. Words and camelCase names do not.
 */
export function looksLikeId(token: string): boolean {
  if (UUID.test(token)) return true;
  return /^[A-Za-z0-9_-]{8,}$/.test(token) && /[a-z]/.test(token) && (/\d/.test(token) || /[A-Z]{2,}/.test(token));
}

/** "/program/d4d2…/course/iZGY…" → "/program/:id/course/:id" (ids never reach the report as patterns). */
export function pathPattern(pathname: string): string {
  const segments = pathname.split('/');
  return segments
    .map((segment, index) => {
      if (/^\d+$/.test(segment)) return ':n';
      if (looksLikeId(segment)) return ':id';
      if (index > 0 && ID_ROUTE.test(segments[index - 1] ?? '') && /^[\w-]{6,}$/.test(segment)) return ':id';
      return segment;
    })
    .join('/');
}

/**
 * Keys whose string values are schema enums ("ProgramCourseStep", "COMPLETED"),
 * not personal data. Their values are kept; every other value becomes its type.
 */
const ENUM_KEY = /^(__typename|type|kind|status|state|\w+(Type|Status|State|Kind))$/;
const ENUM_VALUE = (key: string, value: string) =>
  value.length <= 40 && (key === '__typename' ? /^[A-Za-z_]\w*$/.test(value) : /^([A-Z0-9_]+|[a-z0-9_-]+)$/.test(value));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Shape of a JSON value: key names and types only, so API responses (which
 * carry names, emails, tokens) can be recorded safely. Enum-like fields keep
 * their value (`"COMPLETED"`), and array items are merged so every variant
 * shows up (a course step and an exam step have different fields).
 */
export function jsonShape(value: unknown, depth = 8, key = ''): unknown {
  if (value === null) return 'null';
  if (typeof value === 'string' && ENUM_KEY.test(key) && ENUM_VALUE(key, value)) return `"${value}"`;
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    if (depth <= 0) return [`len=${value.length}`, '…'];
    const inner = value
      .slice(0, 50)
      .map((item) => jsonShape(item, depth - 1, key))
      .reduce((merged, next) => mergeShapes(merged, next));
    return [`len=${value.length}`, inner];
  }
  if (isRecord(value)) {
    if (depth <= 0) return '{…}';
    const entries = Object.entries(value);
    // A map keyed by ids ({ eVNFmFuELfeS: {...}, 8YfMYfV1Ro98: {...} }) is one shape, not N copies.
    if (entries.length > 1 && entries.every(([childKey]) => looksLikeId(childKey))) {
      const inner = entries
        .slice(0, 50)
        .map(([, child]) => jsonShape(child, depth - 1, ''))
        .reduce((merged, next) => mergeShapes(merged, next));
      return { [`:id ×${entries.length}`]: inner };
    }
    const shape: Record<string, unknown> = {};
    for (const [childKey, child] of entries.slice(0, 60)) shape[childKey] = jsonShape(child, depth - 1, childKey);
    if (entries.length > 60) shape['…'] = `${entries.length - 60} more keys`;
    return shape;
  }
  return typeof value;
}

/** Union of two shapes: object keys merged, arrays merged, differing leaves joined with " | ". */
export function mergeShapes(a: unknown, b: unknown): unknown {
  if (a === 'null' && b !== 'null') return b;
  if (b === 'null') return a;
  if (isRecord(a) && isRecord(b)) {
    const merged: Record<string, unknown> = { ...a };
    for (const [key, value] of Object.entries(b)) merged[key] = key in merged ? mergeShapes(merged[key], value) : value;
    return merged;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length === 0) return b;
    if (b.length === 0) return a;
    const length = (shape: unknown[]) => Number(String(shape[0]).replace('len=', '')) || 0;
    return [`len=${Math.max(length(a), length(b))}`, mergeShapes(a[1], b[1])];
  }
  const leaves = (shape: unknown) => (typeof shape === 'string' ? shape.split(' | ') : [JSON.stringify(shape)]);
  return [...new Set([...leaves(a), ...leaves(b)])].join(' | ');
}

/** GraphQL operation name(s) of a request body, if it is one. */
export function graphqlOperations(postData: string | null): string[] {
  if (!postData) return [];
  try {
    const body: unknown = JSON.parse(postData);
    const list = Array.isArray(body) ? body : [body];
    return list
      .map((entry) => (entry && typeof entry === 'object' ? (entry as Record<string, unknown>).operationName : undefined))
      .filter((name): name is string => typeof name === 'string' && name.length > 0);
  } catch {
    return [];
  }
}

export function isLoginUrl(url: string): boolean {
  try {
    return /\/(log-?in|sign-?in|sso|auth|oauth2?|saml)(\/|$)/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/**
 * Pages the probe must never open: anything that may be an exam, quiz or the
 * certification itself (opening one can start a timed attempt).
 */
export const ASSESSMENT_LIKE = /\b(exams?|assessments?|quiz(zes)?|tests?|certif\w*|graded|final|attempt|submit)\b/i;

const ACCOUNT_PAGES = /^\/(home|settings|profile|account|search|notifications|logout|log-?out|sign-?out|admin|users?)(\/|$)/i;
/** Your own opinion: the tool never opens or fills feedback surveys. */
const FEEDBACK_LIKE = /\b(feedback|survey)\b/i;

export interface LinkInfo {
  /** Same-origin path (no query), or null for external links. */
  path: string | null;
  text: string;
  inMain: boolean;
}

/**
 * Child pages (program → course → lesson) the probe may open to learn the
 * layout: same origin, inside <main> when there is one, not a page already
 * seen, not account pages, never assessment-like or a feedback survey.
 */
export function pickChildLinks(links: LinkInfo[], seen: Iterable<string>, max = 2): string[] {
  const exclude = new Set(seen);
  const hasMain = links.some((link) => link.inMain);
  const picked: string[] = [];
  for (const link of links) {
    if (!link.path || exclude.has(link.path)) continue;
    if (hasMain && !link.inMain) continue;
    if (ACCOUNT_PAGES.test(link.path)) continue;
    const words = link.path.replace(/[-_/]/g, ' ');
    if (ASSESSMENT_LIKE.test(link.text) || ASSESSMENT_LIKE.test(words)) continue;
    if (FEEDBACK_LIKE.test(link.text) || FEEDBACK_LIKE.test(words)) continue;
    if (!pathPattern(link.path).includes(':id')) continue;
    if (picked.includes(link.path)) continue;
    picked.push(link.path);
    if (picked.length >= max) break;
  }
  return picked;
}

/** Group links by URL pattern so the report shows the site's structure, not a wall of links. */
export function groupLinks(links: LinkInfo[], samples = 4): Array<{ pattern: string; count: number; inMain: number; texts: string[] }> {
  const groups = new Map<string, { pattern: string; count: number; inMain: number; texts: string[] }>();
  for (const link of links) {
    if (!link.path) continue;
    const pattern = pathPattern(link.path);
    const group = groups.get(pattern) ?? { pattern, count: 0, inMain: 0, texts: [] };
    group.count++;
    if (link.inMain) group.inMain++;
    if (group.texts.length < samples && link.text && !group.texts.includes(link.text)) group.texts.push(link.text);
    groups.set(pattern, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}
