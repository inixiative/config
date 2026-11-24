import { spawnSync } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  type Stats,
  writeFileSync,
} from 'node:fs';
import { dirname, join, sep } from 'node:path';
import type { Finding } from './lib';

export const STANDARDS_PROFILES = ['app', 'agentic'] as const;
export type StandardsProfile = (typeof STANDARDS_PROFILES)[number];

export const STANDARDS_DIR = 'docs/standards';
export const SKILLS_DIR = '.claude/skills';
export const SKILL_PREFIX = 'inixiative-';

export const STANDARDS_GITIGNORE_RULES = [
  {
    rule: '/docs/standards/',
    probe: 'docs/standards/GREAT_PROGRAMMER.md',
    label: 'docs/standards/',
  },
  {
    rule: '/.claude/skills/inixiative-*/',
    probe: '.claude/skills/inixiative-cleanup-scan/SKILL.md',
    label: '.claude/skills/inixiative-*/',
  },
] as const;

export const STANDARDS_PREPARE =
  'if git rev-parse --git-dir >/dev/null 2>&1 && [ -x node_modules/.bin/inixiative-config ]; then bun ./node_modules/.bin/inixiative-config standards; fi';

export const STANDARD_DOCS = [
  'CODE_STYLE.md',
  'ENGINEERING_DOCTRINE.md',
  'GREAT_PROGRAMMER.md',
  'NAMING_VOCABULARY.md',
] as const;

export const UNIVERSAL_SKILLS = [
  'cleanup-scan',
  'code-walkthrough',
  'labeling',
  'no-slop-writing',
  'reflecting-without-flinching',
  'review-adversarial',
  'review-dedupe',
  'review-naming',
  'review-plan',
  'review-subtractor',
  'worktrees',
] as const;

export const PROFILE_SKILLS: Readonly<Record<StandardsProfile, readonly string[]>> = {
  app: ['permissions-syntax-first'],
  agentic: ['experiment', 'probe'],
};

const SHARED_ANCESTORS = ['docs', '.claude', SKILLS_DIR] as const;

type PackageWithConfig = {
  name?: string;
  inixiative?: { profiles?: unknown };
};

const lstatOrNull = (path: string): Stats | null => {
  try {
    return lstatSync(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
};

export const appendGitignoreLine = (dir: string, line: string): void => {
  const gitignorePath = join(dir, '.gitignore');
  const current = lstatOrNull(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
  const separator = current === '' || current.endsWith('\n') ? '' : '\n';
  writeFileSync(gitignorePath, `${current}${separator}${line}\n`);
};

export const isStandardsProfile = (value: unknown): value is StandardsProfile =>
  typeof value === 'string' && (STANDARDS_PROFILES as readonly string[]).includes(value);

export const resolveStandardsProfiles = (
  pkg: PackageWithConfig,
): { profiles: StandardsProfile[]; error?: string } => {
  const raw = pkg.inixiative?.profiles;
  if (raw === undefined) return { profiles: [] };
  if (!Array.isArray(raw)) {
    return {
      profiles: [],
      error: `package.json inixiative.profiles must be an array of ${STANDARDS_PROFILES.join(' | ')}`,
    };
  }
  const invalid = raw.filter((item) => !isStandardsProfile(item));
  if (invalid.length > 0) {
    return {
      profiles: [],
      error: `package.json inixiative.profiles contains unknown profile(s): ${invalid.map(String).join(', ')} (valid: ${STANDARDS_PROFILES.join(', ')})`,
    };
  }
  return { profiles: [...new Set(raw)] };
};

export const resolvedSkillNames = (profiles: readonly StandardsProfile[]): string[] => {
  const names = new Set<string>(UNIVERSAL_SKILLS);
  for (const profile of profiles) {
    for (const skill of PROFILE_SKILLS[profile]) names.add(skill);
  }
  return [...names].sort();
};

const walkFiles = (rootDir: string, prefix = ''): string[] => {
  const results: string[] = [];
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(abs, rel));
      continue;
    }
    if (entry.isFile()) results.push(rel);
  }
  return results.sort();
};

