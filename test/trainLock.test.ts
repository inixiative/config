import { describe, expect, test } from 'bun:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireTrainLock,
  isConfigCheckout,
  packageRoot,
  processStart,
  type TrainLock,
  trainLockPath,
} from '../src/lib';

const holder = (pid: number, overrides: Partial<TrainLock> = {}): TrainLock => ({
  pid,
  hostname: hostname(),
  processStart: processStart(pid),
  startedAt: '2026-10-08T00:00:00.000Z',
  lanes: ['primitives'],
  root: '/code',
  checkout: '/code/config',
  ...overrides,
});

const lockIn = () => join(mkdtempSync(join(tmpdir(), 'train-lock-')), 'locks', 'train.lock');

const lib = join(packageRoot, 'src', 'lib.ts');

/** A real process that waits for `at`, tries the lock, prints the outcome, then stays alive. */
const racer = (path: string, at: number) =>
  Bun.spawn(
    [
      process.execPath,
      '-e',
      `import { acquireTrainLock, processStart } from ${JSON.stringify(lib)};
       import { hostname } from 'node:os';
       while (Date.now() < ${at});
       const lock = acquireTrainLock(${JSON.stringify(path)}, {
         pid: process.pid, hostname: hostname(), processStart: processStart(process.pid),
         startedAt: new Date().toISOString(), lanes: ['primitives'], root: '/code', checkout: '/code/config',
       });
       console.log(lock.ok ? 'ok' : 'refused');
       await Bun.sleep(1500);`,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );

const race = async (path: string, racers: number): Promise<string[]> => {
  const at = Date.now() + 1000;
  const children = Array.from({ length: racers }, () => racer(path, at));
  return Promise.all(
    children.map(async (child) => {
      await child.exited;
      return (await new Response(child.stdout).text()).trim();
    }),
  );
};

describe('one train at a time', () => {
  test('a second train is refused while the first runs, and told who holds the lock', () => {
    const path = lockIn();
    const first = acquireTrainLock(path, holder(process.pid));
    expect(first.ok).toBe(true);
    const second = acquireTrainLock(path, { ...holder(process.ppid), lanes: ['agentic'] });
    expect(second).toEqual({ ok: false, heldBy: holder(process.pid), path });
    if (first.ok) first.release();
    expect(existsSync(path)).toBe(false);
  });

  test('a lock whose process is gone is stale and is taken over', () => {
    const path = lockIn();
    mkdirSync(join(path, '..'), { recursive: true });
    const dead = holder(2_147_483_000, { processStart: null });
    writeFileSync(path, JSON.stringify(dead));
    const taken = acquireTrainLock(path, holder(process.pid));
    expect(taken.ok && taken.reclaimed).toEqual({ reason: 'gone', holder: dead });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(holder(process.pid));
  });

  test("release never removes another train's lock", () => {
    const path = lockIn();
    const mine = acquireTrainLock(path, holder(2_147_483_001, { processStart: null }));
    writeFileSync(path, JSON.stringify(holder(process.pid)));
    if (mine.ok) mine.release();
    expect(existsSync(path)).toBe(true);
  });

  test('concurrent trains: exactly one takes the lock', async () => {
    for (let trial = 0; trial < 4; trial++) {
      const outcomes = await race(lockIn(), 8);
      expect(outcomes.filter((outcome) => outcome === 'ok')).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome === 'refused')).toHaveLength(7);
    }
  }, 30_000);

  test('concurrent trains racing a stale lock: exactly one takes it over', async () => {
    for (let trial = 0; trial < 4; trial++) {
      const path = lockIn();
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, JSON.stringify(holder(2_147_483_002, { processStart: null })));
      const outcomes = await race(path, 8);
      expect(outcomes.filter((outcome) => outcome === 'ok')).toHaveLength(1);
    }
  }, 30_000);

  test.each([
    '',
    '{"pid":',
    'null',
    '[]',
  ])('an unparsable lock (%p) is stale, and reported as corrupt', (body) => {
    const path = lockIn();
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, body);
    const taken = acquireTrainLock(path, holder(process.pid));
    expect(taken.ok && taken.reclaimed).toEqual({ reason: 'corrupt', contents: body });
  });

  test('a live pid that started after the lock was written is a reused pid, not the holder', () => {
    const path = lockIn();
    mkdirSync(join(path, '..'), { recursive: true });
    const before = holder(process.ppid, { processStart: 'Thu Jan  1 00:00:00 1970' });
    writeFileSync(path, JSON.stringify(before));
    const taken = acquireTrainLock(path, holder(process.pid));
    expect(taken.ok && taken.reclaimed).toEqual({ reason: 'pid reused', holder: before });
  });

  test("a lock from another host can't be checked, so it holds", () => {
    const path = lockIn();
    mkdirSync(join(path, '..'), { recursive: true });
    const elsewhere = holder(2_147_483_003, { hostname: 'elsewhere', processStart: null });
    writeFileSync(path, JSON.stringify(elsewhere));
    expect(acquireTrainLock(path, holder(process.pid))).toEqual({
      ok: false,
      heldBy: elsewhere,
      path,
    });
  });

  test.each(['SIGTERM', 'SIGHUP', 'SIGINT'] as const)('%s releases the lock', async (signal) => {
    const path = lockIn();
    const child = Bun.spawn(
      [
        process.execPath,
        '-e',
        `import { acquireTrainLock, holdTrainLock, processStart } from ${JSON.stringify(lib)};
           import { hostname } from 'node:os';
           const lock = acquireTrainLock(${JSON.stringify(path)}, {
             pid: process.pid, hostname: hostname(), processStart: processStart(process.pid),
             startedAt: new Date().toISOString(), lanes: ['primitives'], root: '/code', checkout: '/code/config',
           });
           if (!lock.ok) process.exit(9);
           holdTrainLock(lock.release);
           console.log('held');
           setInterval(() => {}, 1000);`,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const reader = child.stdout.getReader();
    await reader.read();
    expect(existsSync(path)).toBe(true);
    child.kill(signal);
    expect(await child.exited).not.toBe(0);
    expect(existsSync(path)).toBe(false);
  }, 10_000);
});

describe('where the lock lives', () => {
  test('one machine-wide path, shared by every checkout of config', () => {
    expect(trainLockPath()).toBe(join(homedir(), '.inixiative', 'train.lock'));
  });

  test('a train only runs from a git checkout of config', () => {
    expect(isConfigCheckout(packageRoot)).toBe(true);
    const copy = mkdtempSync(join(tmpdir(), 'bunx-cache-'));
    expect(isConfigCheckout(copy)).toBe(false);
    expect(isConfigCheckout(join(packageRoot, 'src'))).toBe(false);
  });

  test('the CLI refuses to train from a copy that is not a config checkout (a bunx cache)', () => {
    const copy = mkdtempSync(join(tmpdir(), 'bunx-cache-'));
    for (const entry of ['src', 'package.json', 'versions.json', 'ports.json']) {
      cpSync(join(packageRoot, entry), join(copy, entry), { recursive: true });
    }
    const result = Bun.spawnSync(
      [process.execPath, join(copy, 'src', 'cli.ts'), 'train', mkdtempSync(join(tmpdir(), 'r-'))],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('not a git checkout of inixiative/config');
  });
});
