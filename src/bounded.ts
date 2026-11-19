import { spawn, spawnSync } from 'node:child_process';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { acquireMachineLock, type MachineLockHolder, processStart } from './lib';

/** What holds the machine's one check slot. */
export type CheckLock = MachineLockHolder & { cwd: string; command: string };

export type Bounds = {
  /** Wall-clock seconds the command may run once it holds the lock. */
  seconds: number;
  /** Memory the command's whole process group may hold, compressed pages included. */
  memoryBytes: number;
  /** Seconds to wait for the lock before giving up. */
  waitSeconds: number;
};

export const DEFAULT_BOUNDS: Bounds = {
  seconds: 40 * 60,
  memoryBytes: 12 * 2 ** 30,
  waitSeconds: 4 * 60 * 60,
};

export type BoundedOutcome =
  | { ended: 'exited'; code: number }
  | { ended: 'time limit' | 'memory ceiling'; code: number; peakBytes: number; heaviest: string }
  | { ended: 'lock wait'; code: number; heldBy: CheckLock };

/** One machine-wide slot for full checks, beside the train's lock. */
export const checkLockPath = (): string => join(homedir(), '.inixiative', 'check.lock');

const UNITS: Record<string, number> = { B: 1, K: 2 ** 10, M: 2 ** 20, G: 2 ** 30, T: 2 ** 40 };

/**
 * Memory held by each process of group `pgid`, by command. macOS reads `top`, whose MEM is the
 * footprint (a process the system has compressed shows a small RSS: 23 GB read as 5 GB on
 * 2026-11-19); elsewhere RSS from `ps`.
 */
export const groupMemory = (pgid: number): { bytes: number; command: string }[] => {
  if (process.platform === 'darwin') {
    const top = spawnSync('top', ['-l', '1', '-n', '5000', '-stats', 'pgrp,mem,command'], {
      encoding: 'utf8',
    });
    return (top.stdout ?? '').split('\n').flatMap((line) => {
      const match = /^\s*(\d+)\s+([\d.]+)([BKMGT])\S*\s+(.*)$/.exec(line);
      return match && Number(match[1]) === pgid
        ? [
            {
              bytes: Number(match[2]) * (UNITS[match[3] ?? 'B'] ?? 1),
              command: (match[4] ?? '').trim(),
            },
          ]
        : [];
    });
  }
  const ps = spawnSync('ps', ['-eo', 'pgid=,rss=,comm='], { encoding: 'utf8' });
  return (ps.stdout ?? '').split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return match && Number(match[1]) === pgid
      ? [{ bytes: Number(match[2]) * 1024, command: (match[3] ?? '').trim() }]
      : [];
  });
};

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

const stopGroup = async (pgid: number): Promise<void> => {
  const signal = (name: NodeJS.Signals) => {
    try {
      process.kill(-pgid, name);
      return true;
    } catch {
      return false;
    }
  };
  if (!signal('SIGTERM')) return;
  for (let waited = 0; waited < 10_000 && signal(0 as unknown as NodeJS.Signals); waited += 200)
    await sleep(200);
  signal('SIGKILL');
};

/**
 * Run `command` as the machine's one full check: wait for the lock, then stop the command's
 * whole process group when it outlives `seconds` or holds more than `memoryBytes`. Exit codes
 * follow `timeout(1)`: 124 for the time limit, 137 for the memory ceiling, 75 for the lock wait.
 */
