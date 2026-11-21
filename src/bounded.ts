import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { constants, homedir } from 'node:os';
import { dirname, join } from 'node:path';

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
  | { ended: 'lock wait'; code: 75; path: string };

/** Set in a bounded command's environment: a `bounded` under it runs its command as it is. */
export const INSIDE_BOUNDED = 'INIXIATIVE_BOUNDED';
/** `bounded`'s exit code when the time limit stopped the command, as `timeout(1)`'s. */
export const TIME_LIMIT_EXIT_CODE = 124;

/** The machine's one slot for full checks: a flock(2) file, free again when its holder dies. */
export const checkLockPath = (): string => join(homedir(), '.foundry', 'check.lock');
/** `lockf`'s exit code (EX_TEMPFAIL) when the lock stayed held for the whole wait. */
const LOCK_WAIT_EXIT_CODE = 75;

/** The command that runs `command` holding the flock on `path`, waiting at most `seconds` for it. */
export const underLock = (path: string, seconds: number, command: readonly string[]): string[] =>
  process.platform === 'linux'
    ? ['flock', '-o', '-E', String(LOCK_WAIT_EXIT_CODE), '-w', String(seconds), path, ...command]
    : ['lockf', '-k', '-s', '-t', String(seconds), path, ...command];

/**
 * The `lockf` or `flock` on `path` that this process runs under, when a session wrapped the check
 * in one: it holds the lock a `bounded` below it would wait for.
 */
export const lockWrapperAbove = (path: string, from = process.ppid): string | null => {
  let pid = from;
  for (let depth = 0; depth < 40 && pid > 1; depth++) {
    const ps = spawnSync('ps', ['-o', 'ppid=,command=', '-p', String(pid)], { encoding: 'utf8' });
    const match = /^\s*(\d+)\s+(.*)$/.exec((ps.stdout ?? '').trim());
    if (!match) return null;
    const command = match[2] ?? '';
    if (/(^|\/)(lockf|flock)\s/.test(command) && command.includes(path)) return command;
    pid = Number(match[1]);
  }
  return null;
};

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
 * The group's first process. A watcher stays in the group reading descriptor 3, which only
 * `bounded` holds open: when `bounded` dies, a SIGKILL included, the read ends and the group is
 * killed at once, a wait for the lock included.
 */
const WITH_WATCHER = '(exec 4>&-; read _ <&3; kill -KILL 0) >/dev/null 2>&1 & exec "$@"';
/**
 * Run once the lock is held: descriptor 4 tells `bounded` the wait is over. The shell stays to
 * pass on 128 + the signal for a command a signal ended, which `lockf` reports as 70.
 */