/** Repo-relative destination paths mapped to absolute source paths inside `@inixiative/config`. */
export const fetchExpectedStandardsFiles = (
  configRoot: string,
  profiles: readonly StandardsProfile[],
): Map<string, string> => {
  const files = new Map<string, string>();
  for (const doc of STANDARD_DOCS) {
    files.set(`${STANDARDS_DIR}/${doc}`, join(configRoot, 'standards', doc));
  }
  for (const skill of resolvedSkillNames(profiles)) {
    const skillRoot = join(configRoot, 'skills', skill);
    for (const rel of walkFiles(skillRoot)) {
      files.set(`${SKILLS_DIR}/${SKILL_PREFIX}${skill}/${rel}`, join(skillRoot, rel));
    }
  }
  return files;
};

/** Refuse symlinks, non-directories, or paths escaping `dir` on shared parent dirs (`docs`, `.claude`, `.claude/skills`). */
const ancestorProblems = (dir: string): string[] => {
  const problems: string[] = [];
  const rootReal = realpathSync(dir);
  for (const rel of SHARED_ANCESTORS) {
    const abs = join(dir, rel);
    const stat = lstatOrNull(abs);
    if (!stat) continue;
    if (stat.isSymbolicLink()) {
      problems.push(`${rel} is a symlink — refusing to traverse outside the repository`);
      continue;
    }
    if (!stat.isDirectory()) {
      problems.push(`${rel} is not a directory`);
      continue;
    }
    const resolved = realpathSync(abs);
    if (resolved !== rootReal && !resolved.startsWith(`${rootReal}${sep}`)) {
      problems.push(`${rel} resolves outside the repository`);
    }
  }
  return problems;
};

const expectedDirectoriesOf = (expected: ReadonlyMap<string, string>): Set<string> => {
  const dirs = new Set<string>();
  for (const rel of expected.keys()) {
    let cur = dirname(rel);
    while (cur !== '.' && cur !== '') {
      dirs.add(cur);
      cur = dirname(cur);
    }
  }
  return dirs;
};

const staleStandardsPaths = (
  dir: string,
  expected: ReadonlyMap<string, string>,
  activeSkillDirs: ReadonlySet<string>,
): string[] => {
  const expectedDirs = expectedDirectoriesOf(expected);
  const stale: string[] = [];

  const scanManagedRoot = (relRoot: string): void => {
    const absRoot = join(dir, relRoot);
    const stat = lstatOrNull(absRoot);
    if (!stat) return;
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      stale.push(relRoot);
      return;
    }
    for (const entry of readdirSync(absRoot)) {
      const rel = `${relRoot}/${entry}`;
      const childStat = lstatOrNull(join(dir, rel));
      if (!childStat) continue;
      if (childStat.isSymbolicLink()) {
        stale.push(rel);
        continue;
      }
      if (childStat.isDirectory()) {
        if (!expectedDirs.has(rel)) {
          stale.push(rel);
          continue;
        }
        scanManagedRoot(rel);
        continue;
      }
      if (!expected.has(rel)) stale.push(rel);
    }
  };

  scanManagedRoot(STANDARDS_DIR);

  const skillsAbs = join(dir, SKILLS_DIR);
  const skillsStat = lstatOrNull(skillsAbs);
  if (skillsStat && !skillsStat.isSymbolicLink() && skillsStat.isDirectory()) {
    for (const entry of readdirSync(skillsAbs)) {
      if (!entry.startsWith(SKILL_PREFIX)) continue;
      const rel = `${SKILLS_DIR}/${entry}`;
      const stat = lstatOrNull(join(dir, rel));
      if (!stat) continue;
      if (stat.isSymbolicLink() || !stat.isDirectory() || !activeSkillDirs.has(entry)) {
        stale.push(rel);
        continue;
      }
      scanManagedRoot(rel);
    }
  }

  return stale.sort();
};

export type StandardsSyncResult = {
  written: string[];
  removed: string[];
};

