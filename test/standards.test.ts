import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseCommandLine, UsageError } from '../src/args';
import { inspect, loadManifest, packageRoot, STANDARDS_PREPARE } from '../src/lib';
import {
  fetchExpectedStandardsFiles,
  inspectStandards,
  PROFILE_SKILLS,
  resolvedSkillNames,
  resolveStandardsProfiles,
  SKILL_PREFIX,
  SKILLS_DIR,
  STANDARD_DOCS,
  STANDARDS_DIR,
  STANDARDS_PROFILES,
  syncStandards,
  UNIVERSAL_SKILLS,
} from '../src/standards';

const makeTempRepo = (pkg: Record<string, unknown>, initGit = true): string => {
  const dir = mkdtempSync(join(tmpdir(), 'inixiative-standards-'));
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  if (initGit) {
    Bun.spawnSync(['git', 'init'], { cwd: dir, stdout: 'ignore', stderr: 'ignore' });
  }
  return dir;
};

describe('standards & skills package inventory', () => {
  test('every declared standard doc and skill exists on disk with no orphan files', () => {
    const onDiskDocs = readdirSync(join(packageRoot, 'standards')).sort();
    expect(onDiskDocs).toEqual([...STANDARD_DOCS].sort());

    const declaredSkills = new Set<string>(UNIVERSAL_SKILLS);
    for (const profile of STANDARDS_PROFILES) {
      for (const skill of PROFILE_SKILLS[profile]) declaredSkills.add(skill);
    }
    const onDiskSkills = readdirSync(join(packageRoot, 'skills')).sort();
    expect(onDiskSkills).toEqual([...declaredSkills].sort());

    for (const skill of declaredSkills) {
      const skillMd = readFileSync(join(packageRoot, 'skills', skill, 'SKILL.md'), 'utf8');
      expect(skillMd).toMatch(/^---\nname:\s+\S+/);
      expect(skillMd).toMatch(/\ndescription:\s+\S+/);
    }
  });
});

describe('standards CLI argument parsing', () => {
  test('accepts dir and --check, and refuses foreign flags', () => {
    expect(parseCommandLine(['standards'])).toMatchObject({
      command: 'standards',
      positionals: [],
      checkOnly: false,
    });
    expect(parseCommandLine(['standards', 'some/dir', '--check'])).toMatchObject({
      command: 'standards',
      positionals: ['some/dir'],
      checkOnly: true,
    });
    expect(() => parseCommandLine(['standards', '--preset=base'])).toThrow(UsageError);
    expect(() => parseCommandLine(['standards', '--force'])).toThrow(UsageError);
  });
});

describe('resolveStandardsProfiles', () => {
  test('defaults to universal when unset and deduplicates valid profiles', () => {
    expect(resolveStandardsProfiles({})).toEqual({ profiles: [] });
    expect(
      resolveStandardsProfiles({ inixiative: { profiles: ['app', 'agentic', 'app'] } }),
    ).toEqual({ profiles: ['app', 'agentic'] });
  });

  test('refuses non-array or unknown profile values', () => {
    expect(resolveStandardsProfiles({ inixiative: { profiles: 'app' } }).error).toContain(
      'must be an array',
    );
    expect(
      resolveStandardsProfiles({ inixiative: { profiles: ['app', 'bogus'] } }).error,
    ).toContain('bogus');
  });
});

