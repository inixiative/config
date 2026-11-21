import { describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  boundedVerdict,
  DEFAULT_BOUNDS,
  exitCodeOf,
  groupProcessesInTop,
  runBounded,
  underLock,
} from '../src/bounded';
import { packageRoot } from '../src/lib';

const scratch = () => mkdtempSync(join(tmpdir(), 'bounded-'));
/** No real memory reading: `top` takes about a second, in which a short test command has ended. */
const quiet = { say: () => {}, sampleMs: 150, memoryOf: () => [] };
const alive = (marker: string) =>
  spawnSync('pgrep', ['-f', marker], { encoding: 'utf8' }).stdout.trim() !== '';
const until = async (done: () => boolean, ms: number) => {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (done()) return true;
    await new Promise((next) => setTimeout(next, 100));
  }
  return done();
};
/** Whether nobody holds the flock on `path` (the file itself stays, as `lockf -k` leaves it). */
const free = (path: string) => {
  const [file = '', ...args] = underLock(path, 0, ['true']);
  return spawnSync(file, args).status === 0;
};
const marker = (name: string) => `bounded-${name}-${process.pid}-${Date.now()}`;
const cli = join(packageRoot, 'src', 'cli.ts');
const cliEnv = (home: string) => ({ ...process.env, HOME: home, CI: '', INIXIATIVE_BOUNDED: '' });

