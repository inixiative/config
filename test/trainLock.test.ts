import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireTrainLock, TRAIN_LOCK, type TrainLock } from '../src/lib';

const holder = (pid: number): TrainLock => ({
  pid,
  startedAt: '2026-10-08T00:00:00.000Z',
  lanes: ['primitives'],
  root: '/code',
});

describe('one train at a time', () => {
  test('a second train is refused while the first runs, and told who holds the lock', () => {
    const dir = mkdtempSync(join(tmpdir(), 'train-lock-'));
    const first = acquireTrainLock(dir, holder(process.pid));
    expect(first.ok).toBe(true);
    const parent = process.ppid;
    const second = acquireTrainLock(dir, { ...holder(parent), lanes: ['agentic'] });
    expect(second).toEqual({ ok: false, heldBy: holder(process.pid) });
    if (first.ok) first.release();
    expect(existsSync(join(dir, TRAIN_LOCK))).toBe(false);
  });

  test('a lock whose process is gone is stale and is taken over', () => {
    const dir = mkdtempSync(join(tmpdir(), 'train-lock-'));
    const dead = holder(2_147_483_000);
    writeFileSync(join(dir, TRAIN_LOCK), JSON.stringify(dead));
    const taken = acquireTrainLock(dir, holder(process.pid));
    expect(taken.ok && taken.reclaimed).toEqual(dead);
  });

  test("release never removes another train's lock", () => {
    const dir = mkdtempSync(join(tmpdir(), 'train-lock-'));
    const mine = acquireTrainLock(dir, holder(2_147_483_001));
    writeFileSync(join(dir, TRAIN_LOCK), JSON.stringify(holder(process.pid)));
    if (mine.ok) mine.release();
    expect(existsSync(join(dir, TRAIN_LOCK))).toBe(true);
  });
});
