import { describe, expect, test } from 'bun:test';
import {
  chmodSync,
  cpSync,
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
import { checkRegionFreshness, describeRegion } from '../src/regionFreshness';

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

const SUMMARY = 'compared with the docs: part 4a only';

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

  test('the summary counts every state and says what is compared, what is only scanned, and what is not seen', () => {
    const summary = checkRegionFreshness(join(fixtures, 'repo')).findings.at(-1)?.message;
    expect(summary).toBe(
      "2 regions in .foundry/regions: 1 fresh, 1 partly checked; compared with the docs: part 4a only; the rest of each region (parts 1–3, part 4b's code entries, recognise.md, region.json) and the set's GLOSSARY.md and registry.json are only scanned for retired names; doc sections no region copies are not seen",
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

describe('region freshness: gone is a warning too', () => {
  test('a renamed heading leaves the unit with no section today: rebuild it, but nothing fails', () => {
    const dir = clone('repo');
    edit(dir, 'README.md', '## Errors', '## Failures');
    expect(statuses(dir).widgets).toBe('gone');
    expect(messages(dir, 'error')).toEqual([]);
    expect(messages(dir, 'warn')).toContain(
      `region .foundry/regions/widgets copies sections that are gone: doc:README.md#errors gone (no such section today) → ${REBUILD('widgets')}`,
    );
  });

  test('a missing doc file leaves the unit with no file; the other repo’s unit is still not checked', () => {
    const dir = clone('repo');
    rmSync(join(dir, 'docs/guide.md'));
    const { regions } = checkRegionFreshness(dir);
    expect(regions.find((region) => region.id === 'locks')?.units).toEqual([
      { unit: 'doc:docs/guide.md#locks', state: 'gone', missing: 'file' },
      { unit: 'doc:lib/README.md#install', state: 'elsewhere', library: 'lib' },
    ]);
    expect(messages(dir, 'error')).toEqual([]);
    expect(messages(dir, 'warn')).toContainEqual(
      expect.stringContaining('doc:docs/guide.md#locks gone (no such file) → rebuild region locks'),
    );
  });
});

describe('region freshness: a retired name in a region is a warning', () => {
  const stale = join(
    import.meta.dir,
    'fixtures',
    'retired-terms',
    'fail',
    'names-in-and-beside-regions',
  );

  test('one line per region that says rebuild, never which line to edit; counted in the summary', () => {
    const { findings } = checkRegionFreshness(stale);
    expect(findings.filter((finding) => finding.level === 'error')).toEqual([]);
    const named = findings
      .map((finding) => finding.message)
      .filter((m) => m.includes('names something retired'));
    expect(named).toEqual([
      expect.stringMatching(
        /^region \.foundry\/base\/regions\/locks names something retired: "`threads` resource" \(knowledge\.md ×1\) → rebuild region locks in the repo whose docs \.foundry\/base\/regions was built from, then copy it here/,
      ),
      expect.stringMatching(
        /^\.foundry\/regions \(the set's own files\) names something retired: "floor\.mayTake" \(GLOSSARY\.md ×1\) → rebuild the regions in \.foundry\/regions/,
      ),
      expect.stringMatching(
        /^region \.foundry\/regions\/conv names something retired: "threadsTerms", "narrowsThreadsTerms" \(knowledge\.md ×3, region\.json ×1\) → rebuild region conv \(generated from the docs: never edit it by hand/,
      ),
    ]);
    for (const message of named) expect(message).not.toMatch(/\.md:\d|\.json:\d/);
    expect(findings.at(-1)?.message).toContain('1 unverifiable, 1 naming something retired;');
  });

  test("a region's copy of an allowed doc line is allowed with it, stale or not", () => {
    const dir = clone('../retired-terms/pass/allowed-copy');
    const doc = join(dir, 'docs/history/0.12.md');
    writeFileSync(doc, readFileSync(doc, 'utf8').replace('The 0.12 grant', 'The old grant'));
    const { findings } = checkRegionFreshness(dir);
    expect(findings.filter((finding) => finding.level === 'error')).toEqual([]);
    expect(findings.map((finding) => finding.message).join('\n')).not.toContain(
      'names something retired',
    );
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

describe('region freshness: nothing about regions throws or fails', () => {
  // why: root reads anything, so a permission test means nothing there.
  const asRoot = process.getuid?.() === 0;
  const locked = (path: string, run: () => void) => {
    chmodSync(path, 0o000);
    try {
      run();
    } finally {
      chmodSync(path, 0o755);
    }
  };
  const warnings = (dir: string) => {
    const { findings } = checkRegionFreshness(dir);
    expect(findings.filter((finding) => finding.level === 'error')).toEqual([]);
    return findings.map((finding) => finding.message);
  };

  test('.foundry/regions that is a file is one warning, and the CLI exits 0 without a trace', () => {
    const dir = clone('no-regions');
    mkdirSync(join(dir, '.foundry'));
    writeFileSync(join(dir, '.foundry/regions'), 'not a directory\n');
    expect(warnings(dir)).toEqual([
      'regions: .foundry/regions is not a directory: no regions read there',
    ]);
    const run = Bun.spawnSync([
      process.execPath,
      join(import.meta.dir, '..', 'src', 'cli.ts'),
      'regions',
      dir,
    ]);
    expect(run.exitCode).toBe(0);
    expect(run.stderr.toString()).toBe('');
  });

  test('chorus.layers naming a path that does not exist is one warning', () => {
    const dir = clone('layered');
    writeFileSync(
      join(dir, '.foundry/project.json'),
      JSON.stringify({
        chorus: { layers: [{ regions: '.foundry/gone/regions' }, { regions: '.foundry/regions' }] },
      }),
    );
    expect(warnings(dir)).toContain(
      'regions: .foundry/project.json names .foundry/gone/regions as a layer, but it does not exist',
    );
  });

  test('an unreadable allow list is a warning in regions', () => {
    const dir = clone('repo');
    mkdirSync(join(dir, 'scripts/ci/retired-terms/allow.txt'), { recursive: true });
    expect(warnings(dir)).toContain(
      "regions: can't read scripts/ci/retired-terms/allow.txt (EISDIR): no allow entry applies",
    );
  });

  test('regions prints exactly one summary line, the one the check built', () => {
    const stale = join(
      import.meta.dir,
      'fixtures',
      'retired-terms',
      'fail',
      'names-in-and-beside-regions',
    );
    const run = Bun.spawnSync([
      process.execPath,
      join(import.meta.dir, '..', 'src', 'cli.ts'),
      'regions',
      stale,
    ]);
    const out = run.stdout.toString().split('\n');
    const summaries = out.filter((line) => line.includes(SUMMARY));
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toContain('naming something retired');
    const fresh = Bun.spawnSync([
      process.execPath,
      join(import.meta.dir, '..', 'src', 'cli.ts'),
      'regions',
      join(fixtures, 'old-cut'),
    ]);
    expect(
      fresh.stdout
        .toString()
        .split('\n')
        .filter((line) => line.includes(SUMMARY)),
    ).toEqual([expect.stringMatching(/^· 1 region in \.foundry\/regions: 1 fresh; /)]);
  });

  test('chorus.layers naming a file is one warning naming it', () => {
    const dir = clone('layered');
    writeFileSync(
      join(dir, '.foundry/project.json'),
      JSON.stringify({
        chorus: { layers: [{ regions: 'docs/own.md' }, { regions: '.foundry/regions' }] },
      }),
    );
    expect(warnings(dir)).toContain(
      'regions: docs/own.md is not a directory: no regions read there',
    );
  });

  test.skipIf(asRoot)(
    'an unreadable regions directory, region, knowledge.md, doc or project.json says what happened',
    () => {
      const dir = clone('repo');
      locked(join(dir, '.foundry/regions'), () =>
        expect(warnings(dir)).toContain(
          "regions: can't read .foundry/regions (EACCES): no regions read there",
        ),
      );
      locked(join(dir, '.foundry/regions/widgets'), () =>
        expect(warnings(dir)).toContain(
          "regions: can't read .foundry/regions/widgets (EACCES): not read as a region",
        ),
      );
      locked(join(dir, '.foundry/regions/widgets/knowledge.md'), () =>
        expect(warnings(dir)).toContain(
          `region .foundry/regions/widgets can't be checked: can't read knowledge.md (EACCES) → ${REBUILD('widgets')}`,
        ),
      );
      locked(join(dir, 'README.md'), () =>
        expect(warnings(dir)).toContainEqual(
          expect.stringContaining("doc:README.md#usage: can't read its doc (EACCES)"),
        ),
      );
      mkdirSync(join(dir, '.foundry'), { recursive: true });
      writeFileSync(join(dir, '.foundry/project.json'), '{}');
      locked(join(dir, '.foundry/project.json'), () =>
        expect(warnings(dir)).toContain(
          "regions: can't read .foundry/project.json (EACCES): read .foundry/regions only",
        ),
      );
    },
  );
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
  test('takes a dir, nothing else: there is nothing to baseline', () => {
    expect(parseCommandLine(['regions', '/repo'])).toMatchObject({
      command: 'regions',
      positionals: ['/repo'],
    });
    expect(() => parseCommandLine(['regions', '--preset=base'])).toThrow(UsageError);
    expect(() => parseCommandLine(['regions', '--write-baseline'])).toThrow(UsageError);
    expect(() => parseCommandLine(['check', '--write-baseline'])).toThrow(UsageError);
  });
});
