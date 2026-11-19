import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { boundedVerdict, type CheckLock, DEFAULT_BOUNDS, runBounded } from '../src/bounded';
import { packageRoot, processStart } from '../src/lib';

const scratch = () => mkdtempSync(join(tmpdir(), 'bounded-'));
/** No real memory reading: `top` takes about a second, in which a short test command has ended. */
const quiet = { say: () => {}, sampleMs: 150, memoryOf: () => [] };
const alive = (marker: string) =>
  spawnSync('pgrep', ['-f', marker], { encoding: 'utf8' }).stdout.trim() !== '';

describe('bounded', () => {
  test('a command that ends inside its bounds returns its own exit code and frees the lock', async () => {
    const lockPath = join(scratch(), 'check.lock');
    expect(await runBounded(['sh', '-c', 'exit 3'], { ...quiet, lockPath })).toEqual({
      ended: 'exited',
      code: 3,
    });
    expect(existsSync(lockPath)).toBe(false);
  });

  test('past the time limit the whole process group is stopped, grandchildren included', async () => {
    const lockPath = join(scratch(), 'check.lock');
    const marker = `bounded-time-${process.pid}-${Date.now()}`;
    const outcome = await runBounded(
      ['sh', '-c', `sh -c 'sleep 60; : ${marker}' & sleep 60; : ${marker}`],
      { ...quiet, lockPath, bounds: { seconds: 0.5 }, memoryOf: () => [] },
    );
    expect(outcome).toMatchObject({ ended: 'time limit', code: 124 });
    expect(alive(marker)).toBe(false);
    expect(existsSync(lockPath)).toBe(false);
  }, 30_000);

  test('past the memory ceiling the group is stopped and the heaviest process is named', async () => {
    const lockPath = join(scratch(), 'check.lock');
    const outcome = await runBounded(['sleep', '60'], {
      ...quiet,
      lockPath,
      bounds: { memoryBytes: 2 ** 30 },
      memoryOf: () => [
        { bytes: 2 ** 29, command: 'tsc' },
        { bytes: 3 * 2 ** 30, command: 'bun' },
      ],
    });
    expect(outcome).toEqual({
      ended: 'memory ceiling',
      code: 137,
      peakBytes: 3.5 * 2 ** 30,
      heaviest: 'bun',
    });
  }, 30_000);

  test('the real memory reading sees a process that holds memory', async () => {
    const lockPath = join(scratch(), 'check.lock');
    const hold =
      'const held = Buffer.alloc(400 * 2 ** 20, 1); setTimeout(() => held.length, 60000);';
    const outcome = await runBounded(['bun', '-e', hold], {
      say: () => {},
      sampleMs: 1_000,
      lockPath,
      bounds: { memoryBytes: 200 * 2 ** 20 },
    });
    expect(outcome).toMatchObject({ ended: 'memory ceiling', code: 137 });
    if (outcome.ended === 'memory ceiling')
      expect(outcome.peakBytes).toBeGreaterThan(300 * 2 ** 20);
  }, 60_000);

  test('a second check waits for the first, then runs', async () => {
    const dir = scratch();
    const lockPath = join(dir, 'check.lock');
    const log = join(dir, 'order.log');
    const step = (name: string, seconds: number) =>
      runBounded(
        ['sh', '-c', `echo ${name}-start >> ${log}; sleep ${seconds}; echo ${name}-end >> ${log}`],
        { ...quiet, lockPath },
      );
    const first = step('a', 1);
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
    expect(said[0]).toContain('waiting for the check in');
  }, 30_000);

  test('a wait longer than waitSeconds gives up with exit 75 and names the holder', async () => {
    const dir = scratch();
    const lockPath = join(dir, 'check.lock');
    const holder: CheckLock = {
      pid: process.pid,
      hostname: hostname(),
      processStart: processStart(process.pid),
      startedAt: '2026-11-19T00:00:00.000Z',
      cwd: '/code/kingdom',
      command: 'bun run check:all',
    };
    writeFileSync(lockPath, `${JSON.stringify(holder, null, 2)}\n`);
    const outcome = await runBounded(['true'], {
      ...quiet,
      lockPath,
      bounds: { waitSeconds: 0.3 },
    });
    expect(outcome).toEqual({ ended: 'lock wait', code: 75, heldBy: holder });
    expect(boundedVerdict(outcome, { ...DEFAULT_BOUNDS, waitSeconds: 60 })).toBe(
      `✗ bounded: gave up after 1 min waiting for the check in /code/kingdom (pid ${process.pid})`,
    );
  });

  test('a lock left by a dead check is taken over', async () => {
    const lockPath = join(scratch(), 'check.lock');
    const dead = spawnSync('sh', ['-c', 'echo $$'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: Number(dead),
        hostname: hostname(),
        processStart: null,
        startedAt: '',
        cwd: '/gone',
        command: 'x',
      }),
    );
    expect(await runBounded(['true'], { ...quiet, lockPath })).toEqual({
      ended: 'exited',
      code: 0,
    });
  });

  test('the CLI runs the command after -- and exits with its code; a missing command is a usage error', () => {
    const cli = join(packageRoot, 'src', 'cli.ts');
    const env = { ...process.env, HOME: scratch(), CI: '' };
    const run = (...args: string[]) =>
      spawnSync('bun', [cli, 'bounded', ...args], { encoding: 'utf8', env });
    expect(run('--minutes=1', '--', 'sh', '-c', 'exit 7').status).toBe(7);
    const none = run();
    expect(none.status).toBe(2);
    expect(none.stderr).toContain('give the command after --');
    expect(run('--memory-gb=0', '--', 'true').stderr).toContain(
      '--memory-gb takes a number above zero',
    );
  }, 30_000);

  test('verdict lines say the bound, the peak and the heaviest process', () => {
    expect(
      boundedVerdict(
        { ended: 'memory ceiling', code: 137, peakBytes: 23 * 2 ** 30, heaviest: 'bun' },
        DEFAULT_BOUNDS,
      ),
    ).toBe('✗ bounded: stopped at the 12.0 GB memory ceiling (peak 23.0 GB, most in bun)');
    expect(
      boundedVerdict(
        { ended: 'time limit', code: 124, peakBytes: 2 ** 30, heaviest: '' },
        DEFAULT_BOUNDS,
      ),
    ).toBe('✗ bounded: stopped at the 40 min time limit (peak 1.0 GB, most in unknown)');
    expect(boundedVerdict({ ended: 'exited', code: 0 }, DEFAULT_BOUNDS)).toBeNull();
  });
});
