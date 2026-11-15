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
import { cutDocUnits, slug, stripDoNotCopy } from '../src/docUnits';
import {
  checkRegionFreshness,
  REGION_FRESHNESS_DIR,
  writeRegionFreshnessBaseline,
} from '../src/regionFreshness';

// The region fixtures were written with the region builder's own units.py and assemble.py, so
// they are what the builder installs, not what this port expects.
const fixtures = join(import.meta.dir, 'fixtures', 'region-freshness');

const clone = (fixture: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'region-freshness-'));
  cpSync(join(fixtures, fixture), dir, { recursive: true });
  return dir;
};

const edit = (dir: string, path: string, from: string, to: string) => {
  const abs = join(dir, path);
  const text = readFileSync(abs, 'utf8');
  expect(text).toContain(from);
  writeFileSync(abs, text.replace(from, to));
};

const messages = (dir: string, level: 'error' | 'warn') =>
  checkRegionFreshness(dir)
    .findings.filter((finding) => finding.level === level)
    .map((finding) => finding.message);

const statuses = (dir: string) =>
  Object.fromEntries(checkRegionFreshness(dir).regions.map((region) => [region.id, region.status]));

describe('region freshness: fresh', () => {
  test('a region whose copies match the docs today is fresh; a unit from another repo is named once', () => {
    const dir = join(fixtures, 'repo');
    expect(statuses(dir)).toEqual({ locks: 'fresh', widgets: 'fresh' });
    expect(messages(dir, 'error')).toEqual([]);
    expect(messages(dir, 'warn')).toEqual([
      "1 doc unit in .foundry/regions copy other repos' docs (lib), not checked here",
    ]);
  });

  test('a change only to "Do not copy" material leaves the region fresh', () => {
    const dir = clone('repo');
    edit(dir, 'docs/guide.md', '- src/old/lock.ts', '- src/old/other-lock.ts');
    edit(dir, 'docs/guide.md', 'The old way.', 'The older way.');
    expect(statuses(dir)).toEqual({ locks: 'fresh', widgets: 'fresh' });
  });

  test('a region built before "Do not copy" stripping still compares', () => {
    expect(statuses(join(fixtures, 'old-cut'))).toEqual({ locks: 'fresh' });
  });

  test('a repo with no regions passes with nothing to say', () => {
    expect(checkRegionFreshness(join(fixtures, 'no-regions'))).toEqual({
      findings: [],
      layers: [],
      regions: [],
    });
  });
});

describe('region freshness: stale', () => {
  test('a changed doc section makes its region stale: rebuild it, never edit it', () => {
    const dir = clone('repo');
    edit(dir, 'README.md', "`size` is the widget's size.", "`size` is the widget's width.");
    expect(statuses(dir)).toEqual({ locks: 'fresh', widgets: 'stale' });
    expect(messages(dir, 'error')).toEqual([
      'region .foundry/regions/widgets is stale: doc:README.md#usage changed (+1 −1 lines; now: "`size` is the widget\'s width.") → rebuild region widgets (generated from the docs: never edit its files by hand)',
    ]);
  });

  test('a renamed heading leaves the unit with no section today', () => {
    const dir = clone('repo');
    edit(dir, 'README.md', '## Errors', '## Failures');
    expect(messages(dir, 'error')).toEqual([
      'region .foundry/regions/widgets is stale: doc:README.md#errors gone (no such section today) → rebuild region widgets (generated from the docs: never edit its files by hand)',
    ]);
  });

  test('a missing doc file leaves the unit with no file; the other repo’s unit is still not checked', () => {
    const dir = clone('repo');
    rmSync(join(dir, 'docs/guide.md'));
    const { regions } = checkRegionFreshness(dir);
    expect(regions.find((region) => region.id === 'locks')?.units).toEqual([
      { unit: 'doc:docs/guide.md#locks', state: 'gone', missing: 'file' },
      { unit: 'doc:lib/README.md#install', state: 'elsewhere', library: 'lib' },
    ]);
    expect(messages(dir, 'error')).toEqual([
      expect.stringContaining('doc:docs/guide.md#locks gone (no such file) → rebuild region locks'),
    ]);
  });

  test('the H1 is part of the copy: a renamed doc is a stale region', () => {
    const dir = clone('repo');
    edit(dir, 'README.md', '# Widgets', '# Gadgets');
    expect(statuses(dir).widgets).toBe('stale');
  });
});

describe('region freshness: unverifiable', () => {
  test('a region without part 4 is a warning: nothing to compare', () => {
    const dir = join(fixtures, 'no-part-4');
    expect(statuses(dir)).toEqual({ widgets: 'unverifiable' });
    expect(messages(dir, 'error')).toEqual([]);
    expect(messages(dir, 'warn')).toEqual([
      "region .foundry/regions/widgets can't be checked: knowledge.md has no part 4a (doc sections) to compare → rebuild region widgets (generated from the docs: never edit its files by hand)",
    ]);
  });

  test('a region.json without sources.docUnits, or a unit without a copy, is a warning', () => {
    const dir = clone('repo');
    writeFileSync(join(dir, '.foundry/regions/locks/region.json'), JSON.stringify({ id: 'locks' }));
    edit(
      dir,
      '.foundry/regions/widgets/knowledge.md',
      '<!-- unit doc:README.md#errors -->',
      '<!-- unit doc:README.md#errors-renamed -->',
    );
    expect(statuses(dir)).toEqual({ locks: 'unverifiable', widgets: 'unverifiable' });
    expect(messages(dir, 'error')).toEqual([]);
    expect(messages(dir, 'warn')).toEqual([
      "region .foundry/regions/locks can't be checked: region.json names no sources.docUnits → rebuild region locks (generated from the docs: never edit its files by hand)",
      "region .foundry/regions/widgets can't be checked: doc:README.md#errors has no copy in knowledge.md → rebuild region widgets (generated from the docs: never edit its files by hand)",
    ]);
  });
});

