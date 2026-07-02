import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export type Manifest = {
  bun: string;
  toolchain: Record<string, string>;
  required: string[];
  ecosystem: Record<string, string>;
};

export type Preset = 'base' | 'node' | 'react';

export type Finding = {
  level: 'error' | 'warn';
  message: string;
  kind?: 'stale-lock' | 'ecosystem-range';
  name?: string;
  fix?: () => void;
};

export type Inspection = {
  findings: Finding[];
  flush: () => boolean;
};

type DepField = 'dependencies' | 'devDependencies' | 'peerDependencies';

type PackageJson = {
  name?: string;
  version?: string;
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  [key: string]: unknown;
};

const REQUIRED_SCRIPTS: Record<string, string> = {
  typecheck: 'tsc --noEmit',
  lint: 'biome check .',
  test: 'bun test',
  check: 'bun run typecheck && bun run lint && bun run test',
};

const DEP_FIELDS: DepField[] = ['dependencies', 'devDependencies', 'peerDependencies'];

export const loadManifest = (): Manifest =>
  JSON.parse(readFileSync(join(packageRoot, 'versions.json'), 'utf8'));

export const ownVersion = (): string =>
  JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version;

const stripJsonc = (text: string): string => {
  let out = '';
  let inString = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
};

export const parseJsonc = (text: string): Record<string, unknown> => JSON.parse(stripJsonc(text));

const tryParseJsonc = (text: string): Record<string, unknown> | null => {
  try {
    const parsed = parseJsonc(text);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
};

const parseRange = (range: string): { op: '^' | '~' | '>=' | '='; version: string } | null => {
  const match = range.match(/^(\^|~|>=)?\s*(\d+)\.(\d+)\.(\d+)(?:-[\w.]+)?$/);
  if (!match) return null;
  return {
    op: (match[1] as '^' | '~' | '>=') ?? '=',
    version: `${match[2]}.${match[3]}.${match[4]}`,
  };
};

const compare = (a: string, b: string): number => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
};

export const admits = (range: string, version: string): boolean | null => {
  if (range.includes('||')) {
    const parts = range.split('||').map((part) => admits(part.trim(), version));
    if (parts.some((p) => p === true)) return true;
    return parts.includes(null) ? null : false;
  }
  const parsed = parseRange(range.trim());
  if (!parsed) return null;
  const cmp = compare(version, parsed.version);
  if (parsed.op === '=') return cmp === 0;
  if (parsed.op === '>=') return cmp >= 0;
  if (cmp < 0) return false;
  const [major, minor] = parsed.version.split('.').map(Number);
  const [vMajor, vMinor] = version.split('.').map(Number);
  if (parsed.op === '^') return major === 0 ? vMajor === 0 && vMinor === minor : vMajor === major;
  return vMajor === major && vMinor === minor;
};

const lockedVersion = (lockText: string, name: string): string | null => {
  const match = lockText.match(new RegExp(`"${name.replace(/\//g, '\\/')}@(\\d[^"]*)"`));
  return match ? match[1] : null;
};

export type RepoRef = { dir: string; name: string; pkg: PackageJson };

