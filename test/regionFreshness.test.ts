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
  describeRegion,
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

const SUMMARY = 'not seen by this check';

/** Findings at one level; the summary line is tested on its own. */
const messages = (dir: string, level: 'error' | 'warn') =>
  checkRegionFreshness(dir)
    .findings.filter((finding) => finding.level === level && !finding.message.includes(SUMMARY))
    .map((finding) => finding.message);

const statuses = (dir: string) =>
  Object.fromEntries(checkRegionFreshness(dir).regions.map((region) => [region.id, region.status]));

const REBUILD = (id: string) =>
  `rebuild region ${id} (generated from the docs: never edit its files by hand)`;

describe('region freshness: fresh, partly checked, not checked', () => {
  test('a region whose copies all match is fresh; one with a unit from another repo is only partly checked', () => {
    const dir = join(fixtures, 'repo');
    const { regions, findings } = checkRegionFreshness(dir);
    expect(statuses(dir)).toEqual({ locks: 'partly checked', widgets: 'fresh' });
    expect(findings.filter((finding) => finding.level === 'error')).toEqual([]);
    expect(messages(dir, 'warn')).toEqual([
      "1 doc unit in .foundry/regions copy other repos' docs (lib), not checked here",
    ]);
    expect(regions.map(describeRegion)).toEqual([
      "region .foundry/regions/locks is partly checked (1 of 2 doc units checked; the rest copy another repo's docs)",
      'region .foundry/regions/widgets is fresh (3 of 3 doc units checked)',
    ]);
  });

  test('the summary counts every state and says what the check never reads', () => {
    const summary = checkRegionFreshness(join(fixtures, 'repo')).findings.at(-1)?.message;
    expect(summary).toBe(
      '2 regions in .foundry/regions: 1 fresh, 1 partly checked; not seen by this check: code entries (part 4b), the model-written parts 1–3, recognise.md, GLOSSARY.md, and doc sections no region copies',
    );
  });

  test('a region that copies no doc sections is not checked, not fresh', () => {
    const dir = clone('repo');
    const meta = join(dir, '.foundry/regions/locks/region.json');
    writeFileSync(meta, JSON.stringify({ id: 'locks', sources: { docUnits: [] } }));
    expect(statuses(dir).locks).toBe('not checked');
  });

  test('a change only to "Do not copy" material leaves the region fresh', () => {
    const dir = clone('repo');
    edit(dir, 'docs/guide.md', '- src/old/lock.ts', '- src/old/other-lock.ts');
    edit(dir, 'docs/guide.md', 'The old way.', 'The older way.');
    expect(statuses(dir)).toEqual({ locks: 'partly checked', widgets: 'fresh' });
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

describe('region freshness: stale is a warning', () => {
  test('a changed doc section makes its region stale: a warning saying to rebuild it, never to edit it', () => {
    const dir = clone('repo');
    edit(dir, 'README.md', "`size` is the widget's size.", "`size` is the widget's width.");
    expect(statuses(dir).widgets).toBe('stale');
    expect(messages(dir, 'error')).toEqual([]);
    expect(messages(dir, 'warn')).toContain(
      `region .foundry/regions/widgets is stale: doc:README.md#usage changed (+1 −1 lines; now: "\`size\` is the widget's width.") → ${REBUILD('widgets')} when you can; not blocking`,
    );
  });

  test('the H1 is part of the copy: a renamed doc is a stale region', () => {
    const dir = clone('repo');
    edit(dir, 'README.md', '# Widgets', '# Gadgets');
    expect(statuses(dir).widgets).toBe('stale');
  });
});

describe('region freshness: gone fails', () => {
  test('a renamed heading leaves the unit with no section today: an error', () => {
    const dir = clone('repo');
    edit(dir, 'README.md', '## Errors', '## Failures');
    expect(statuses(dir).widgets).toBe('gone');
    expect(messages(dir, 'error')).toEqual([
      `region .foundry/regions/widgets copies sections that are gone: doc:README.md#errors gone (no such section today) → ${REBUILD('widgets')}`,
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
});

describe('region freshness: unverifiable', () => {
  test('a region without part 4 is a warning: nothing to compare', () => {
    const dir = join(fixtures, 'no-part-4');
    expect(statuses(dir)).toEqual({ widgets: 'unverifiable' });
    expect(messages(dir, 'error')).toEqual([]);
    expect(messages(dir, 'warn')).toEqual([
      `region .foundry/regions/widgets can't be checked: knowledge.md has no part 4a (doc sections) to compare → ${REBUILD('widgets')}`,
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
      `region .foundry/regions/locks can't be checked: region.json names no sources.docUnits → ${REBUILD('locks')}`,
      `region .foundry/regions/widgets can't be checked: doc:README.md#errors has no copy in knowledge.md → ${REBUILD('widgets')}`,
    ]);
  });
});

describe('region freshness: layers', () => {
  test("another repo's layer is named once and not checked; the layers are Foundry's", () => {
    const dir = join(fixtures, 'layered');
    const { layers, regions, findings } = checkRegionFreshness(dir);
    expect(layers).toEqual([
      { dir: '.foundry/base/regions', own: false, project: 'base', regions: 1 },
      { dir: '.foundry/regions', own: true, project: undefined, regions: 1 },
    ]);
    expect(regions.map((region) => [region.path, region.status])).toEqual([
      ['.foundry/regions/signets', 'fresh'],
    ]);
    expect(findings[0]).toEqual({
      level: 'warn',
      message: ".foundry/base/regions: 1 region built from base's docs, not checked here",
    });
  });

  test('chorus.layers that leave out .foundry/regions leave it out of the chorus, as Foundry does', () => {
    const dir = clone('layered');
    writeFileSync(
      join(dir, '.foundry/project.json'),
      JSON.stringify({ chorus: { layers: [{ regions: '.foundry/base/regions' }] } }),
    );
    const { layers, regions } = checkRegionFreshness(dir);
    expect(layers.map((layer) => layer.dir)).toEqual(['.foundry/base/regions']);
    expect(regions).toEqual([]);
  });
});

describe('region freshness: baseline (gone units only)', () => {
  const baseline = (dir: string) => join(dir, REGION_FRESHNESS_DIR, 'baseline.txt');

  test('a region with a gone section in the baseline warns; the baseline refuses to grow and must shrink', () => {
    const dir = clone('repo');
    edit(dir, 'README.md', '## Errors', '## Failures');
    expect(writeRegionFreshnessBaseline(dir)).toEqual({ written: 1, refused: [] });
    expect(readFileSync(baseline(dir), 'utf8')).toContain('.foundry/regions/widgets\t1\n');
    expect(messages(dir, 'error')).toEqual([]);
    expect(messages(dir, 'warn')).toContain(
      `1 region with gone sections in ${REGION_FRESHNESS_DIR}/baseline.txt (not blocking; rebuild it and shrink the baseline)`,
    );

    // A stale (changed) copy never needs the baseline.
    edit(dir, 'docs/guide.md', 'Take a lock', 'Hold a lock');
    expect(messages(dir, 'error')).toEqual([]);
    expect(writeRegionFreshnessBaseline(dir)).toEqual({ written: 1, refused: [] });

    rmSync(join(dir, 'docs/guide.md'));
    expect(messages(dir, 'error')).toEqual([
      expect.stringContaining('region .foundry/regions/locks copies sections that are gone'),
    ]);
    expect(writeRegionFreshnessBaseline(dir)).toEqual({
      written: 0,
      refused: ['.foundry/regions/locks 1× (baseline 0)'],
    });

    writeFileSync(join(dir, 'docs/guide.md'), readFileSync(join(fixtures, 'repo/docs/guide.md')));
    edit(dir, 'README.md', '## Failures', '## Errors');
    expect(messages(dir, 'error')).toEqual([
      `${REGION_FRESHNESS_DIR}/baseline.txt: .foundry/regions/widgets copies no gone section now → delete its line`,
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
