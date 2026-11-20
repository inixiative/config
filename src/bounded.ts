import { spawn, spawnSync } from 'node:child_process';
import { constants, homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { acquireMachineLock, holdMachineLock, type MachineLockHolder, processStart } from './lib';

/** Who holds the machine's one check slot. */
export type CheckLockHolder = MachineLockHolder & { cwd: string; command: string };

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
  | { ended: 'not started'; code: 127; reason: string }
  | { ended: 'time limit' | 'memory ceiling'; code: number; peakBytes: number; heaviest: string }
  | { ended: 'lock wait'; code: 75; heldBy: CheckLockHolder; path: string };

/** Set in a bounded command's environment: a `bounded` under it runs its command as it is. */
export const INSIDE_BOUNDED = 'INIXIATIVE_BOUNDED';

/** The machine's one slot for full checks: its own file, on the same lock code as the train's. */
export const checkLockPath = (): string => join(homedir(), '.inixiative', 'check.lock');

/** The exit code a shell gives a process that ended this way. */
export const exitCodeOf = (code: number | null, signal: NodeJS.Signals | null): number =>
  code ?? (signal ? 128 + (constants.signals[signal] ?? 0) : 1);

type GroupProcess = { pid: number; bytes: number; command: string };

const UNITS: Record<string, number> = { B: 1, K: 2 ** 10, M: 2 ** 20, G: 2 ** 30, T: 2 ** 40 };

/** The processes of group `pgid` in `top -stats pid,pgrp,mem,command` output. */
export const groupProcessesInTop = (output: string, pgid: number): GroupProcess[] =>
  output.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+([\d.]+)([BKMGT])\S*\s+(.*)$/.exec(line);
    return match && Number(match[2]) === pgid
      ? [
          {
            pid: Number(match[1]),
            bytes: Number(match[3]) * (UNITS[match[4] ?? 'B'] ?? 1),
            command: (match[5] ?? '').trim(),
          },
        ]
      : [];
  });

const groupProcessesInPs = (output: string, pgid: number): GroupProcess[] =>
  output.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return match && Number(match[2]) === pgid
      ? [
          {
            pid: Number(match[1]),
            bytes: Number(match[3]) * 1024,
            command: (match[4] ?? '').trim(),
          },
        ]
      : [];
  });

/**
 * Memory held by each process of group `pgid`. macOS reads `top`, whose MEM is the footprint (a
 * process the system has compressed shows a small RSS: 23 GB read as 5 GB on 2026-11-19);
 * elsewhere, and when `top` gives nothing in 30 s, RSS from `ps`.
 */