describe('syncStandards and unused cleanup', () => {
  test('materializes plain files (no symlinks), respects profiles, and removes unused skills/docs/nested dirs while preserving committed skills', () => {
    const dir = makeTempRepo({ name: 'demo', inixiative: { profiles: ['app', 'agentic'] } }, false);
    try {
      const localSkill = join(dir, SKILLS_DIR, 'integration-map', 'SKILL.md');
      mkdirSync(join(dir, SKILLS_DIR, 'integration-map'), { recursive: true });
      writeFileSync(localSkill, '---\nname: integration-map\ndescription: local\n---\n');

      mkdirSync(join(dir, STANDARDS_DIR, 'nested-stale'), { recursive: true });
      writeFileSync(join(dir, STANDARDS_DIR, 'OBSOLETE.md'), 'old');
      mkdirSync(join(dir, SKILLS_DIR, `${SKILL_PREFIX}old-removed-skill`), { recursive: true });
      writeFileSync(join(dir, SKILLS_DIR, `${SKILL_PREFIX}old-removed-skill`, 'SKILL.md'), 'old');
      mkdirSync(join(dir, SKILLS_DIR, `${SKILL_PREFIX}no-slop-writing`, 'references', 'stale'), {
        recursive: true,
      });
      symlinkSync(localSkill, join(dir, SKILLS_DIR, `${SKILL_PREFIX}symlinked`));

      const first = syncStandards(dir, packageRoot, ['app', 'agentic']);
      expect(first.written.length).toBe(
        fetchExpectedStandardsFiles(packageRoot, ['app', 'agentic']).size,
      );
      expect(first.removed).toContain(`${STANDARDS_DIR}/OBSOLETE.md`);
      expect(first.removed).toContain(`${STANDARDS_DIR}/nested-stale`);
      expect(first.removed).toContain(`${SKILLS_DIR}/${SKILL_PREFIX}old-removed-skill`);
      expect(first.removed).toContain(`${SKILLS_DIR}/${SKILL_PREFIX}symlinked`);
      expect(first.removed).toContain(
        `${SKILLS_DIR}/${SKILL_PREFIX}no-slop-writing/references/stale`,
      );

      expect(readFileSync(localSkill, 'utf8')).toContain('integration-map');

      for (const rel of fetchExpectedStandardsFiles(packageRoot, ['app', 'agentic']).keys()) {
        const stat = lstatSync(join(dir, rel));
        expect(stat.isSymbolicLink()).toBe(false);
        expect(stat.isFile()).toBe(true);
      }

      expect(syncStandards(dir, packageRoot, ['app', 'agentic'])).toEqual({
        written: [],
        removed: [],
      });

      // Dropping profiles cleans up profile-only skills automatically.
      const dropped = syncStandards(dir, packageRoot, []);
      expect(dropped.removed).toContain(`${SKILLS_DIR}/${SKILL_PREFIX}permissions-syntax-first`);
      expect(dropped.removed).toContain(`${SKILLS_DIR}/${SKILL_PREFIX}experiment`);
      expect(dropped.removed).toContain(`${SKILLS_DIR}/${SKILL_PREFIX}probe`);
      expect(existsSync(join(dir, SKILLS_DIR, `${SKILL_PREFIX}permissions-syntax-first`))).toBe(
        false,
      );
      expect(existsSync(join(dir, SKILLS_DIR, `${SKILL_PREFIX}experiment`))).toBe(false);
      expect(
        existsSync(join(dir, SKILLS_DIR, `${SKILL_PREFIX}review-subtractor`, 'SKILL.md')),
      ).toBe(true);
      expect(existsSync(localSkill)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('refuses symlinked shared ancestors without touching outside files, and self-heals dangling symlinks or regular files at managed roots', () => {
    const outside = mkdtempSync(join(tmpdir(), 'inixiative-outside-'));
    const dir = makeTempRepo({ name: 'demo' }, true);
    try {
      const outsideSecret = join(outside, 'keep.txt');
      writeFileSync(outsideSecret, 'untouched');

      // Symlinked ancestor `docs -> outside` must be refused, never traversed.
      symlinkSync(outside, join(dir, 'docs'));
      const ancestorFindings = inspectStandards(dir, { name: 'demo' }, packageRoot, {
        gitRepo: true,
      });
      expect(ancestorFindings.map((f) => f.message)).toContainEqual(
        expect.stringContaining('docs is a symlink'),
      );
      expect(() => syncStandards(dir, packageRoot, [])).toThrow('docs is a symlink');
      expect(readFileSync(outsideSecret, 'utf8')).toBe('untouched');
      rmSync(join(dir, 'docs'));

      // Symlinked ancestor `.claude/skills -> outside` must also be refused.
      mkdirSync(join(dir, '.claude'), { recursive: true });
      symlinkSync(outside, join(dir, SKILLS_DIR));
      expect(() => syncStandards(dir, packageRoot, [])).toThrow('.claude/skills is a symlink');
      expect(readFileSync(outsideSecret, 'utf8')).toBe('untouched');
      rmSync(join(dir, SKILLS_DIR));

      // Broken symlink at managed root `docs/standards` is detected and replaced cleanly.
      mkdirSync(join(dir, 'docs'), { recursive: true });
      symlinkSync('/nonexistent-target-inixiative', join(dir, STANDARDS_DIR));
      const brokenFindings = inspectStandards(dir, { name: 'demo' }, packageRoot);
      expect(brokenFindings).toHaveLength(1);
      syncStandards(dir, packageRoot, []);
      expect(lstatSync(join(dir, STANDARDS_DIR)).isDirectory()).toBe(true);
      expect(lstatSync(join(dir, STANDARDS_DIR)).isSymbolicLink()).toBe(false);

      // Regular file at `docs/standards` is detected and replaced cleanly (no ENOTDIR).
      rmSync(join(dir, STANDARDS_DIR), { recursive: true, force: true });
      writeFileSync(join(dir, STANDARDS_DIR), 'not a dir');
      expect(inspectStandards(dir, { name: 'demo' }, packageRoot)).toHaveLength(1);
      syncStandards(dir, packageRoot, []);
      expect(lstatSync(join(dir, STANDARDS_DIR)).isDirectory()).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('inspectStandards drift detection, prepare hook, and CLI end-to-end', () => {
  test('flags missing gitignore rules, missing/drifted/unused files without double-counting, and self-heals via fix()', () => {
    const dir = makeTempRepo({ name: 'demo' }, true);
    try {
      const pkg = { name: 'demo' };
      const initial = inspectStandards(dir, pkg, packageRoot, { gitRepo: true });
      const msgs = initial.map((f) => f.message);
      expect(msgs).toContainEqual(expect.stringContaining('docs/standards/ is not gitignored'));
      expect(msgs).toContainEqual(
        expect.stringContaining('.claude/skills/inixiative-*/ is not gitignored'),
      );
      expect(msgs).toContainEqual(expect.stringContaining('shared standards/skills out of sync'));

      for (const finding of initial) finding.fix?.();
      expect(inspectStandards(dir, pkg, packageRoot, { gitRepo: true })).toEqual([]);

      // Replace an expected file with a symlink (should count as drifted, NOT double-counted as unused).
      rmSync(join(dir, STANDARDS_DIR, 'GREAT_PROGRAMMER.md'));
      symlinkSync('/nonexistent', join(dir, STANDARDS_DIR, 'GREAT_PROGRAMMER.md'));
      mkdirSync(join(dir, SKILLS_DIR, `${SKILL_PREFIX}stale`), { recursive: true });
      writeFileSync(join(dir, SKILLS_DIR, `${SKILL_PREFIX}stale`, 'SKILL.md'), 'stale');

      const drifted = inspectStandards(dir, pkg, packageRoot, { gitRepo: true });
      expect(drifted).toHaveLength(1);
      expect(drifted[0].message).toContain('1 drifted');
      expect(drifted[0].message).toContain('1 unused');
      expect(drifted[0].message).not.toContain('GREAT_PROGRAMMER.md');

      drifted[0].fix?.();
      expect(inspectStandards(dir, pkg, packageRoot, { gitRepo: true })).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('@inixiative/config skips self-syncing standards', () => {
    const dir = makeTempRepo({ name: '@inixiative/config' }, true);
    try {
      expect(
        inspectStandards(dir, { name: '@inixiative/config' }, packageRoot, { gitRepo: true }),
      ).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('inspect() enforces and upgrades STANDARDS_PREPARE; STANDARDS_PREPARE works without node on PATH and skips non-git dirs', () => {
    const lefthookPrepare =
      'if git rev-parse --git-dir >/dev/null 2>&1; then root="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"; if [ -x "$root/node_modules/.bin/lefthook" ]; then (cd "$root" && ./node_modules/.bin/lefthook install); fi; fi';
    const legacyForms = [
      './node_modules/.bin/inixiative-config standards',
      'inixiative-config standards',
      'bun ./node_modules/.bin/inixiative-config standards',
      'bunx inixiative-config standards',
      'if [ -x node_modules/.bin/inixiative-config ]; then ./node_modules/.bin/inixiative-config standards; fi',
    ];
    const manifest = loadManifest();
    const temps: string[] = [];
    try {
      for (const legacy of legacyForms) {
        const repoDir = makeTempRepo(
          { name: 'demo', scripts: { prepare: `${lefthookPrepare} && ${legacy}` } },
          true,
        );
        temps.push(repoDir);
        const { findings, flush } = inspect(repoDir, manifest);
        const upgradePrepare = findings.find((f) =>
          f.message.includes('scripts.prepare does not sync shared standards/skills'),
        );
        expect(upgradePrepare).toBeDefined();
        upgradePrepare?.fix?.();
        flush();

        const updated = JSON.parse(readFileSync(join(repoDir, 'package.json'), 'utf8'));
        expect(updated.scripts.prepare).toBe(`${lefthookPrepare} && ${STANDARDS_PREPARE}`);
      }

      expect(resolvedSkillNames([])).toContain('worktrees');
      expect(resolvedSkillNames([])).toContain('review-subtractor');

      // Run STANDARDS_PREPARE with a Bun-only PATH (no node):
      // 1) In a non-git dir -> exits 0 and writes nothing.
      const noGit = makeTempRepo({ name: 'deploy-export' }, false);
      temps.push(noGit);
      const bunDir = dirname(process.execPath);
      const bunOnlyEnv = { PATH: `${bunDir}:/usr/bin:/bin` };
      const nonGitRun = Bun.spawnSync(['sh', '-c', STANDARDS_PREPARE], {
        cwd: noGit,
        env: bunOnlyEnv,
      });
      expect(nonGitRun.exitCode).toBe(0);
      expect(existsSync(join(noGit, STANDARDS_DIR))).toBe(false);

      // 2) In a git dir with built dist/cli.js installed at node_modules/.bin/inixiative-config -> runs via bun without node.
      const builtCli = join(packageRoot, 'dist', 'cli.js');
      if (existsSync(builtCli)) {
        const gitRepo = makeTempRepo({ name: 'bun-only-demo' }, true);
        temps.push(gitRepo);
        mkdirSync(join(gitRepo, 'node_modules', '.bin'), { recursive: true });
        symlinkSync(builtCli, join(gitRepo, 'node_modules', '.bin', 'inixiative-config'));
        const gitRun = Bun.spawnSync(['sh', '-c', STANDARDS_PREPARE], {
          cwd: gitRepo,
          env: bunOnlyEnv,
        });
        expect(gitRun.exitCode).toBe(0);
        expect(existsSync(join(gitRepo, STANDARDS_DIR, 'CODE_STYLE.md'))).toBe(true);
      }
    } finally {
      for (const temp of temps) rmSync(temp, { recursive: true, force: true });
    }
  });

  test('CLI standards and standards --check work end-to-end from source and built dist/cli.js', () => {
    const dir = makeTempRepo({ name: 'cli-demo', inixiative: { profiles: ['agentic'] } }, true);
    try {
      writeFileSync(join(dir, '.gitignore'), '/docs/standards/\n/.claude/skills/inixiative-*/\n');

      const checkBefore = Bun.spawnSync(
        [process.execPath, join(packageRoot, 'src', 'cli.ts'), 'standards', dir, '--check'],
        { stdout: 'pipe', stderr: 'pipe' },
      );
      expect(checkBefore.exitCode).toBe(1);

      const syncRun = Bun.spawnSync(
        [process.execPath, join(packageRoot, 'src', 'cli.ts'), 'standards', dir],
        { stdout: 'pipe', stderr: 'pipe' },
      );
      expect(syncRun.exitCode).toBe(0);
      expect(syncRun.stdout.toString()).toContain('standards synced');

      const checkAfter = Bun.spawnSync(
        [process.execPath, join(packageRoot, 'src', 'cli.ts'), 'standards', dir, '--check'],
        { stdout: 'pipe', stderr: 'pipe' },
      );
      expect(checkAfter.exitCode).toBe(0);
      expect(checkAfter.stdout.toString()).toContain('in sync');

      // Built dist/cli.js resolves packageRoot identically when built.
      const distCli = join(packageRoot, 'dist', 'cli.js');
      if (existsSync(distCli)) {
        const distCheck = Bun.spawnSync([process.execPath, distCli, 'standards', dir, '--check'], {
          stdout: 'pipe',
          stderr: 'pipe',
        });
        expect(distCheck.exitCode).toBe(0);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