/**
 * Materialize shared standards into `docs/standards/` and shared skills into
 * `.claude/skills/inixiative-<name>/` as plain files (never symlinks), removing
 * any stale files or unused `inixiative-*` skill folders while leaving committed
 * repo-local skills untouched.
 */
export const syncStandards = (
  dir: string,
  configRoot: string,
  profiles: readonly StandardsProfile[],
): StandardsSyncResult => {
  const problems = ancestorProblems(dir);
  if (problems.length > 0) throw new Error(problems.join('; '));

  const expected = fetchExpectedStandardsFiles(configRoot, profiles);
  const activeSkillDirs = new Set(resolvedSkillNames(profiles).map((s) => `${SKILL_PREFIX}${s}`));
  const removed = staleStandardsPaths(dir, expected, activeSkillDirs);
  for (const rel of removed) {
    rmSync(join(dir, rel), { recursive: true, force: true });
  }

  const written: string[] = [];
  for (const [rel, srcAbs] of expected) {
    const destAbs = join(dir, rel);
    const srcBytes = readFileSync(srcAbs);
    const stat = lstatOrNull(destAbs);
    if (stat) {
      if (stat.isFile() && !stat.isSymbolicLink() && readFileSync(destAbs).equals(srcBytes)) {
        continue;
      }
      rmSync(destAbs, { recursive: true, force: true });
    }
    mkdirSync(dirname(destAbs), { recursive: true });
    writeFileSync(destAbs, srcBytes);
    written.push(rel);
  }

  return { written, removed };
};

export const inspectStandards = (
  dir: string,
  pkg: PackageWithConfig,
  configRoot: string,
  options: { gitRepo?: boolean } = {},
): Finding[] => {
  if (pkg.name === '@inixiative/config') return [];
  const findings: Finding[] = [];

  const { profiles, error } = resolveStandardsProfiles(pkg);
  if (error) {
    findings.push({ level: 'error', message: error });
    return findings;
  }

  const problems = ancestorProblems(dir);
  if (problems.length > 0) {
    for (const message of problems) findings.push({ level: 'error', message });
    return findings;
  }

  if (options.gitRepo) {
    for (const { rule, probe, label } of STANDARDS_GITIGNORE_RULES) {
      const ignored = spawnSync('git', ['check-ignore', '-q', probe], { cwd: dir }).status === 0;
      if (ignored) continue;
      findings.push({
        level: 'error',
        message: `${label} is not gitignored → adding ${rule} to .gitignore`,
        fix: () => appendGitignoreLine(dir, rule),
      });
    }
  }

  const expected = fetchExpectedStandardsFiles(configRoot, profiles);
  const activeSkillDirs = new Set(resolvedSkillNames(profiles).map((s) => `${SKILL_PREFIX}${s}`));
  const missing: string[] = [];
  const drifted = new Set<string>();

  for (const [rel, srcAbs] of expected) {
    const destAbs = join(dir, rel);
    const stat = lstatOrNull(destAbs);
    if (!stat) {
      missing.push(rel);
      continue;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      drifted.add(rel);
      continue;
    }
    if (!readFileSync(destAbs).equals(readFileSync(srcAbs))) {
      drifted.add(rel);
    }
  }

  const stale = staleStandardsPaths(dir, expected, activeSkillDirs).filter(
    (rel) => !drifted.has(rel),
  );
  if (missing.length > 0 || drifted.size > 0 || stale.length > 0) {
    const summary = [
      missing.length > 0 ? `${missing.length} missing` : null,
      drifted.size > 0 ? `${drifted.size} drifted` : null,
      stale.length > 0 ? `${stale.length} unused (${stale.slice(0, 3).join(', ')})` : null,
    ]
      .filter(Boolean)
      .join(', ');
    findings.push({
      level: 'error',
      message: `shared standards/skills out of sync (${summary}) → run inixiative-config standards`,
      fix: () => {
        syncStandards(dir, configRoot, profiles);
      },
    });
  }

  return findings;
};
