import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkUnresolvedMergeConflicts } from '../src/mergeConflicts';

// Built at run time, so this file commits no marker line for the rule to find.
const opening = `${'<'.repeat(7)} HEAD`;
const base = `${'|'.repeat(7)} merged common ancestors`;
const separator = '='.repeat(7);
const closing = `${'>'.repeat(7)} origin/main`;
const block = (ours: string, theirs: string) =>
  [opening, ours, separator, theirs, closing].join('\n');

const repoWith = (files: Record<string, string>, git = false): string => {
  const dir = mkdtempSync(join(tmpdir(), 'merge-conflicts-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  if (git) Bun.spawnSync(['git', 'init'], { cwd: dir, stdout: 'ignore', stderr: 'ignore' });
  return dir;
};

const messages = (dir: string) =>
  checkUnresolvedMergeConflicts(dir).map((finding) => `${finding.level} ${finding.message}`);

const conflictAt = (location: string) =>
  `error unresolved merge conflict in ${location} → resolve it: keep the lines you want and delete the marker lines`;

describe('unresolved merge conflicts', () => {
  test('a clean repo passes', () => {
    expect(
      messages(repoWith({ 'README.md': '# Title\n\nText.\n', 'src/index.ts': 'export {};\n' })),
    ).toEqual([]);
  });

  test('a doc with one conflict block fails at its opening line', () => {
    const dir = repoWith({ 'docs/GUIDE.md': `# Guide\n\n${block('Ours.', 'Theirs.')}\n` });
    expect(messages(dir)).toEqual([conflictAt('docs/GUIDE.md:3')]);
  });

  test('two blocks in one file are two findings', () => {
    const dir = repoWith({
      'docs/GUIDE.md': `${block('a', 'b')}\n\nBetween.\n\n${block('c', 'd')}\n`,
    });
    expect(messages(dir)).toEqual([conflictAt('docs/GUIDE.md:1'), conflictAt('docs/GUIDE.md:9')]);
  });

  test('a setext heading underline of seven = alone passes', () => {
    const dir = repoWith({ 'docs/GUIDE.md': `Heading\n${separator}\n\nText.\n` });
    expect(messages(dir)).toEqual([]);
  });

  test('a diff3 block, with its base section, is one finding', () => {
    const dir = repoWith({
      'versions.json': [
        '{',
        opening,
        '  "a": 1,',
        base,
        '  "a": 0,',
        separator,
        '  "a": 2,',
        closing,
        '}',
      ].join('\n'),
    });
    expect(messages(dir)).toEqual([conflictAt('versions.json:2')]);
  });

  test('a block inside a fenced code block still fails', () => {
    const dir = repoWith({ 'README.md': `# Title\n\n\`\`\`ts\n${block('a', 'b')}\n\`\`\`\n` });
    expect(messages(dir)).toEqual([conflictAt('README.md:4')]);
  });

  test('a marker left without its pair fails', () => {
    const dir = repoWith({
      'schema.prisma': `model A {\n${opening}\n}\n`,
      'b.yml': `${closing}\n`,
    });
    expect(messages(dir)).toEqual([
      `error unresolved merge conflict in b.yml:1 (its markers are incomplete) → resolve it: keep the lines you want and delete the marker lines`,
      `error unresolved merge conflict in schema.prisma:2 (its markers are incomplete) → resolve it: keep the lines you want and delete the marker lines`,
    ]);
  });

  test('eight marker characters, or seven followed by text, are not markers', () => {
    const dir = repoWith({
      'docs/GUIDE.md': `${'<'.repeat(8)} x\n${'<'.repeat(7)}x\n${'>'.repeat(8)}\n`,
    });
    expect(messages(dir)).toEqual([]);
  });

  test('fixtures and changelogs are read, unlike for retired terms', () => {
    const dir = repoWith({
      'CHANGELOG.md': `${block('0.2.0', '0.1.1')}\n`,
      'test/fixtures/a.md': `${block('a', 'b')}\n`,
    });
    expect(messages(dir)).toEqual([
      conflictAt('CHANGELOG.md:1'),
      conflictAt('test/fixtures/a.md:1'),
    ]);
  });

  test('dependencies, build output, git-ignored and binary files are skipped', () => {
    const conflict = `${block('a', 'b')}\n`;
    const dir = repoWith(
      {
        '.gitignore': 'ignored/\n',
        'ignored/a.md': conflict,
        'node_modules/pkg/README.md': conflict,
        'dist/index.js': conflict,
        'image.bin': `\0${conflict}`,
      },
      true,
    );
    expect(messages(dir)).toEqual([]);
    expect(
      messages(repoWith({ 'node_modules/pkg/README.md': conflict, 'dist/a.js': conflict })),
    ).toEqual([]);
  });
});
