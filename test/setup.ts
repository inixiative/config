import { afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Every temp dir a test makes, and every one the train makes in a child process, lands under one
// root per run, removed when the run ends.
const root = mkdtempSync(join(tmpdir(), 'inixiative-config-test-'));
process.env.TMPDIR = root;
// why: removing every run's temp tree can outlast the default 5 s hook timeout on a loaded machine.
afterAll(() => rmSync(root, { recursive: true, force: true }), 120_000);