export const runBounded = async (
  command: readonly string[],
  options: {
    bounds?: Partial<Bounds>;
    lockPath?: string;
    cwd?: string;
    sampleMs?: number;
    say?: (line: string) => void;
    memoryOf?: typeof groupMemory;
  } = {},
): Promise<BoundedOutcome> => {
  const bounds = { ...DEFAULT_BOUNDS, ...options.bounds };
  const say = options.say ?? ((line: string) => console.error(line));
  const cwd = options.cwd ?? process.cwd();
  const path = options.lockPath ?? checkLockPath();
  const sampleMs = options.sampleMs ?? 10_000;
  const holder: CheckLock = {
    pid: process.pid,
    hostname: hostname(),
    processStart: processStart(process.pid),
    startedAt: new Date().toISOString(),
    cwd,
    command: command.join(' '),
  };
  const waitUntil = Date.now() + bounds.waitSeconds * 1000;
  let told = '';
  let lock = acquireMachineLock(path, holder);
  while (!lock.ok) {
    if (Date.now() > waitUntil) return { ended: 'lock wait', code: 75, heldBy: lock.heldBy };
    const who = `${lock.heldBy.cwd} (pid ${lock.heldBy.pid}, since ${lock.heldBy.startedAt})`;
    if (who !== told) say(`bounded: waiting for the check in ${who}`);
    told = who;
    await sleep(Math.min(5_000, sampleMs));
    lock = acquireMachineLock(path, holder);
  }
  const { release } = lock;
  const [file, ...args] = command;
  if (!file) throw new Error('bounded: no command given');
  const child = spawn(file, args, { cwd, stdio: 'inherit', detached: true });
  const pgid = child.pid;
  const exited = new Promise<number>((done) => {
    child.on('error', () => done(127));
    child.on('exit', (code, signal) => done(code ?? (signal ? 128 : 1)));
  });
  const passOn = (signal: NodeJS.Signals) => () => {
    if (pgid) void stopGroup(pgid);
    release();
    process.exit(signal === 'SIGINT' ? 130 : signal === 'SIGHUP' ? 129 : 143);
  };
  const handlers = (['SIGINT', 'SIGTERM', 'SIGHUP'] as const).map(
    (signal) => [signal, passOn(signal)] as const,
  );
  for (const [signal, handler] of handlers) process.on(signal, handler);
  process.on('exit', release);
  const deadline = Date.now() + bounds.seconds * 1000;
  let peakBytes = 0;
  let heaviest = '';
  try {
    for (;;) {
      const code = await Promise.race([exited, sleep(sampleMs).then(() => null)]);
      if (code !== null) return { ended: 'exited', code };
      if (!pgid) continue;
      const held = (options.memoryOf ?? groupMemory)(pgid);
      const bytes = held.reduce((sum, entry) => sum + entry.bytes, 0);
      if (bytes > peakBytes) {
        peakBytes = bytes;
        heaviest = held.reduce((a, b) => (b.bytes > a.bytes ? b : a), {
          bytes: 0,
          command: '',
        }).command;
      }
      const over =
        bytes > bounds.memoryBytes ? 'memory ceiling' : Date.now() > deadline ? 'time limit' : null;
      if (!over) continue;
      await stopGroup(pgid);
      await exited;
      return { ended: over, code: over === 'time limit' ? 124 : 137, peakBytes, heaviest };
    }
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler);
    process.off('exit', release);
    release();
  }
};

/** The line a stopped check ends on: which bound, how far, and what held the most. */
export const boundedVerdict = (outcome: BoundedOutcome, bounds: Bounds): string | null => {
  if (outcome.ended === 'exited') return null;
  if (outcome.ended === 'lock wait')
    return `✗ bounded: gave up after ${Math.round(bounds.waitSeconds / 60)} min waiting for the check in ${outcome.heldBy.cwd} (pid ${outcome.heldBy.pid})`;
  const peak = (outcome.peakBytes / 2 ** 30).toFixed(1);
  return outcome.ended === 'time limit'
    ? `✗ bounded: stopped at the ${Math.round(bounds.seconds / 60)} min time limit (peak ${peak} GB, most in ${outcome.heaviest || 'unknown'})`
    : `✗ bounded: stopped at the ${(bounds.memoryBytes / 2 ** 30).toFixed(1)} GB memory ceiling (peak ${peak} GB, most in ${outcome.heaviest || 'unknown'})`;
};
