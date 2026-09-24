import { spawnSync } from 'node:child_process';
import {
  existsSync,
  globSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Release lanes, in the order a full train walks them. Each lane blesses its own packages;
 * a later lane builds on the earlier lanes' blessed sets, never the reverse.
 */
export const LANES = ['primitives', 'agentic'] as const;
export type Lane = (typeof LANES)[number];

/** A private repo that takes the train's range bump, re-lock and check, and is never published. */
export type Consumer = { lanes: Lane[]; upstream?: string };

export type Manifest = {
  bun: string;
  toolchain: Record<string, string>;
  required: string[];
  /** The primitives lane's blessed set, plus this package. */
  ecosystem: Record<string, string>;
  /** The agentic lane's blessed set. */
  agentic?: Record<string, string>;
  /** Consumers keyed by GitHub `owner/repo`; `upstream` is the repo it syncs from, processed first. */
  consumers?: Record<string, Consumer>;
};

export const isLane = (value: string): value is Lane =>
  (LANES as readonly string[]).includes(value);

/** The packages a lane publishes and blesses — never this package, which ships after every lane. */
export const lanePackages = (manifest: Manifest, lane: Lane): Record<string, string> => {
  const section = lane === 'primitives' ? manifest.ecosystem : (manifest.agentic ?? {});
  const { '@inixiative/config': _config, ...packages } = section;
  return packages;
};

export const laneSection = (manifest: Manifest, lane: Lane): Record<string, string> => {
  if (lane === 'primitives') return manifest.ecosystem;
  manifest.agentic ??= {};
  return manifest.agentic;
};

/** Every blessed version across all lanes — what any repo's ranges and lockfile answer to. */
export const blessedVersions = (manifest: Manifest): Record<string, string> => ({
  ...manifest.ecosystem,
  ...manifest.agentic,
});

export const laneOf = (manifest: Manifest, name: string): Lane | null =>
  LANES.find((lane) => name in lanePackages(manifest, lane)) ?? null;

/** Consumers of any of the given lanes, upstreams before the repos that sync from them. */
export const consumersFor = (manifest: Manifest, lanes: readonly Lane[]): string[] => {
  const consumers = manifest.consumers ?? {};
  const selected = Object.keys(consumers)
    .filter((repo) => consumers[repo].lanes.some((lane) => lanes.includes(lane)))
    .sort();
  const order: string[] = [];
  const visit = (repo: string, trail: string[]) => {
    if (order.includes(repo)) return;
    if (trail.includes(repo))
      throw new Error(`consumer upstream cycle: ${[...trail, repo].join(' → ')}`);
    const upstream = consumers[repo].upstream;
    if (upstream && selected.includes(upstream)) visit(upstream, [...trail, repo]);
    order.push(repo);
  };
  for (const repo of selected) visit(repo, []);
  return order;
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
  /**
   * Every package.json this inspection may rewrite, relative to the repo dir —
   * the root plus each workspace member. The train stages exactly these, so a
   * workspace bump cannot be written and then left out of the commit.
   */
  packagePaths: string[];
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
  const match = range.match(/^(\^|~|>=)?\s*(\d+)\.(\d+)\.(\d+)$/);
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
  const target = range.trim();
  if (version.includes('-')) return target === version ? true : null;
  const parsed = parseRange(target);
  if (!parsed) return null;
  const cmp = compare(version, parsed.version);
  if (parsed.op === '=') return cmp === 0;
  if (parsed.op === '>=') return cmp >= 0;
  if (cmp < 0) return false;
  const [major, minor] = parsed.version.split('.').map(Number);
  const [vMajor, vMinor] = version.split('.').map(Number);
  if (parsed.op === '^') {
    if (major > 0) return vMajor === major;
    if (minor > 0) return vMajor === 0 && vMinor === minor;
    return cmp === 0;
  }
  return vMajor === major && vMinor === minor;
};

/**
 * The version a lockfile resolves for a dependency key. `target` is the real package name when
 * the key is an npm alias (`"@inixiative/session-archive": "npm:@inixiative/archive@^0.2.1"`).
 */
export const lockedVersion = (lockText: string, key: string, target = key): string | null => {
  const lock = tryParseJsonc(lockText);
  const packages = lock?.packages;
  if (!packages || typeof packages !== 'object') return null;
  const entry = (packages as Record<string, unknown>)[key];
  const spec = Array.isArray(entry) ? entry[0] : null;
  if (typeof spec !== 'string' || !spec.startsWith(`${target}@`)) return null;
  const version = spec.slice(target.length + 1);
  return /^\d/.test(version) ? version : null;
};

/** `npm:<name>@<range>` → its parts; any other spec → null. */
export const npmAlias = (spec: string): { name: string; range: string } | null => {
  const match = spec.match(/^npm:((?:@[^/@]+\/)?[^@]+)@(.+)$/);
  return match ? { name: match[1], range: match[2] } : null;
};

/**
 * A checkout the train walks. `packages` are the lane packages it publishes — its root and/or
 * workspace members — in dependency order; a consumer publishes nothing and carries `consumer`.
 */
export type Checkout = {
  dir: string;
  name: string;
  pkg: PackageJson;
  lane: Lane | null;
  packages: { name: string; path: string }[];
  consumer?: { repo: string } & Consumer;
};

export type Discovery = {
  checkouts: Checkout[];
  /** Keys (package names or consumer repos) claimed by several eligible checkouts. */
  ambiguous: { key: string; dirs: string[] }[];
};

const readJson = (path: string): PackageJson | null => {
  try {
    return tryParseJsonc(readFileSync(path, 'utf8')) as PackageJson | null;
  } catch {
    return null;
  }
};

const originRepo = (dir: string): string | null => {
  const url = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: dir, encoding: 'utf8' });
  if (url.status !== 0) return null;
  const match = url.stdout.trim().match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/);
  return match ? match[1] : null;
};