const HOLDING_THE_LOCK = 'echo held >&4; exec 4>&- 3<&-; "$@"; exit $?';

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
    /** False under another `bounded`, which holds the lock: only the limits apply. */
    lock?: boolean;
  } = {},
): Promise<BoundedOutcome> => {
  if (command.length === 0) throw new Error('bounded: no command given');
  const bounds = { ...DEFAULT_BOUNDS, ...options.bounds };
  const say = options.say ?? ((line: string) => console.error(line));
  const path = options.lockPath ?? checkLockPath();
  const sampleMs = options.sampleMs ?? 10_000;
  mkdirSync(dirname(path), { recursive: true });
  const holding = ['sh', '-c', HOLDING_THE_LOCK, 'sh', ...command];
  const child = spawn(
    'sh',
    [
      '-c',
      WITH_WATCHER,
      'sh',
      ...(options.lock === false
        ? holding
        : underLock(path, Math.ceil(bounds.waitSeconds), holding)),
    ],
    {
      cwd: options.cwd ?? process.cwd(),
      stdio: ['inherit', 'inherit', 'inherit', 'pipe', 'pipe'],
      detached: true,
      env: { ...process.env, [INSIDE_BOUNDED]: String(process.pid) },
    },
  );
  const pgid = child.pid;
  const exited = new Promise<{ code: number; reason?: string }>((done) => {
    child.on('error', (error) => done({ code: 127, reason: error.message }));
    child.on('exit', (code, signal) => done({ code: exitCodeOf(code, signal) }));
  });
  const held = new Promise<true>((done) => child.stdio[4]?.once('data', () => done(true)));
  const stop = async () => {
    if (pgid) await stopGroup(pgid);
  };
  let signalled: number | null = null;
  const stopOnSignal = (
    [
      ['SIGINT', 130],
      ['SIGTERM', 143],
      ['SIGHUP', 129],
    ] as const
  ).map(([signal, code]) => {
    const handler = () => {
      signalled = code;
      void stop().finally(() => process.exit(code));
    };
    process.on(signal, handler);
    return [signal, handler] as const;
  });
  let peakBytes = 0;
  let heaviest = '';
  try {
    const waiting = setTimeout(
      () => say(`bounded: waiting for the machine's check lock (${path})`),
      Math.min(5_000, sampleMs),
    );
    const first = await Promise.race([held, exited]);
    clearTimeout(waiting);
    if (first !== true) {
      if (first.reason !== undefined)
        return { ended: 'not started', code: 127, reason: first.reason };
      // A command that ended at once may have its exit seen before its word that the lock was held.
      const ran = await Promise.race([held, sleep(200).then(() => false)]);
      return !ran && first.code === LOCK_WAIT_EXIT_CODE
        ? { ended: 'lock wait', code: LOCK_WAIT_EXIT_CODE, path }
        : { ended: 'exited', code: first.code };
    }
    const deadline = Date.now() + bounds.seconds * 1000;
    for (;;) {
      const end = await Promise.race([exited, sleep(sampleMs).then(() => null)]);
      if (end?.reason !== undefined) return { ended: 'not started', code: 127, reason: end.reason };
      if (end) return { ended: 'exited', code: end.code };
      if (!pgid) continue;
      const group = (options.memoryOf ?? fetchGroupMemory)(pgid);
      const bytes = group.reduce((sum, entry) => sum + entry.bytes, 0);
      if (bytes > peakBytes) {
        peakBytes = bytes;
        const most = group.reduce((a, b) => (b.bytes > a.bytes ? b : a));
        heaviest = `${most.command} (pid ${most.pid})`;
      }
      const over =
        bytes > bounds.memoryBytes ? 'memory ceiling' : Date.now() > deadline ? 'time limit' : null;
      if (!over) continue;
      await stop();
      await exited;
      return {
        ended: over,
        code: over === 'time limit' ? TIME_LIMIT_EXIT_CODE : 137,
        peakBytes,
        heaviest,
      };
    }
  } finally {
    await stop();
    // A signal to `bounded` ends it with that signal's code, whatever the stopped command gave.
    if (signalled !== null) process.exit(signalled);
    for (const [signal, handler] of stopOnSignal) process.off(signal, handler);
  }
};

/** The line a check that did not end by itself finishes on. */
export const boundedVerdict = (outcome: BoundedOutcome, bounds: Bounds): string | null => {
  if (outcome.ended === 'exited') return null;
  if (outcome.ended === 'not started')
    return `✗ bounded: the command did not start: ${outcome.reason}`;
  if (outcome.ended === 'lock wait')
    return `✗ bounded: gave up after ${Math.round(bounds.waitSeconds)} s waiting for the machine's check lock (${outcome.path})`;
  const peak = (outcome.peakBytes / 2 ** 30).toFixed(1);
  const most = outcome.heaviest || 'unknown';
  return outcome.ended === 'time limit'
    ? `✗ bounded: stopped at the ${Math.round(bounds.seconds / 60)} min time limit (peak ${peak} GB, most in ${most})`
    : `✗ bounded: stopped at the ${(bounds.memoryBytes / 2 ** 30).toFixed(1)} GB memory ceiling (peak ${peak} GB, most in ${most})`;
};