export const topoOrder = (root: string, manifest: Manifest): RepoRef[] => {
  const repos: RepoRef[] = discoverRepos(root, manifest).map((repo) => ({
    ...repo,
    pkg: JSON.parse(readFileSync(join(repo.dir, 'package.json'), 'utf8')),
  }));
  const names = new Set(repos.map((repo) => repo.name));
  const dependsOn = new Map<string, Set<string>>();
  for (const repo of repos) {
    const edges = new Set<string>();
    for (const field of DEP_FIELDS) {
      for (const dep of Object.keys(repo.pkg[field] ?? {})) {
        if (names.has(dep) && dep !== repo.name) edges.add(dep);
      }
    }
    dependsOn.set(repo.name, edges);
  }
  const order: RepoRef[] = [];
  const done = new Set<string>();
  while (done.size < repos.length) {
    const ready = repos
      .filter(
        (repo) =>
          !done.has(repo.name) &&
          [...(dependsOn.get(repo.name) as Set<string>)].every((dep) => done.has(dep)),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    if (ready.length === 0) throw new Error('dependency cycle among ecosystem repos');
    for (const repo of ready) {
      order.push(repo);
      done.add(repo.name);
    }
  }
  return order;
};

export const writeManifest = (manifest: Manifest): void =>
  writeFileSync(join(packageRoot, 'versions.json'), `${JSON.stringify(manifest, null, 2)}\n`);

export { compare };

export const discoverRepos = (
  root: string,
  manifest: Manifest,
): { dir: string; name: string }[] => {
  const repos: { dir: string; name: string }[] = [];
  for (const entry of readdirSync(root)) {
    const pkgPath = join(root, entry, 'package.json');
    if (!existsSync(pkgPath)) continue;
    const name = tryParseJsonc(readFileSync(pkgPath, 'utf8'))?.name;
    if (typeof name === 'string' && name in manifest.ecosystem)
      repos.push({ dir: join(root, entry), name });
  }
  return repos.sort((a, b) => a.name.localeCompare(b.name));
};

const detectPreset = (pkg: PackageJson, override?: Preset): Preset => {
  if (override) return override;
  const hasReact = DEP_FIELDS.some((field) => pkg[field]?.react !== undefined);
  return hasReact ? 'react' : 'base';
};

export function inspect(dir: string, manifest: Manifest, presetOverride?: Preset): Inspection {
  const findings: Finding[] = [];
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) {
    return {
      findings: [{ level: 'error', message: `no package.json in ${dir}` }],
      flush: () => false,
    };
  }
  const pkg: PackageJson = JSON.parse(readFileSync(pkgPath, 'utf8'));
  let pkgDirty = false;
  const touch = () => {
    pkgDirty = true;
  };

  for (const [name, pin] of Object.entries(manifest.toolchain)) {
    let present = false;
    for (const field of DEP_FIELDS) {
      const deps = pkg[field];
      if (!deps?.[name]) continue;
      present = true;
      if (field === 'peerDependencies') continue;
      if (deps[name] !== pin) {
        findings.push({
          level: 'error',
          message: `${name} ${deps[name]} → ${pin} (${field})`,
          fix: () => {
            deps[name] = pin;
            touch();
          },
        });
      }
    }
    if (!present && manifest.required.includes(name)) {
      findings.push({
        level: 'error',
        message: `${name} missing → devDependency ${pin}`,
        fix: () => {
          pkg.devDependencies ??= {};
          pkg.devDependencies[name] = pin;
          touch();
        },
      });
    }
  }

  for (const field of DEP_FIELDS) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const [name, range] of Object.entries(deps)) {
      if (range !== 'latest') continue;
      const pin = manifest.toolchain[name];
      findings.push({
        level: 'error',
        message: `${name} pinned to "latest" in ${field}${pin ? ` → ${pin}` : ' → pin a version'}`,
        fix: pin
          ? () => {
              deps[name] = pin;
              touch();
            }
          : undefined,
      });
    }
  }

  for (const [script, fallback] of Object.entries(REQUIRED_SCRIPTS)) {
    if (pkg.scripts?.[script]) continue;
    findings.push({
      level: 'error',
      message: `scripts.${script} missing → "${fallback}"`,
      fix: () => {
        pkg.scripts ??= {};
        pkg.scripts[script] = fallback;
        touch();
      },
    });
  }

  if (
    pkg.name !== '@inixiative/config' &&
    !DEP_FIELDS.some((field) => pkg[field]?.['@inixiative/config'])
  ) {
    findings.push({
      level: 'error',
      message: `@inixiative/config missing → devDependency ^${ownVersion()} (extends cannot resolve without it)`,
      fix: () => {
        pkg.devDependencies ??= {};
        pkg.devDependencies['@inixiative/config'] = `^${ownVersion()}`;
        touch();
      },
    });
  }

  const expectedPm = `bun@${manifest.bun}`;
  if (pkg.packageManager !== expectedPm) {
    findings.push({
      level: 'error',
      message: `packageManager ${pkg.packageManager ?? '(unset)'} → ${expectedPm}`,
      fix: () => {
        pkg.packageManager = expectedPm;
        touch();
      },
    });
  }

  const bunVersionPath = join(dir, '.bun-version');
  const bunVersion = existsSync(bunVersionPath)
    ? readFileSync(bunVersionPath, 'utf8').trim()
    : null;
  if (bunVersion !== manifest.bun) {
    findings.push({
      level: 'error',
      message: `.bun-version ${bunVersion ?? '(missing)'} → ${manifest.bun}`,
      fix: () => writeFileSync(bunVersionPath, `${manifest.bun}\n`),
    });
  }

  const lockbPath = join(dir, 'bun.lockb');
  if (existsSync(lockbPath)) {
    findings.push({
      level: 'error',
      message: 'legacy binary bun.lockb → delete and re-lock as bun.lock',
      fix: () => rmSync(lockbPath),
    });
  }

  const lockPath = join(dir, 'bun.lock');
  const lockText = existsSync(lockPath) ? readFileSync(lockPath, 'utf8') : null;

  if (existsSync(join(dir, '.git'))) {
    if (!lockText) {
      findings.push({
        level: 'error',
        message: 'bun.lock missing → run bun install and commit the lockfile',
      });
    } else if (spawnSync('git', ['check-ignore', '-q', 'bun.lock'], { cwd: dir }).status === 0) {
      findings.push({
        level: 'error',
        message: 'bun.lock is gitignored → stop ignoring it and commit the lockfile',
      });
    } else if (
      spawnSync('git', ['ls-files', '--error-unmatch', 'bun.lock'], { cwd: dir }).status !== 0
    ) {
      findings.push({
        level: 'error',
        message: 'bun.lock untracked → commit the lockfile',
      });
    }
  }

  for (const [name, blessed] of Object.entries(manifest.ecosystem)) {
    if (name === pkg.name) continue;
    for (const field of DEP_FIELDS) {
      const deps = pkg[field];
      const range = deps?.[name];
      if (!range) continue;
      const ok = admits(range, blessed);
      if (ok === false) {
        findings.push({
          level: 'error',
          kind: 'ecosystem-range',
          name,
          message: `${name} ${field} range ${range} does not admit blessed ${blessed} → ^${blessed}`,
          fix: () => {
            deps[name] = `^${blessed}`;
            touch();
          },
        });
      }
      if (ok === null) {
        findings.push({
          level: 'warn',
          message: `${name} range ${range} not understood; verify manually against ${blessed}`,
        });
      }
    }
    const installed = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
    if (lockText && installed) {
      const locked = lockedVersion(lockText, name);
      if (locked && admits(installed, locked) === false) {
        findings.push({
          level: 'error',
          kind: 'stale-lock',
          name,
          message: `${name} locked at ${locked}, violating declared ${installed} (stale lockfile) → re-lock`,
        });
      } else if (locked && locked !== blessed) {
        findings.push({
          level: 'error',
          kind: 'stale-lock',
          name,
          message: `${name} locked at ${locked}, blessed is ${blessed} → re-lock`,
        });
      }
    }
  }

  const preset = detectPreset(pkg, presetOverride);
  const tsconfigTarget = `@inixiative/config/tsconfig/${preset}.json`;
  const tsconfigPath = join(dir, 'tsconfig.json');
  if (!existsSync(tsconfigPath)) {
    findings.push({
      level: 'error',
      message: `tsconfig.json missing → stub extending ${tsconfigTarget}`,
      fix: () =>
        writeFileSync(
          tsconfigPath,
          `${JSON.stringify({ extends: tsconfigTarget, exclude: ['dist'] }, null, 2)}\n`,
        ),
    });
  } else {
    const tsconfig = tryParseJsonc(readFileSync(tsconfigPath, 'utf8')) ?? {};
    const extendsValue = tsconfig.extends;
    if (
      typeof extendsValue !== 'string' ||
      !extendsValue.startsWith('@inixiative/config/tsconfig/')
    ) {
      findings.push({
        level: 'error',
        message: `tsconfig.json extends ${typeof extendsValue === 'string' ? extendsValue : '(none)'} → ${tsconfigTarget}; local compilerOptions retained as overrides, review them`,
        fix: () => {
          const { extends: _replaced, ...rest } = tsconfig;
          const next = { extends: tsconfigTarget, ...rest };
          writeFileSync(tsconfigPath, `${JSON.stringify(next, null, 2)}\n`);
        },
      });
    }
  }

  const biomeTargets =
    preset === 'react'
      ? ['@inixiative/config/biome/base.json', '@inixiative/config/biome/react.json']
      : ['@inixiative/config/biome/base.json'];
  const biomePath = join(dir, 'biome.json');
  if (!existsSync(biomePath)) {
    findings.push({
      level: 'error',
      message: `biome.json missing → stub extending ${biomeTargets.join(' + ')}`,
      fix: () =>
        writeFileSync(biomePath, `${JSON.stringify({ extends: biomeTargets }, null, 2)}\n`),
    });
  } else {
    const biome = tryParseJsonc(readFileSync(biomePath, 'utf8')) ?? {};
    const extendsValue = Array.isArray(biome.extends) ? biome.extends : [];
    const missing = biomeTargets.filter((target) => !extendsValue.includes(target));
    if (missing.length > 0) {
      findings.push({
        level: 'error',
        message: `biome.json missing extends ${missing.join(', ')}; local rules retained as overrides, review them`,
        fix: () => {
          const next = { ...biome, extends: biomeTargets };
          writeFileSync(biomePath, `${JSON.stringify(next, null, 2)}\n`);
        },
      });
    }
  }

  return {
    findings,
    flush: () => {
      if (!pkgDirty) return false;
      writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
      return true;
    },
  };
}
