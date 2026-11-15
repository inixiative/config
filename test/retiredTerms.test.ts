import { describe, expect, test } from 'bun:test';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
  checkRetiredTerms(fixture.startsWith('/') ? fixture : join(fixtures, fixture))
    .findings.filter((finding) => finding.level === 'error')
    .map((finding) => finding.message);

describe('retired terms: pass', () => {
  test('clean copy passes: connections, the medical story, principal, castle icons, a changelog, a word in a generated region', () => {
    expect(checkRetiredTerms(join(fixtures, 'pass/clean')).findings).toEqual([]);
  });

  test('a marketing-only term is not checked in internal docs', () => {
    expect(scanRetiredTerms(join(fixtures, 'pass/clean'))).toEqual([]);
  });

  test('the allow list covers a file and a directory', () => {
    expect(scanRetiredTerms(join(fixtures, 'pass/allowed')).length).toBe(3);
    expect(checkRetiredTerms(join(fixtures, 'pass/allowed')).findings).toEqual([]);
  });

  test("a region's fresh verbatim copy of an allowed doc section is allowed with it", () => {
    const dir = join(fixtures, 'pass/allowed-copy');
    expect(scanRetiredTerms(dir).map((hit) => [hit.path, hit.copiedFrom?.path])).toEqual([
      ['.foundry/regions/conv/knowledge.md', 'docs/history/0.12.md'],
      ['docs/history/0.12.md', undefined],
    ]);
    expect(checkRetiredTerms(dir).findings).toEqual([]);
  });

  test('a stale copy of an allowed section carrying a retired name fails', () => {
    const dir = clone('pass/allowed-copy');
    const doc = join(dir, 'docs/history/0.12.md');
    writeFileSync(doc, readFileSync(doc, 'utf8').replace('The 0.12 grant', 'The old grant'));
    expect(errors(dir)).toEqual([
      expect.stringContaining('retired names in region .foundry/regions/conv: "threadsTerms"'),
    ]);
  });

  test('a snippet entry allows one history mention, wherever its line moves, and nothing else in the file', () => {
    const dir = clone('pass/history-snippet');
    expect(checkRetiredTerms(dir).findings).toEqual([]);
    const doc = join(dir, 'docs/CONVERSATIONS.md');
    writeFileSync(
      doc,
      `# Moved\n\nNew intro.\n\n${readFileSync(doc, 'utf8')}\nA member with \`floor.mayTake\` takes the conch.\n`,
    );
    expect(errors(dir)).toEqual([
      expect.stringMatching(
        /^retired term in docs\/CONVERSATIONS\.md:\d+: "floor\.mayTake" \(signet-may-take\)/,
      ),
    ]);
  });

  test('an allow line with a third field that is not a quoted snippet fails', () => {
    const dir = clone('pass/history-snippet');
    writeFileSync(
      join(dir, RETIRED_TERMS_DIR, 'allow.txt'),
      'docs/CONVERSATIONS.md\tsignet-may-take\tonce\n',
    );
    expect(errors(dir)).toContainEqual(
      expect.stringContaining('allow.txt: "docs/CONVERSATIONS.md\tsignet-may-take\tonce" is not'),
    );
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

  test('each name signet 0.18.0 removed fails with what replaced it', () => {
    expect(errors('fail/signet-names')).toEqual([
      expect.stringContaining(
        'docs/conversations.md:3: "`threads` resource" (signet-threads-resource) → a `conversation` integration resource',
      ),
      expect.stringContaining(
        'docs/conversations.md:3: "threadsResourceKind" (signet-threads-resource)',
      ),
      expect.stringContaining(
        'docs/conversations.md:4: "threadsTerms" (signet-grant-terms) → conversation permissions, picked on the grant like operations: member.log',
      ),
      'retired term in docs/conversations.md:4: "floor.mayTake" (signet-may-take) → the member.take conversation permission (signet 0.18.0)',
      expect.stringContaining(
        'docs/conversations.md:5: "grantReach" (signet-grant-reach) → the grant row',
      ),
    ]);
  });

  test('a removed name in a generated region says rebuild it, never which line to edit', () => {
    const found = errors('fail/stale-region');
    expect(found).toEqual([
      'retired term in .foundry/regions/README.md:3: "Kastle" (kastle) → Kingdom, owner, integration or Signet',
      'retired term in .foundry/warden-brief.md:3: "mayTake" (signet-may-take) → the member.take conversation permission (signet 0.18.0)',
      expect.stringMatching(
        /^retired names in region \.foundry\/base\/regions\/locks: "`threads` resource" \(knowledge\.md ×1\) → rebuild region locks in the repo whose docs \.foundry\/base\/regions was built from, then copy it here \(generated from the docs: never edit it by hand/,
      ),
      expect.stringMatching(
        /^retired names in \.foundry\/regions \(the set's own files\): "floor\.mayTake" \(GLOSSARY\.md ×1\) → rebuild the regions in \.foundry\/regions \(/,
      ),
      expect.stringMatching(
        /^retired names in region \.foundry\/regions\/conv: "threadsTerms", "narrowsThreadsTerms" \(knowledge\.md ×3, region\.json ×1\) → rebuild region conv \(generated from the docs: never edit it by hand; fix any source doc that still says this first\)\. Today: signet-grant-terms: conversation permissions/,
      ),
    ]);
    for (const message of found.filter((line) => line.startsWith('retired names')))
      expect(message).not.toMatch(/\.md:\d|\.json:\d/);
  });

  test('a marketing word in a generated region is not checked there; a removed concept is', () => {
    expect(scanRetiredTerms(join(fixtures, 'pass/clean'))).toEqual([]);
    expect(
      scanRetiredTerms(join(fixtures, 'fail/stale-region')).map((hit) => hit.term.removedConcept),
    ).not.toContain(undefined);
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

  test('adds uses of a term the baseline was not written against, and records the terms', () => {
    const dir = clone('fail/signet-names');
    mkdirSync(join(dir, RETIRED_TERMS_DIR), { recursive: true });
    writeFileSync(
      join(dir, RETIRED_TERMS_DIR, 'baseline.txt'),
      '# terms: kastle castle\ndocs/conversations.md\tkastle\t1\n',
    );
    writeFileSync(join(dir, 'README.md'), 'Kastle was the old name.\n');
    expect(writeRetiredTermsBaseline(dir)).toEqual({
      written: 0,
      refused: ['README.md kastle 1× (baseline 0)'],
    });
    rmSync(join(dir, 'README.md'));
    const result = writeRetiredTermsBaseline(dir);
    expect(result).toEqual({ written: 4, refused: [] });
    const written = readFileSync(join(dir, RETIRED_TERMS_DIR, 'baseline.txt'), 'utf8');
    expect(written).toContain('docs/conversations.md\tsignet-grant-terms\t1\n');
    expect(written).toMatch(/^# terms: kastle castle .*signet-grant-reach/m);
  });

  test("a baseline from the release before the terms line (Foundry's) is read as the first eight terms and rewritten", () => {
    const dir = clone('pass/legacy-baseline');
    const file = join(dir, RETIRED_TERMS_DIR, 'baseline.txt');
    expect(readFileSync(file, 'utf8')).not.toContain('# terms:');
    expect(errors(dir)).toHaveLength(2);
    expect(writeRetiredTermsBaseline(dir)).toEqual({ written: 2, refused: [] });
    const written = readFileSync(file, 'utf8');
    expect(written).toContain('docs/reference/CONVERSATIONS.md\tsignet-threads-resource\t1\n');
    expect(written).toContain('docs/reference/CONVERSATIONS.md\tsignet-may-take\t1\n');
    expect(written).toMatch(/^# terms: kastle castle .*signet-grant-reach$/m);
    expect(errors(dir)).toEqual([]);
    // Written once in the new format, it holds every term it names: a new Kastle is refused.
    writeFileSync(join(dir, 'README.md'), 'Kastle was the old name.\n');
    expect(writeRetiredTermsBaseline(dir).refused).toEqual(['README.md kastle 1× (baseline 0)']);
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
