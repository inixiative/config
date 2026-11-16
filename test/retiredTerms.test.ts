import { describe, expect, test } from 'bun:test';
import {
  chmodSync,
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

  test('a malformed allow line fails with its line number and the forms it can take', () => {
    const dir = clone('pass/history-snippet');
    const allow = (body: string) => {
      writeFileSync(join(dir, RETIRED_TERMS_DIR, 'allow.txt'), body);
      return errors(dir).filter((message) => message.includes('allow.txt'));
    };
    const forms = '→ write <term>, <path>\\t<term> or <path>\\t<term>\\t"<snippet>"';
    const at = (line: number, why: string) =>
      `${RETIRED_TERMS_DIR}/allow.txt:${line}: ${why} ${forms}`;
    expect(allow('# reason\ndocs/CONVERSATIONS.md\tsignet-may-take\tonce\n')).toEqual([
      at(2, 'the snippet once is not in double quotes'),
    ]);
    expect(allow('# reason\ndocs/CONVERSATIONS.md signet-may-take\n')).toEqual([
      at(
        2,
        '"docs/CONVERSATIONS.md signet-may-take" is not an allow entry (its fields are not tab-separated)',
      ),
    ]);
    expect(allow('# reason\ndocs/CONVERSATIONS.md \tsignet-may-take\n')).toEqual([
      at(
        2,
        '"docs/CONVERSATIONS.md \tsignet-may-take" is not an allow entry (tab-separated fields, nothing empty, no spaces around them)',
      ),
    ]);
    expect(allow('# reason\ndocs/CONVERSATIONS.md\tsignet-maytake\n')).toEqual([
      expect.stringMatching(/allow\.txt:2: "signet-maytake" is not a retired term \(kastle, /),
    ]);
    expect(allow('# reason\ndocs/*.md\tsignet-may-take\n')).toEqual([
      at(2, '"docs/*.md" is a pattern; paths are exact (a file, or a directory ending in /)'),
    ]);
    expect(allow('docs/CONVERSATIONS.md\tsignet-may-take\n')).toEqual([
      at(
        1,
        '"docs/CONVERSATIONS.md\tsignet-may-take" has no reason: put a # comment saying why above it',
      ),
    ]);
    expect(allow('# reason\ndocs/CONVERSATIONS.md\tsignet-may-take\t"e"\n')).toEqual([
      at(2, 'the snippet "e" does not contain signet-may-take'),
    ]);
    expect(allow('# reason\ndocs/CONVERSATIONS.md\tsignet-may-take\t"`floor.mayTake`"\n')).toEqual([
      at(
        2,
        'the snippet "`floor.mayTake`" is only the retired name: quote the words around it too',
      ),
    ]);
    expect(allow('# reason\ndocs/\tsignet-may-take\t"(once `floor.mayTake`)"\n')).toEqual([
      at(2, 'a snippet entry names one file, not "docs/"'),
    ]);
  });

  test('an allow entry that covers nothing fails: delete it', () => {
    const dir = clone('pass/history-snippet');
    writeFileSync(
      join(dir, RETIRED_TERMS_DIR, 'allow.txt'),
      '# reason\ndocs/CONVERSATIONS.md\tsignet-may-take\t"(once `floor.mayTake`)"\ndocs/CONVERSATIONS.md\tsignet-grant-reach\t"(`grantReach.ts`)"\ndocs/OTHER.md\tkastle\n',
    );
    expect(errors(dir)).toEqual([
      `${RETIRED_TERMS_DIR}/allow.txt:4: this allow covers nothing (no such file): delete it`,
    ]);
  });

  test('covers nothing says why: never scanned, nothing uses it there, an earlier entry covers it', () => {
    const dir = clone('pass/history-snippet');
    writeFileSync(
      join(dir, RETIRED_TERMS_DIR, 'allow.txt'),
      '# reason\ndocs/CONVERSATIONS.md\tsignet-may-take\t"(once `floor.mayTake`)"\ndocs/CONVERSATIONS.md\tsignet-grant-reach\t"(`grantReach.ts`)"\ndocs/CONVERSATIONS.md\tsignet-may-take\nnode_modules/x/README.md\tkastle\ndocs/CONVERSATIONS.md\tkastle\n',
    );
    expect(errors(dir)).toEqual([
      `${RETIRED_TERMS_DIR}/allow.txt:4: this allow covers nothing (an earlier entry (line 2) already covers its uses): delete it`,
      `${RETIRED_TERMS_DIR}/allow.txt:5: this allow covers nothing (its path is never scanned): delete it`,
      `${RETIRED_TERMS_DIR}/allow.txt:6: this allow covers nothing (nothing there uses kastle): delete it`,
    ]);
  });

  test('an allow entry for a region file that covers nothing now is a warning, never an error', () => {
    const dir = clone('pass/history-snippet');
    const region = join(dir, '.foundry/regions/rules');
    mkdirSync(region, { recursive: true });
    writeFileSync(
      join(region, 'knowledge.md'),
      '# Rules\n\nKastle is a retired name, named here on purpose.\n',
    );
    writeFileSync(
      join(dir, '.foundry/regions/GLOSSARY.md'),
      '# Glossary\n\n**Kastle**: the old name.\n',
    );
    writeFileSync(
      join(dir, RETIRED_TERMS_DIR, 'allow.txt'),
      `${readFileSync(join(dir, RETIRED_TERMS_DIR, 'allow.txt'), 'utf8')}\n# The rules region names the retired names.\n.foundry/regions/rules/\tkastle\n.foundry/regions/GLOSSARY.md\tkastle\n`,
    );
    expect(checkRetiredTerms(dir).findings).toEqual([]);
    const warns = () =>
      checkRetiredTerms(dir).findings.map((finding) => `${finding.level} ${finding.message}`);
    // Rebuilt without the name:
    writeFileSync(join(region, 'knowledge.md'), '# Rules\n\nNothing retired here now.\n');
    writeFileSync(join(dir, '.foundry/regions/GLOSSARY.md'), '# Glossary\n');
    expect(warns()).toEqual([
      `warn ${RETIRED_TERMS_DIR}/allow.txt:6: this allow covers nothing now (nothing there uses kastle): delete it when you next touch this file`,
      `warn ${RETIRED_TERMS_DIR}/allow.txt:7: this allow covers nothing now (nothing there uses kastle): delete it when you next touch this file`,
    ]);
    // Unreadable:
    writeFileSync(join(region, 'knowledge.md'), '# Rules\n\nKastle again.\n');
    if (process.getuid?.() !== 0) {
      chmodSync(join(dir, '.foundry/regions'), 0o000);
      try {
        expect(warns().every((line) => line.startsWith('warn '))).toBe(true);
        expect(warns()).toHaveLength(2);
      } finally {
        chmodSync(join(dir, '.foundry/regions'), 0o755);
      }
    }
  });

  test('an unreadable allow or baseline file is one error naming it, never a throw', () => {
    const dir = clone('pass/history-snippet');
    rmSync(join(dir, RETIRED_TERMS_DIR, 'allow.txt'));
    mkdirSync(join(dir, RETIRED_TERMS_DIR, 'allow.txt'));
    expect(errors(dir)).toContain(
      `can't read ${RETIRED_TERMS_DIR}/allow.txt (EISDIR): no allow entry applies`,
    );
    mkdirSync(join(dir, RETIRED_TERMS_DIR, 'baseline.txt'));
    expect(errors(dir)).toContain(
      `can't read ${RETIRED_TERMS_DIR}/baseline.txt (EISDIR): fix or delete it`,
    );
    expect(writeRetiredTermsBaseline(dir).refused).toEqual([
      `can't read ${RETIRED_TERMS_DIR}/baseline.txt (EISDIR): fix or delete it`,
    ]);
  });

  test('identical lines no snippet can tell apart get advice the author can follow', () => {
    const dir = clone('pass/history-snippet');
    const doc = join(dir, 'docs/CONVERSATIONS.md');
    const line = 'A member has `member.take` (once `floor.mayTake`).';
    writeFileSync(
      doc,
      `# Conversations\n\n${line}\n\n${line}\n\nThis replaced the reach check on the host (\`grantReach.ts\`).\n`,
    );
    expect(errors(dir)).toContainEqual(
      expect.stringContaining(
        'the snippet "(once `floor.mayTake`)" is on 2 identical lines of docs/CONVERSATIONS.md, so no snippet can name one: make the lines differ, allow the file with <path>\\t<term> if it is history as a whole, or baseline them',
      ),
    );
  });

  test('a snippet on more than one line of its file fails: lengthen it so it names one', () => {
    const dir = clone('pass/history-snippet');
    const doc = join(dir, 'docs/CONVERSATIONS.md');
    writeFileSync(
      doc,
      `${readFileSync(doc, 'utf8')}\nAgain: \`member.take\` (once \`floor.mayTake\`).\n`,
    );
    expect(errors(dir)).toContainEqual(
      expect.stringContaining(
        'the snippet "(once `floor.mayTake`)" is on 2 lines of docs/CONVERSATIONS.md: lengthen it so it names one',
      ),
    );
  });

  test('a snippet covers only the use it quotes, not another use on the same line', () => {
    const dir = clone('pass/history-snippet');
    const doc = join(dir, 'docs/CONVERSATIONS.md');
    writeFileSync(
      doc,
      readFileSync(doc, 'utf8').replace(
        '(once `floor.mayTake`).',
        '(once `floor.mayTake`); `floor.mayTake` still gates it.',
      ),
    );
    expect(errors(dir)).toEqual([expect.stringMatching(/CONVERSATIONS\.md:3: "floor\.mayTake"/)]);
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

  test('a removed name in a generated region never fails terms: the regions rule warns about it', () => {
    expect(errors('fail/names-in-and-beside-regions')).toEqual([
      'retired term in .foundry/regions/README.md:3: "Kastle" (kastle) → Kingdom, owner, integration or Signet',
      'retired term in .foundry/warden-brief.md:3: "mayTake" (signet-may-take) → the member.take conversation permission (signet 0.18.0)',
    ]);
    expect(
      scanRetiredTerms(join(fixtures, 'fail/names-in-and-beside-regions')).filter((hit) =>
        hit.path.includes('regions/'),
      ).length,
    ).toBeGreaterThan(2);
  });

  test('a marketing word in a generated region is not checked there; a removed concept is', () => {
    expect(scanRetiredTerms(join(fixtures, 'pass/clean'))).toEqual([]);
    expect(
      scanRetiredTerms(join(fixtures, 'fail/names-in-and-beside-regions')).map(
        (hit) => hit.term.removedConcept,
      ),
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