const isLinkedWorktree = (dir: string): boolean => {
  const dotGit = join(dir, '.git');
  return existsSync(dotGit) && !statSync(dotGit).isDirectory();
};

const childDirs = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .filter((entry) => entry.name !== 'node_modules')
    .map((entry) => join(dir, entry.name));

/**
 * Candidate checkout dirs under root: each child with a package.json, and one level into a
 * child without one (a workspace folder such as kingdom-workspace/). Linked git worktrees
 * (`.git` is a file) are other sessions' branches and never candidates.
 */
const candidateDirs = (root: string): string[] => {
  const dirs: string[] = [];
  for (const child of childDirs(root)) {
    const nested = existsSync(join(child, 'package.json'))
      ? [child]
      : childDirs(child).filter((dir) => existsSync(join(dir, 'package.json')));
    dirs.push(...nested.filter((dir) => !isLinkedWorktree(dir)));
  }
  return dirs;
};

/**
 * Find the checkouts for the given lanes' packages and consumers. Packages match by name —
 * the root package or any workspace member — so directory names and layout never need
 * declaring; consumers are private apps and match by their origin's GitHub repo. When several
 * checkouts claim one key, only those with an origin remote count; if that still leaves more
 * than one, the key is ambiguous rather than guessed.
 */
export const discover = (
  root: string,
  manifest: Manifest,
  lanes: readonly Lane[] = LANES,
): Discovery => {
  const wanted = new Map<string, Lane>();
  for (const lane of lanes) {
    for (const name of Object.keys(lanePackages(manifest, lane))) wanted.set(name, lane);
  }
  const consumerRepos = new Set(consumersFor(manifest, lanes));

  const claims = new Map<string, Checkout[]>();
  const claim = (key: string, checkout: Checkout) =>
    claims.set(key, [...(claims.get(key) ?? []), checkout]);

  for (const dir of candidateDirs(root)) {
    const pkg = readJson(join(dir, 'package.json'));
    if (!pkg) continue;
    const name = typeof pkg.name === 'string' ? pkg.name : dir;
    const provided = [
      { name: pkg.name, path: 'package.json' },
      ...workspacePackagePaths(dir, pkg).map((path) => ({
        name: readJson(join(dir, path))?.name,
        path,
      })),
    ].filter(
      (entry): entry is { name: string; path: string } =>
        typeof entry.name === 'string' && wanted.has(entry.name),
    );
    if (provided.length > 0) {
      const checkout: Checkout = {
        dir,
        name,
        pkg,
        lane: wanted.get(provided[0].name) as Lane,
        packages: provided,
      };
      for (const entry of provided) claim(entry.name, checkout);
      continue;
    }
    if (consumerRepos.size === 0 || !existsSync(join(dir, '.git'))) continue;
    const repo = originRepo(dir);
    if (repo && consumerRepos.has(repo)) {
      const consumer = (manifest.consumers as Record<string, Consumer>)[repo];
      claim(repo, { dir, name, pkg, lane: null, packages: [], consumer: { repo, ...consumer } });
    }
  }

  const chosen = new Map<string, Checkout>();
  const ambiguous: Discovery['ambiguous'] = [];
  for (const [key, candidates] of claims) {
    const pool =
      candidates.length > 1
        ? candidates.filter((candidate) => originRepo(candidate.dir))
        : candidates;
    if (pool.length === 1) chosen.set(pool[0].dir, pool[0]);
    else ambiguous.push({ key, dirs: candidates.map((candidate) => candidate.dir).sort() });
  }
  const ambiguousDirs = new Set(ambiguous.flatMap((entry) => entry.dirs));
  const checkouts = [...chosen.values()]
    .filter((checkout) => !ambiguousDirs.has(checkout.dir))
    .map((checkout) => ({ ...checkout, packages: publishOrder(checkout) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { checkouts, ambiguous: ambiguous.sort((a, b) => a.key.localeCompare(b.key)) };
};

/** Lane packages and consumer repos of the given lanes that have no checkout. */
export const missingFor = (
  checkouts: Checkout[],
  manifest: Manifest,
  lanes: readonly Lane[] = LANES,
): string[] => {
  const found = new Set(
    checkouts.flatMap((checkout) => [
      ...checkout.packages.map((entry) => entry.name),
      ...(checkout.consumer ? [checkout.consumer.repo] : []),
    ]),
  );
  return [
    ...lanes.flatMap((lane) => Object.keys(lanePackages(manifest, lane))),
    ...consumersFor(manifest, lanes),
  ].filter((key) => !found.has(key));
};

/** Every dependency a set of package.json files declares, npm alias targets included. */
const dependencyNames = (dir: string, paths: string[]): Set<string> => {
  const names = new Set<string>();
  for (const path of paths) {
    const pkg = readJson(join(dir, path));
    for (const field of DEP_FIELDS) {
      for (const [key, spec] of Object.entries(pkg?.[field] ?? {})) {
        names.add(key);
        const alias = npmAlias(spec);
        if (alias) names.add(alias.name);
      }
    }
  }
  return names;
};

const orderBy = <T>(items: T[], key: (item: T) => string, deps: (item: T) => string[]): T[] => {
  const order: T[] = [];
  const done = new Set<string>();
  while (done.size < items.length) {
    const ready = items
      .filter((item) => !done.has(key(item)) && deps(item).every((dep) => done.has(dep)))
      .sort((a, b) => key(a).localeCompare(key(b)));
    if (ready.length === 0) throw new Error('dependency cycle among ecosystem repos');
    for (const item of ready) {
      order.push(item);
      done.add(key(item));
    }
  }
  return order;
};

/** A monorepo's lane packages in dependency order (foundry-core before foundry). */
const publishOrder = (checkout: Checkout): Checkout['packages'] => {
  const names = new Set(checkout.packages.map((entry) => entry.name));
  const deps = new Map(
    checkout.packages.map((entry) => [
      entry.name,
      [...dependencyNames(checkout.dir, [entry.path])].filter(
        (dep) => names.has(dep) && dep !== entry.name,
      ),
    ]),
  );
  return orderBy(
    checkout.packages,
    (entry) => entry.name,
    (entry) => deps.get(entry.name) ?? [],
  );
};

/**
 * Publishing checkouts in dependency order: a checkout waits for every other checkout whose
 * packages it declares (root or any workspace member, npm aliases included).
 */
export const topoOrder = (checkouts: Checkout[]): Checkout[] => {
  const publishing = checkouts.filter((checkout) => !checkout.consumer);
  const owner = new Map<string, string>();
  for (const checkout of publishing) {
    for (const entry of checkout.packages) owner.set(entry.name, checkout.dir);
  }
  return orderBy(
    publishing,
    (checkout) => checkout.dir,
    (checkout) => {
      const paths = ['package.json', ...workspacePackagePaths(checkout.dir, checkout.pkg)];
      return [...dependencyNames(checkout.dir, paths)]
        .map((dep) => owner.get(dep))
        .filter((dir): dir is string => !!dir && dir !== checkout.dir);
    },
  );
};

export type TrainPlan = {
  lanes: {
    lane: Lane;
    checkouts: Checkout[];
    missing: string[];
    ambiguous: Discovery['ambiguous'];
  }[];
  /** Consumers of every selected lane, after all lanes, upstreams first. */
  consumers: Checkout[];
  missingConsumers: string[];
  ambiguousConsumers: Discovery['ambiguous'];
};

/**
 * What a train over the selected lanes walks. Each lane stands alone — its own checkouts,
 * missing entries and ambiguities — so one lane's gap never holds another back. Consumers run
 * once, after every selected lane, against the full blessed set: a consumer of both lanes ends
 * coherent with both whichever lane ran.
 */
export const trainPlan = (
  root: string,
  manifest: Manifest,
  lanes: readonly Lane[] = LANES,
): TrainPlan => {
  const { checkouts, ambiguous } = discover(root, manifest, lanes);
  const consumerOrder = consumersFor(manifest, lanes);
  const byRepo = new Map(
    checkouts.flatMap((checkout) =>
      checkout.consumer ? [[checkout.consumer.repo, checkout] as const] : [],
    ),
  );
  return {
    lanes: LANES.filter((lane) => lanes.includes(lane)).map((lane) => {
      const names = new Set(Object.keys(lanePackages(manifest, lane)));
      const own = checkouts.filter((checkout) => checkout.lane === lane);
      return {
        lane,
        checkouts: topoOrder(own),
        missing: [...names].filter(
          (name) =>
            !own.some((checkout) => checkout.packages.some((entry) => entry.name === name)) &&
            !ambiguous.some((entry) => entry.key === name),
        ),
        ambiguous: ambiguous.filter((entry) => names.has(entry.key)),
      };
    }),
    consumers: consumerOrder.flatMap((repo) => byRepo.get(repo) ?? []),
    missingConsumers: consumerOrder.filter(
      (repo) => !byRepo.has(repo) && !ambiguous.some((entry) => entry.key === repo),
    ),
    ambiguousConsumers: ambiguous.filter((entry) => consumerOrder.includes(entry.key)),
  };
};

export const writeManifest = (manifest: Manifest): void =>
  writeFileSync(join(packageRoot, 'versions.json'), `${JSON.stringify(manifest, null, 2)}\n`);

export { compare };

/**
 * Workspace member package.json paths, relative to the repo root.
 *
 * Ecosystem deps are declared per package.json, so a monorepo pins them in its
 * workspace members (template's prisma-map dep lives in packages/db), not at the
 * root. Reading only the root silently leaves those behind at release time.
 */
const workspacePackagePaths = (dir: string, pkg: PackageJson): string[] => {
  const raw = pkg.workspaces;
  const globs = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { packages?: string[] } | undefined)?.packages)
      ? (raw as { packages: string[] }).packages
      : [];
  if (globs.length === 0) return [];

  const paths = new Set<string>();
  for (const pattern of globs) {
    for (const match of globSync(`${pattern}/package.json`, { cwd: dir })) {
      paths.add(match.split(sep).join('/'));
    }
  }
  return [...paths].sort();
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
      packagePaths: [],
    };
  }
  const pkg: PackageJson = JSON.parse(readFileSync(pkgPath, 'utf8'));
  let pkgDirty = false;
  const touch = () => {
    pkgDirty = true;
  };

  // Root plus workspace members. Only the ecosystem-range pass walks the members:
  // toolchain pins, required scripts and packageManager are repo-level policy and
  // stay rooted, but a dependency range is a fact of the package.json declaring it.
  const members = workspacePackagePaths(dir, pkg).map((rel) => {
    const abs = join(dir, rel);
    return {
      rel,
      abs,
      pkg: JSON.parse(readFileSync(abs, 'utf8')) as PackageJson,
      dirty: false,
    };
  });

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
    } else {
      const ignoreStatus = spawnSync('git', ['check-ignore', '-q', 'bun.lock'], {
        cwd: dir,
      }).status;
      if (ignoreStatus === 0) {
        findings.push({
          level: 'error',
          message: 'bun.lock is gitignored → removing the ignore rule; commit the lockfile',
          fix: () => {
            const gitignorePath = join(dir, '.gitignore');
            if (!existsSync(gitignorePath)) return;
            const kept = readFileSync(gitignorePath, 'utf8')
              .split('\n')
              .filter((line) => !/^\s*bun\.lockb?\s*$/.test(line));
            writeFileSync(gitignorePath, kept.join('\n'));
          },
        });
      } else if (ignoreStatus === 1) {
        const trackedStatus = spawnSync('git', ['ls-files', '--error-unmatch', 'bun.lock'], {
          cwd: dir,
        }).status;
        if (trackedStatus === 1) {
          findings.push({
            level: 'error',
            message: 'bun.lock untracked → staging it; commit the lockfile',
            fix: () => {
              spawnSync('git', ['add', 'bun.lock'], { cwd: dir });
            },
          });
        } else if (trackedStatus !== 0) {
          findings.push({
            level: 'warn',
            message: 'git ls-files failed — cannot verify the lockfile is tracked',
          });
        }
      } else {
        findings.push({
          level: 'warn',
          message: 'git check-ignore failed — cannot verify the lockfile is not ignored',
        });
      }
    }

    const lefthookPin = manifest.toolchain.lefthook;
    if (lefthookPin && !DEP_FIELDS.some((field) => pkg[field]?.lefthook)) {
      findings.push({
        level: 'error',
        message: `lefthook missing → devDependency ${lefthookPin}`,
        fix: () => {
          pkg.devDependencies ??= {};
          pkg.devDependencies.lefthook = lefthookPin;
          touch();
        },
      });
    }
    const lefthookPath = join(dir, 'lefthook.yml');
    const lefthookStub = 'extends:\n  - node_modules/@inixiative/config/lefthook/base.yml\n';
    if (!existsSync(lefthookPath)) {
      findings.push({
        level: 'error',
        message: 'lefthook.yml missing → stub extending @inixiative/config/lefthook/base.yml',
        fix: () => writeFileSync(lefthookPath, lefthookStub),
      });
    } else if (!readFileSync(lefthookPath, 'utf8').includes('lefthook/base.yml')) {
      findings.push({
        level: 'error',
        message:
          'lefthook.yml does not extend the shared hooks → replaced with extends stub (local hooks overwritten — review the diff)',
        fix: () => writeFileSync(lefthookPath, lefthookStub),
      });
    }
    if (!pkg.scripts?.prepare) {
      findings.push({
        level: 'error',
        message: 'scripts.prepare missing → "lefthook install"',
        fix: () => {
          pkg.scripts ??= {};
          pkg.scripts.prepare = 'lefthook install';
          touch();
        },
      });
    } else if (!pkg.scripts.prepare.includes('lefthook')) {
      findings.push({
        level: 'warn',
        message: 'scripts.prepare does not run lefthook install — hooks will not auto-install',
      });
    }
  }

  const rangeTargets = [
    { label: '', pkg, mark: touch },
    ...members.map((member) => ({
      label: `${member.rel}: `,
      pkg: member.pkg,
      mark: () => {
        member.dirty = true;
      },
    })),
  ];

  const blessedSet = blessedVersions(manifest);
  const staleKeys = new Set<string>();
  for (const target of rangeTargets) {
    for (const field of DEP_FIELDS) {
      const deps = target.pkg[field];
      for (const [key, spec] of Object.entries(deps ?? {})) {
        if (/^(file|link|workspace):/.test(spec)) continue;
        const alias = npmAlias(spec);
        const name = alias && !(key in blessedSet) ? alias.name : key;
        const range = alias && name === alias.name ? alias.range : spec;
        const blessed = blessedSet[name];
        if (!blessed || name === target.pkg.name || !deps) continue;
        const rewrite = (next: string) => (name === key ? next : `npm:${name}@${next}`);
        const ok = admits(range, blessed);
        if (ok === false) {
          findings.push({
            level: 'error',
            kind: 'ecosystem-range',
            name,
            message: `${target.label}${key} ${field} range ${spec} does not admit blessed ${blessed} → ${rewrite(`^${blessed}`)}`,
            fix: () => {
              deps[key] = rewrite(`^${blessed}`);
              target.mark();
            },
          });
        }
        if (ok === null) {
          findings.push({
            level: 'warn',
            message: `${target.label}${key} range ${spec} not understood; verify manually against ${blessed}`,
          });
        }
        if (!lockText || field === 'peerDependencies' || staleKeys.has(key)) continue;
        const locked = lockedVersion(lockText, key, name);
        if (locked && admits(range, locked) === false) {
          staleKeys.add(key);
          findings.push({
            level: 'error',
            kind: 'stale-lock',
            name: key,
            message: `${target.label}${key} locked at ${locked}, violating declared ${spec} (stale lockfile) → re-lock`,
          });
        } else if (locked && locked !== blessed) {
          staleKeys.add(key);
          findings.push({
            level: 'error',
            kind: 'stale-lock',
            name: key,
            message: `${target.label}${key} locked at ${locked}, blessed is ${blessed} → re-lock`,
          });
        }
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
    packagePaths: ['package.json', ...members.map((member) => member.rel)],
    flush: () => {
      let wrote = false;
      if (pkgDirty) {
        writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
        wrote = true;
      }
      for (const member of members) {
        if (!member.dirty) continue;
        writeFileSync(member.abs, `${JSON.stringify(member.pkg, null, 2)}\n`);
        wrote = true;
      }
      return wrote;
    },
  };
}