describe('region freshness: layers', () => {
  test("another repo's layer is named once and not checked; the repo's own layer is", () => {
    const dir = join(fixtures, 'layered');
    const { layers, regions, findings } = checkRegionFreshness(dir);
    expect(layers).toEqual([
      { dir: '.foundry/base/regions', own: false, project: 'base', regions: 1 },
      { dir: '.foundry/regions', own: true, project: undefined, regions: 1 },
    ]);
    expect(regions.map((region) => [region.path, region.status])).toEqual([
      ['.foundry/regions/signets', 'fresh'],
    ]);
    expect(findings).toEqual([
      {
        level: 'warn',
        message:
          ".foundry/base/regions: 1 region built from base's docs, not checked here (that repo's check covers them)",
      },
    ]);
  });
});

describe('region freshness: baseline', () => {
  const baseline = (dir: string) => join(dir, REGION_FRESHNESS_DIR, 'baseline.txt');

  test('a stale region in the baseline warns; the baseline refuses to grow and must shrink', () => {
    const dir = clone('repo');
    edit(dir, 'README.md', "`size` is the widget's size.", '`size` is the width.');
    expect(writeRegionFreshnessBaseline(dir)).toEqual({ written: 1, refused: [] });
    expect(readFileSync(baseline(dir), 'utf8')).toContain('.foundry/regions/widgets\t1\n');
    expect(messages(dir, 'error')).toEqual([]);
    expect(messages(dir, 'warn')).toContain(
      `1 stale region in ${REGION_FRESHNESS_DIR}/baseline.txt (not blocking; rebuild it and shrink the baseline)`,
    );

    edit(dir, 'docs/guide.md', 'Take a lock', 'Hold a lock');
    expect(messages(dir, 'error')).toEqual([
      expect.stringContaining('region .foundry/regions/locks is stale'),
    ]);
    expect(writeRegionFreshnessBaseline(dir)).toEqual({
      written: 0,
      refused: ['.foundry/regions/locks 1× (baseline 0)'],
    });

    edit(dir, 'docs/guide.md', 'Hold a lock', 'Take a lock');
    edit(dir, 'README.md', '`size` is the width.', "`size` is the widget's size.");
    expect(messages(dir, 'error')).toEqual([
      `${REGION_FRESHNESS_DIR}/baseline.txt: .foundry/regions/widgets is no longer stale → delete its line`,
    ]);
    expect(writeRegionFreshnessBaseline(dir)).toEqual({ written: 0, refused: [] });
    expect(existsSync(baseline(dir))).toBe(false);
  });

  test('a baseline line without a count fails', () => {
    const dir = clone('repo');
    mkdirSync(join(dir, REGION_FRESHNESS_DIR), { recursive: true });
    writeFileSync(baseline(dir), '.foundry/regions/widgets\n');
    expect(messages(dir, 'error')).toEqual([
      expect.stringContaining('".foundry/regions/widgets" is not <region path>'),
    ]);
  });
});

describe('the builder’s cut', () => {
  test('slugs as the builder does', () => {
    expect(slug('Distributed Lock (`createLock`)')).toBe('distributed-lock-createlock');
    expect(slug('  --Já vu!--  ')).toBe('j-vu');
  });

  test('an H2 over 2500 tokens splits at H3; contents and a short preface drop', () => {
    const filler = 'word '.repeat(2100);
    const doc = `# Big doc\n\nShort.\n\n## Contents\n\n- a\n\n## Big part\n\nLead.\n\n### First\n\n${filler}\n\n### Second\n\n${filler}\n\n## Small\n\nText.`;
    expect(cutDocUnits(doc, 'docs/big.md').map((unit) => [unit.id, unit.heading])).toEqual([
      ['doc:docs/big.md#big-part', 'Big part'],
      ['doc:docs/big.md#big-part/first', 'Big part › First'],
      ['doc:docs/big.md#big-part/second', 'Big part › Second'],
      ['doc:docs/big.md#small', 'Small'],
    ]);
  });

  test('"Do not copy" sections, paragraphs and introduced lists are dropped; fences are kept', () => {
    const doc = [
      '## Keep',
      'Do not copy: the twins:',
      '',
      '- old/a.ts',
      '- old/b.ts',
      '',
      'After.',
      '## Old (do not copy)',
      'gone',
      '## Back',
      '```',
      'Do not copy inside a fence',
      '```',
    ].join('\n');
    expect(stripDoNotCopy(doc)).toBe(
      ['## Keep', '', 'After.', '## Back', '```', 'Do not copy inside a fence', '```'].join('\n'),
    );
  });
});

describe('regions command line', () => {
  test('takes a dir and --write-baseline, nothing else', () => {
    expect(parseCommandLine(['regions', '/repo', '--write-baseline'])).toMatchObject({
      command: 'regions',
      positionals: ['/repo'],
      writeBaseline: true,
    });
    expect(() => parseCommandLine(['regions', '--preset=base'])).toThrow(UsageError);
    expect(() => parseCommandLine(['check', '--write-baseline'])).toThrow(UsageError);
  });
});
