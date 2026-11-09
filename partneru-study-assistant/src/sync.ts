import { programUrl, type Config } from './config.ts';
import { isLoggedIn, openSession, waitForLogin, type Session } from './browser.ts';
import { formatDuration, isDone, isLocked, loadProgram, progressPercent, type ProgramOutline } from './program.ts';
import { ProgressStore } from './store.ts';
import { AuditLog } from './audit.ts';

/** Read the program outline + progress from PartnerU and save it locally. */
export async function syncProgram(session: Session, config: Config, store: ProgressStore, audit: AuditLog): Promise<ProgramOutline | null> {
  const url = programUrl(config);
  if (!(await isLoggedIn(session.page)) && !(await waitForLogin(session, url))) {
    console.log('✖ Chưa đăng nhập PartnerU.');
    return null;
  }
  const outline = await loadProgram(session.page, url);
  if (outline.steps.length === 0) {
    console.log('✖ Không đọc được danh sách bước của program (GetLearnerProgram trống).');
    return null;
  }
  store.setOutline(outline);
  await store.save();
  await audit.log('sync', { steps: outline.steps.length, progress: outline.progress });
  return outline;
}

export async function runSync(config: Config): Promise<void> {
  const session = await openSession(config, programUrl(config));
  try {
    const store = await ProgressStore.open(config.progressPath, config.programId);
    if (!(await syncProgram(session, config, store, new AuditLog(config.auditPath)))) process.exitCode = 1;
  } finally {
    await session.disconnect();
  }
  await printStatus(config);
}

const KIND_NOTE = { COURSE: '', EXAM: '  ← bạn tự làm', FEEDBACK: '  ← bạn tự làm' } as const;

export function formatStatus(outline: ProgramOutline, syncedAt: string | null): string {
  const lines = [
    `📚 ${outline.name} — ${progressPercent(outline.progress) ?? '?'}%${outline.passedAt ? ' ✅ đã hoàn thành' : ''}`,
    `   (đồng bộ lúc ${syncedAt ?? '—'})`,
    '',
  ];
  for (const step of outline.steps) {
    const mark = isDone(step) ? '✅' : isLocked(outline.steps, step) ? '🔒' : step.startedAt || (step.progress ?? 0) > 0 ? '▶️' : '⬜';
    const percent = progressPercent(step.progress);
    lines.push(
      `${mark} ${String(step.index).padStart(2)}. ${step.title}  ·  ${formatDuration(step.duration)}  ·  ${percent ?? '?'}%${KIND_NOTE[step.kind]}`,
    );
  }
  return lines.join('\n');
}

export async function printStatus(config: Config): Promise<void> {
  const store = await ProgressStore.open(config.progressPath, config.programId);
  if (!store.data.outline) {
    console.log('Chưa có dữ liệu. Chạy: npm run sync');
    return;
  }
  console.log(formatStatus(store.data.outline, store.data.syncedAt));
}