describe('bounded', () => {
  test('a command that ends inside its bounds returns its own exit code and frees the lock', async () => {
    const lockPath = join(scratch(), 'check.lock');
    expect(await runBounded(['sh', '-c', 'exit 3'], { ...quiet, lockPath })).toEqual({
      ended: 'exited',
      code: 3,
    });
    expect(free(lockPath)).toBe(true);
  });

  test('past the time limit the whole process group is stopped, grandchildren included', async () => {
    const lockPath = join(scratch(), 'check.lock');
    const mark = marker('time');
    const outcome = await runBounded(
      ['sh', '-c', `sh -c 'sleep 60; : ${mark}' & sleep 60; : ${mark}`],
      { ...quiet, lockPath, bounds: { seconds: 0.5 } },
    );
    expect(outcome).toMatchObject({ ended: 'time limit', code: 124 });
    expect(alive(mark)).toBe(false);
    expect(free(lockPath)).toBe(true);
  }, 30_000);

  test('past the memory ceiling the group is stopped and the heaviest process is named', async () => {
    const outcome = await runBounded(['sleep', '60'], {
      ...quiet,
      lockPath: join(scratch(), 'check.lock'),
      bounds: { memoryBytes: 2 ** 30 },
      memoryOf: () => [
        { pid: 11, bytes: 2 ** 29, command: 'tsc' },
        { pid: 12, bytes: 3 * 2 ** 30, command: 'bun' },
      ],
    });
    expect(outcome).toEqual({
      ended: 'memory ceiling',
      code: 137,
      peakBytes: 3.5 * 2 ** 30,
      heaviest: 'bun (pid 12)',
    });
  }, 30_000);

  test('the real memory reading sees a process that holds memory', async () => {
    const hold =
      'const held = Buffer.alloc(400 * 2 ** 20, 1); setTimeout(() => held.length, 60000);';
    const outcome = await runBounded(['bun', '-e', hold], {
      say: () => {},
      sampleMs: 1_000,
      lockPath: join(scratch(), 'check.lock'),
      bounds: { memoryBytes: 200 * 2 ** 20 },
    });
    expect(outcome).toMatchObject({ ended: 'memory ceiling', code: 137 });
    if (outcome.ended === 'memory ceiling')
      expect(outcome.peakBytes).toBeGreaterThan(300 * 2 ** 20);
  }, 90_000);

  test('top output is read per process group, whatever unit and name it prints', () => {
    const output = [
      'Processes: 868 total, 3 running',
      'PID    PGRP  MEM    COMMAND',
      '943    943   48M    Google Chrome He',
      '57202  57202 20G+   bun',
      '57210  57202 3393K- sh',
      '57211  57202 0B     sleep',
      '99     1     1024M  launchd',
    ].join('\n');
    expect(groupProcessesInTop(output, 57202)).toEqual([
      { pid: 57202, bytes: 20 * 2 ** 30, command: 'bun' },
      { pid: 57210, bytes: 3393 * 2 ** 10, command: 'sh' },
      { pid: 57211, bytes: 0, command: 'sleep' },
    ]);
    expect(groupProcessesInTop(output, 943)).toEqual([
      { pid: 943, bytes: 48 * 2 ** 20, command: 'Google Chrome He' },
    ]);
  });

  test('what the command left running in its group is stopped when it ends', async () => {
    const mark = marker('left');
    const outcome = await runBounded(['sh', '-c', `(sleep 60; : ${mark}) & exit 0`], {
      ...quiet,
      lockPath: join(scratch(), 'check.lock'),
    });
    expect(outcome).toEqual({ ended: 'exited', code: 0 });
    expect(alive(mark)).toBe(false);
  }, 30_000);

  test('a killed bounded takes its command with it: nothing runs on without limits', async () => {
    const home = scratch();
    const mark = marker('killed');
    const bounded = spawn('bun', [cli, 'bounded', '--', 'sh', '-c', `sleep 60; : ${mark}`], {
      env: cliEnv(home),
      stdio: 'ignore',
    });
    expect(await until(() => existsSync(join(home, '.foundry', 'check.lock')), 20_000)).toBe(true);
    await until(() => false, 500);
    bounded.kill('SIGKILL');
    expect(await until(() => !alive(mark), 20_000)).toBe(true);
  }, 60_000);

  test('a signal to bounded stops a command that ignores SIGTERM before the lock is freed', async () => {
    const home = scratch();
    const mark = marker('stubborn');
    const lockPath = join(home, '.foundry', 'check.lock');
    const bounded = spawn(
      'bun',
      [cli, 'bounded', '--', 'sh', '-c', `trap "" TERM; sleep 60 & wait; : ${mark}`],
      { env: cliEnv(home), stdio: 'ignore' },
    );
    const ended = new Promise<number | null>((done) => bounded.on('exit', (code) => done(code)));
    expect(await until(() => existsSync(lockPath), 20_000)).toBe(true);
    await until(() => false, 500);
    bounded.kill('SIGTERM');
    expect(await ended).toBe(143);
    expect(alive(mark)).toBe(false);
    expect(free(lockPath)).toBe(true);
  }, 60_000);

  test('SIGINT to bounded exits 130, and a bounded killed while it waits leaves no waiter', async () => {
    const home = scratch();
    const lockPath = join(home, '.foundry', 'check.lock');
    const mark = marker('waiter');
    const interrupted = spawn('bun', [cli, 'bounded', '--', 'sleep', '60'], {
      env: cliEnv(home),
      stdio: 'ignore',
    });
    const ended = new Promise<number | null>((done) =>
      interrupted.on('exit', (code) => done(code)),
    );
    expect(await until(() => existsSync(lockPath) && !free(lockPath), 20_000)).toBe(true);
    const waiting = spawn('bun', [cli, 'bounded', '--', 'sh', '-c', `sleep 60; : ${mark}`], {
      env: cliEnv(home),
      stdio: 'ignore',
    });
    expect(await until(() => alive(mark), 20_000)).toBe(true);
    waiting.kill('SIGKILL');
    expect(await until(() => !alive(mark), 20_000)).toBe(true);
    interrupted.kill('SIGINT');
    expect(await ended).toBe(130);
    expect(free(lockPath)).toBe(true);
  }, 90_000);

  test('a second check waits for the first, then runs', async () => {
    const dir = scratch();
    const lockPath = join(dir, 'check.lock');
    const log = join(dir, 'order.log');
    const first = runBounded(
      ['sh', '-c', `echo a-start >> ${log}; sleep 1; echo a-end >> ${log}`],
      { ...quiet, lockPath },
    );
    await new Promise((done) => setTimeout(done, 300));
    const said: string[] = [];
    const second = runBounded(['sh', '-c', `echo b-start >> ${log}; echo b-end >> ${log}`], {
      ...quiet,
      lockPath,
      say: (line) => said.push(line),
    });
    expect((await first).code).toBe(0);
    expect((await second).code).toBe(0);
    expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual([
      'a-start',
      'a-end',
      'b-start',
      'b-end',
    ]);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain(lockPath);
  }, 30_000);

  test('a wait longer than waitSeconds gives up with exit 75 and names the lock', async () => {
    const lockPath = join(scratch(), 'check.lock');
    const [file = '', ...args] = underLock(lockPath, 0, ['sleep', '5']);
    const holder = spawn(file, args, { stdio: 'ignore' });
    await until(() => !free(lockPath), 5_000);
    const outcome = await runBounded(['true'], {
      ...quiet,
      lockPath,
      bounds: { waitSeconds: 0.3 },
    });
    holder.kill();
    expect(outcome).toEqual({ ended: 'lock wait', code: 75, path: lockPath });
    expect(boundedVerdict(outcome, { ...DEFAULT_BOUNDS, waitSeconds: 120 })).toBe(
      `✗ bounded: gave up after 120 s waiting for the machine's check lock (${lockPath})`,
    );
  }, 30_000);

  test('it queues with a plain lockf on the same file, and a file left behind is no lock', async () => {
    const dir = scratch();
    const lockPath = join(dir, 'check.lock');
    const log = join(dir, 'order.log');
    writeFileSync(lockPath, '');
    const [file = '', ...args] = underLock(lockPath, 30, [
      'sh',
      '-c',
      `echo a-start >> ${log}; sleep 1; echo a-end >> ${log}`,
    ]);
    const plain = spawn(file, args, { stdio: 'ignore' });
    const ended = new Promise((done) => plain.on('exit', done));
    await until(() => existsSync(log), 5_000);
    const outcome = await runBounded(['sh', '-c', `echo b-start >> ${log}`], {
      ...quiet,
      lockPath,
    });
    await ended;
    expect(outcome).toEqual({ ended: 'exited', code: 0 });
    expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual(['a-start', 'a-end', 'b-start']);
  }, 30_000);

  test('a command that does not exist exits 127 and says why; one killed by a signal exits 128 + the signal', async () => {
    const lockPath = join(scratch(), 'check.lock');
    const missing = await runBounded(['no-such-command-here'], { ...quiet, lockPath });
    expect(missing).toEqual({ ended: 'exited', code: 127 });
    const killed = await runBounded(['sh', '-c', 'kill -SEGV $$'], { ...quiet, lockPath });
    expect(killed).toEqual({ ended: 'exited', code: 139 });
    expect(exitCodeOf(null, 'SIGKILL')).toBe(137);
    expect(exitCodeOf(2, null)).toBe(2);
  });

  test('the CLI: flags after -- reach the command, -- is required, a bounded under a bounded takes no lock and keeps its limits', () => {
    const home = scratch();
    const run = (args: string[], env = cliEnv(home)) =>
      spawnSync('bun', [cli, 'bounded', ...args], { encoding: 'utf8', env });
    expect(run(['--minutes=1', '--', 'sh', '-c', 'exit 7']).status).toBe(7);
    expect(run(['--', 'sh', '-c', 'echo "$@"', 'sh', '--minutes=3', '--flag']).stdout.trim()).toBe(
      '--minutes=3 --flag',
    );
    for (const args of [[], ['true']]) {
      const refused = run(args);
      expect(refused.status).toBe(2);
      expect(refused.stderr).toContain('give the command after --');
    }
    expect(run(['--memory-gb=0', '--', 'true']).stderr).toContain(
      '--memory-gb takes a number above zero',
    );
    const nested = run([
      '--',
      'bun',
      cli,
      'bounded',
      '--wait-minutes=0.05',
      '--',
      'sh',
      '-c',
      'exit 5',
    ]);
    expect(nested.status).toBe(5);
    const nestedLimit = run(['--', 'bun', cli, 'bounded', '--minutes=0.01', '--', 'sleep', '60']);
    expect(nestedLimit.status).toBe(124);
    expect(nestedLimit.stderr).toContain('time limit');
    mkdirSync(join(home, '.foundry'), { recursive: true });
    const [lockf = '', ...lockfArgs] = underLock(join(home, '.foundry', 'check.lock'), 0, [
      'bun',
      cli,
      'bounded',
      '--',
      'true',
    ]);
    const wrapped = spawnSync(lockf, lockfArgs, { encoding: 'utf8', env: cliEnv(home) });
    expect(wrapped.status).toBe(2);
    expect(wrapped.stderr).toContain('Run it plain');
    const inCi = run(['--', 'sh', '-c', 'kill -TERM $$'], { ...cliEnv(home), CI: 'true' });
    expect(inCi.status).toBe(143);
    const missingInCi = run(['--', 'no-such-command-here'], { ...cliEnv(home), CI: 'true' });
    expect(missingInCi.status).toBe(127);
    expect(missingInCi.stderr).toContain('did not start');
  }, 90_000);

  test('verdict lines say the bound, the peak and the heaviest process', () => {
    expect(
      boundedVerdict(
        {
          ended: 'memory ceiling',
          code: 137,
          peakBytes: 23 * 2 ** 30,
          heaviest: 'bun (pid 57202)',
        },
        DEFAULT_BOUNDS,
      ),
    ).toBe(
      '✗ bounded: stopped at the 12.0 GB memory ceiling (peak 23.0 GB, most in bun (pid 57202))',
    );
    expect(
      boundedVerdict(
        { ended: 'time limit', code: 124, peakBytes: 2 ** 30, heaviest: '' },
        DEFAULT_BOUNDS,
      ),
    ).toBe('✗ bounded: stopped at the 40 min time limit (peak 1.0 GB, most in unknown)');
    expect(boundedVerdict({ ended: 'exited', code: 0 }, DEFAULT_BOUNDS)).toBeNull();
  });
});
