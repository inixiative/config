import { describe, expect, test } from 'bun:test';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCommandLine, UsageError } from '../src/args';
import {
  checkRetiredTerms,
  RETIRED_TERMS_DIR,
  scanRetiredTerms,
  writeRetiredTermsBaseline,
} from '../src/retiredTerms';

const fixtures = join(import.meta.dir, 'fixtures', 'retired-terms');

const clone = (fixture: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'retired-terms-'));
  cpSync(join(fixtures, fixture), dir, { recursive: true });
  return dir;
};

const errors = (fixture: string) =>
  checkRetiredTerms(join(fixtures, fixture))
    .findings.filter((finding) => finding.level === 'error')
    .map((finding) => finding.message);

describe('retired terms: pass', () => {
  test('clean copy passes: connections, the medical story, principal, castle icons, a changelog, generated regions', () => {
    expect(checkRetiredTerms(join(fixtures, 'pass/clean')).findings).toEqual([]);
  });

  test('a marketing-only term is not checked in internal docs', () => {
    expect(scanRetiredTerms(join(fixtures, 'pass/clean'))).toEqual([]);
  });

  test('the allow list covers a file and a directory', () => {
    expect(scanRetiredTerms(join(fixtures, 'pass/allowed')).length).toBe(3);
    expect(checkRetiredTerms(join(fixtures, 'pass/allowed')).findings).toEqual([]);
  });

  test('baselined uses warn, never fail', () => {
    const { findings } = checkRetiredTerms(join(fixtures, 'pass/baselined'));
    expect(findings.map((finding) => finding.level)).toEqual(['warn']);
    expect(findings[0]?.message).toContain('2 retired-term uses');
  });
});

describe('retired terms: fail', () => {
  test('a new use fails with where, what and the word to use instead', () => {
    expect(errors('fail/new-use')).toEqual([
      'retired term in README.md:1: "Kastle" (kastle) → Kingdom, owner, integration or Signet',
    ]);
  });

  test('a retired Foundry role name in a README fails', () => {
    expect(errors('fail/public-role')).toEqual([
      expect.stringContaining('README.md:1: "Artificer" (foundry-roles)'),
    ]);
  });

  test('a package description is a public surface', () => {
    expect(errors('fail/package-description')).toEqual([
      expect.stringContaining('package.json:1: "Your own LLM keys" (own-llm-keys)'),
    ]);
  });

  test('a baseline entry that shrank or went away fails until the baseline is lowered', () => {
    expect(errors('fail/stale-baseline')).toEqual([
      `${RETIRED_TERMS_DIR}/baseline.txt: README.md uses foundry-roles 1× now, not 2 → lower its count`,
      `${RETIRED_TERMS_DIR}/baseline.txt: docs/gone.md no longer uses kastle → delete its line`,
    ]);
  });

  test('a baseline line without a count fails instead of reading as NaN', () => {
    expect(errors('fail/malformed-baseline')).toEqual([
      expect.stringContaining('"README.md\tkastle" is not'),
    ]);
  });

  test('uses above the baseline count fail, naming only the new ones', () => {
    expect(errors('fail/over-baseline')).toEqual([
      expect.stringContaining('README.md:1: "Librarian"'),
    ]);
  });
});

describe('writing the baseline', () => {
  test('writes one when there is none, and the repo then passes', () => {
    const dir = clone('fail/new-use');
    expect(writeRetiredTermsBaseline(dir)).toEqual({ written: 1, refused: [] });
    expect(readFileSync(join(dir, RETIRED_TERMS_DIR, 'baseline.txt'), 'utf8')).toContain(
      'README.md\tkastle\t1',
    );
    expect(checkRetiredTerms(dir).findings.map((finding) => finding.level)).toEqual(['warn']);
  });

  test('refuses to grow an existing baseline', () => {
    const dir = clone('fail/over-baseline');
    expect(writeRetiredTermsBaseline(dir)).toEqual({
      written: 0,
      refused: ['README.md foundry-roles 2× (baseline 1)'],
    });
  });

  test('shrinks an existing baseline, and deletes it once empty', () => {
    const dir = clone('fail/stale-baseline');
    expect(writeRetiredTermsBaseline(dir)).toEqual({ written: 1, refused: [] });
    expect(checkRetiredTerms(dir).findings.map((finding) => finding.level)).toEqual(['warn']);
    writeFileSync(join(dir, 'README.md'), 'Wardens point at what exists.\n');
    expect(writeRetiredTermsBaseline(dir)).toEqual({ written: 0, refused: [] });
    expect(existsSync(join(dir, RETIRED_TERMS_DIR, 'baseline.txt'))).toBe(false);
  });
});

describe('terms command line', () => {
  test('takes a dir and --write-baseline, nothing else', () => {
    expect(parseCommandLine(['terms', '/repo', '--write-baseline'])).toMatchObject({
      command: 'terms',
      positionals: ['/repo'],
      writeBaseline: true,
    });
    expect(() => parseCommandLine(['terms', '--preset=base'])).toThrow(UsageError);
    expect(() => parseCommandLine(['check', '--write-baseline'])).toThrow(UsageError);
  });
});
