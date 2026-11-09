import { courseUrl, loadConfig, type Config } from './config.ts';
import { isLoggedIn, openSession, waitForLogin } from './browser.ts';
import { runProbe } from './probe.ts';
import { runStudy, syncOutline } from './study.ts';
import { printStatus, runAsk, runQuiz, runSummary, type ModuleFilter } from './review.ts';
import { runBackfill } from './backfill.ts';
import { AuditLog, ProgressStore } from './store.ts';

const HELP = `Coursera Study Assistant (human-in-the-loop)

  npm run login              Mở Chrome (profile riêng) để bạn tự đăng nhập Coursera
  npm run probe              Phase 1: báo cáo DOM/selector/blockers  [-- --screenshots]
  npm run sync               Đồng bộ outline + trạng thái hoàn thành
  npm run study              Phiên học có checkpoint (pause/resume)  [-- --sync]
  npm run status             Tiến độ theo module (offline)
  npm run quiz               Quiz luyện tập từ ghi chú đã capture     [-- --module 2|all --count 5]
  npm run ask -- "câu hỏi"   Hỏi AI dựa trên ghi chú đã capture       [--module 2|all]
  npm run backfill           Lấy transcript các video đã học (tab nền) để summary đủ cả course  [-- --module 2]
  npm run summary            AI tóm tắt kiến thức từ transcript: từng module + cả course  [-- --module 2]

  Mọi lệnh nhận thêm -- --course <slug> để chạy cho course khác (thay COURSE_SLUG trong .env).

Không bao giờ: làm/nộp bài kiểm tra, đọc nội dung assessment, giả lập xem video.
"Mark as completed" chỉ bấm trên reading / ungraded item: khi bạn nhấn [d], hoặc tự động nếu AUTO_MARK_COMPLETE=1.`;

interface Flags {
  positional: string[];
  sync: boolean;
  screenshots: boolean;
  module?: ModuleFilter;
  count?: number;
  /** --course <slug>: work on another course for this one command (overrides COURSE_SLUG). */
  course?: string;
}

function parseFlags(args: string[]): Flags {
  const flags: Flags = { positional: [], sync: false, screenshots: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === '--sync') flags.sync = true;
    else if (arg === '--screenshots') flags.screenshots = true;
    else if (arg === '--module') {
      const value = args[++i];
      flags.module = value === 'all' ? 'all' : Number(value) || undefined;
    } else if (arg === '--count') flags.count = Math.min(20, Math.max(1, Number(args[++i]) || 5));
    else if (arg === '--course') flags.course = args[++i]?.trim() || undefined;
    else flags.positional.push(arg);
  }
  return flags;
}

async function login(config: Config): Promise<void> {
  const session = await openSession(config, courseUrl(config));
  try {
    if (await isLoggedIn(session.context)) {
      console.log('✓ Đã đăng nhập sẵn (session lưu trong .data/chrome-profile).');
    } else if (await waitForLogin(session)) {
      await session.page.goto(courseUrl(config), { waitUntil: 'domcontentloaded' });
      console.log('✓ Đăng nhập thành công. Session được giữ trong .data/chrome-profile (đã gitignore).');
    } else {
      console.log('✖ Hết thời gian chờ đăng nhập.');
      process.exitCode = 1;
    }
  } finally {
    await session.disconnect();
  }
}

async function sync(config: Config): Promise<void> {
  const session = await openSession(config, courseUrl(config));
  try {
    if (!(await isLoggedIn(session.context)) && !(await waitForLogin(session))) {
      process.exitCode = 1;
      return;
    }
    const store = await ProgressStore.open(config.progressPath, config.courseSlug);
    if (!(await syncOutline(session, config, store, new AuditLog(config.auditPath)))) process.exitCode = 1;
  } finally {
    await session.disconnect();
  }
  await printStatus(config);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  const config = loadConfig(flags.course ? { ...process.env, COURSE_SLUG: flags.course } : process.env);

  switch (command) {
    case 'login':
      return login(config);
    case 'probe': {
      const report = await runProbe(config, { screenshots: flags.screenshots });
      console.log(`\n📄 Probe report: ${report}`);
      return;
    }
    case 'sync':
      return sync(config);
    case 'study':
      return runStudy(config, { forceSync: flags.sync });
    case 'status':
      return printStatus(config);
    case 'quiz':
      return runQuiz(config, { module: flags.module, count: flags.count });
    case 'ask':
      return runAsk(config, flags.positional.join(' '), { module: flags.module });
    case 'summary':
      return runSummary(config, { module: flags.module });
    case 'backfill':
      return runBackfill(config, { module: flags.module });
    default:
      console.log(HELP);
  }
}

main().catch((error: unknown) => {
  console.error(`✖ ${(error as Error).message}`);
  process.exitCode = 1;
});