export const fetchGroupMemory = (pgid: number): GroupProcess[] => {
  if (process.platform === 'darwin') {
    const top = spawnSync('top', ['-l', '1', '-n', '5000', '-stats', 'pid,pgrp,mem,command'], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    if (top.status === 0) return groupProcessesInTop(top.stdout, pgid);
  }
  const ps = spawnSync('ps', ['-eo', 'pid=,pgid=,rss=,comm='], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  return groupProcessesInPs(ps.stdout ?? '', pgid);
};

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

const signalGroup = (pgid: number, signal: NodeJS.Signals | 0): boolean => {
  try {
    process.kill(-pgid, signal);
    return true;
  } catch {
    return false;
  }
};

/** SIGTERM to the whole group, SIGKILL to whatever is left ten seconds later. */
const stopGroup = async (pgid: number): Promise<void> => {
  if (!signalGroup(pgid, 'SIGTERM')) return;
  for (let waited = 0; waited < 10_000 && signalGroup(pgid, 0); waited += 200) await sleep(200);
  signalGroup(pgid, 'SIGKILL');
};

/**
 * Runs beside the command in its group and reads descriptor 3, which only `bounded` holds open:
 * when `bounded` dies, a SIGKILL included, the read ends and the group is killed at once.
 */
const WITH_WATCHER = '(read _ <&3; kill -KILL 0) >/dev/null 2>&1 & exec "$@"';

/**
 * Run `command` as the machine's one full check: wait for the lock, then stop the command's
 * whole process group when it outlives `seconds` or holds more than `memoryBytes`, when
 * `bounded` itself is stopped, and once the command has ended (nothing it started stays behind).
 * Limits are read every `sampleMs`. Exit codes follow `timeout(1)`: 124 for the time limit, 137
 * for the memory ceiling, 75 for the lock wait.
 */
export const runBounded = async (
  command: readonly string[],
  options: {
    bounds?: Partial<Bounds>;
    lockPath?: string;
    cwd?: string;
    sampleMs?: number;
    say?: (line: string) => void;
    memoryOf?: typeof fetchGroupMemory;
  } = {},
): Promise<BoundedOutcome> => {
  if (command.length === 0) throw new Error('bounded: no command given');
  const bounds = { ...DEFAULT_BOUNDS, ...options.bounds };
  const say = options.say ?? ((line: string) => console.error(line));
  const cwd = options.cwd ?? process.cwd();
  const path = options.lockPath ?? checkLockPath();
  const sampleMs = options.sampleMs ?? 10_000;
  const holder: CheckLockHolder = {
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
    if (Date.now() > waitUntil) return { ended: 'lock wait', code: 75, heldBy: lock.heldBy, path };
    const { heldBy } = lock;
    const who = `${heldBy.cwd} (pid ${heldBy.pid} on ${heldBy.hostname}, since ${heldBy.startedAt}; lock ${path})`;
    if (who !== told) say(`bounded: waiting for the check in ${who}`);
    told = who;
    await sleep(Math.min(5_000, sampleMs));
    lock = acquireMachineLock(path, holder);
  }
  const { release } = lock;
  const child = spawn('sh', ['-c', WITH_WATCHER, 'sh', ...command], {
    cwd,
    stdio: ['inherit', 'inherit', 'inherit', 'pipe'],
    detached: true,
    env: { ...process.env, [INSIDE_BOUNDED]: String(process.pid) },
  });
  const pgid = child.pid;
  const exited = new Promise<{ code: number; reason?: string }>((done) => {
    child.on('error', (error) => done({ code: 127, reason: error.message }));
    child.on('exit', (code, signal) => done({ code: exitCodeOf(code, signal) }));
  });
  const stop = async () => {
    if (pgid) await stopGroup(pgid);
  };
  const unhold = holdMachineLock(release, stop);
  const deadline = Date.now() + bounds.seconds * 1000;
  let peakBytes = 0;
  let heaviest = '';
  try {
    for (;;) {
      const end = await Promise.race([exited, sleep(sampleMs).then(() => null)]);
      if (end?.reason !== undefined) return { ended: 'not started', code: 127, reason: end.reason };
      if (end) return { ended: 'exited', code: end.code };
      if (!pgid) continue;
      const held = (options.memoryOf ?? fetchGroupMemory)(pgid);
      const bytes = held.reduce((sum, entry) => sum + entry.bytes, 0);
      if (bytes > peakBytes) {
        peakBytes = bytes;
        const most = held.reduce((a, b) => (b.bytes > a.bytes ? b : a));
        heaviest = `${most.command} (pid ${most.pid})`;
      }
      const over =
        bytes > bounds.memoryBytes ? 'memory ceiling' : Date.now() > deadline ? 'time limit' : null;
      if (!over) continue;
      await stop();
      await exited;
      return { ended: over, code: over === 'time limit' ? 124 : 137, peakBytes, heaviest };
    }
  } finally {
    await stop();
    unhold();
    release();
  }
};

/** The line a check that did not end by itself finishes on. */
export const boundedVerdict = (outcome: BoundedOutcome, bounds: Bounds): string | null => {
  if (outcome.ended === 'exited') return null;
  if (outcome.ended === 'not started')
    return `✗ bounded: the command did not start: ${outcome.reason}`;
  if (outcome.ended === 'lock wait') {
    const { heldBy } = outcome;
    return `✗ bounded: gave up after ${Math.round(bounds.waitSeconds)} s waiting for the check in ${heldBy.cwd} (pid ${heldBy.pid} on ${heldBy.hostname}); if that check is gone, remove ${outcome.path}`;
  }
  const peak = (outcome.peakBytes / 2 ** 30).toFixed(1);
  const most = outcome.heaviest || 'unknown';
  return outcome.ended === 'time limit'
    ? `✗ bounded: stopped at the ${Math.round(bounds.seconds / 60)} min time limit (peak ${peak} GB, most in ${most})`
    : `✗ bounded: stopped at the ${(bounds.memoryBytes / 2 ** 30).toFixed(1)} GB memory ceiling (peak ${peak} GB, most in ${most})`;
};
