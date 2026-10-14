import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { type CommandLine, parseCommandLine, UsageError } from './args';
import {
  acquireTrainLock,
  adoptionTarget,
  blessedVersions,
  type Checkout,
  compare,
  type Finding,
  holdTrainLock,
  inspect,
  isConfigCheckout,
  LANES,
  type Lane,
  laneOf,
  laneSection,
  loadManifest,
  ownVersion,
  packageRoot,
  processStart,
  promoteCandidates,
  staleUpdates,
  trainLockPath,
  trainPlan,
  writeManifest,
} from './lib';
import { type Project, portsFor, projects } from './ports';

let commandLine: CommandLine;
try {
  commandLine = parseCommandLine(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof UsageError)) throw error;
  console.error(`✗ ${error.message}`);
  console.error(
    'Usage: inixiative-config check [dir] [--preset=base|node|react]\n       inixiative-config sync [dir] [--preset=base|node|react] [--force] [--no-install]\n       inixiative-config scan [root] [--lane=primitives|agentic]\n       inixiative-config train [root] [--lane=primitives|agentic] [--push] [--dry-run]\n       inixiative-config ports [project]',
  );
  process.exit(2);
}
const { command, positionals, preset: presetFlag, dryRun } = commandLine;
const dir = resolve(positionals[0] ?? '.');

if (command === 'ports') {
  const project = positionals[0];
  if (project !== undefined && !projects.includes(project as Project)) {
    console.error(`✗ unknown project: ${project} (${projects.join(', ')})`);
    process.exit(2);
  }
  for (const name of project ? [project as Project] : projects)
    console.log(
      `${name}: ${Object.entries(portsFor(name))
        .map(([service, port]) => `${service}=${port}`)
        .join(' ')}`,
    );
  process.exit(0);
}
const lanes: Lane[] = commandLine.lane ? [commandLine.lane] : [...LANES];

const manifest = loadManifest();

const report = (findings: Finding[]): number => {
  for (const finding of findings) {
    console.log(`${finding.level === 'error' ? '✗' : '⚠'} ${finding.message}`);
  }
  const errors = findings.filter((finding) => finding.level === 'error').length;
  const warnings = findings.length - errors;
  console.log(
    findings.length === 0
      ? '✓ in sync'
      : `${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`,
  );
  return errors;
};

if (process.versions.bun && process.versions.bun !== manifest.bun) {
  console.log(`⚠ running bun ${process.versions.bun}, blessed is ${manifest.bun} (bun upgrade)`);
}

const git = (cwd: string, ...gitArgs: string[]) =>
  spawnSync('git', gitArgs, { cwd, encoding: 'utf8' as const });

const behindOrigin = (cwd: string): number => {
  const behind = git(cwd, 'rev-list', '--count', 'HEAD..@{upstream}');
  return behind.status === 0 ? Number(behind.stdout.trim()) : 0;
};

const staleCheckoutFindings = (cwd: string): Finding[] => {
  git(cwd, 'fetch', '--quiet');
  const behind = behindOrigin(cwd);
  return behind > 0
    ? [
        {
          level: 'error',
          message: `checkout is ${behind} commit${behind === 1 ? '' : 's'} behind origin — local state is stale, pull before trusting findings`,
        },
      ]
    : [];
};

const unmergedSessionBranches = (cwd: string): string[] => {
  const branches = git(
    cwd,
    'branch',
    '-r',
    '--no-merged',
    '@{upstream}',
    '--list',
    'origin/claude/*',
  );
  if (branches.status !== 0) return [];
  return branches.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
};

const offDefaultBranch = (cwd: string): { branch: string; main: string } | null => {
  const branch = git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD');
  if (branch.status !== 0) return null;
  const head = git(cwd, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD');
  const main = head.status === 0 ? head.stdout.trim().replace(/^origin\//, '') : 'main';
  const current = branch.stdout.trim();
  return current === main ? null : { branch: current, main };
};

if (command === 'check') {
  const { findings } = inspect(dir, manifest, presetFlag);
  process.exit(report(findings) > 0 ? 1 : 0);
}

const laneLabel = (checkout: Checkout): string =>
  checkout.consumer
    ? `consumer of ${checkout.consumer.lanes.join(' + ')}`
    : `${checkout.lane} lane`;

if (command === 'scan') {
  const plan = trainPlan(dir, manifest, lanes);
  const checkouts = [...plan.lanes.flatMap((lane) => lane.checkouts), ...plan.consumers];
  if (checkouts.length === 0) {
    console.error(`✗ no ecosystem repos found under ${dir}`);
    process.exit(1);
  }
  const missing = [...plan.lanes.flatMap((lane) => lane.missing), ...plan.missingConsumers];
  const ambiguous = [...plan.lanes.flatMap((lane) => lane.ambiguous), ...plan.ambiguousConsumers];
  const drifted: string[] = [];
  for (const [name, version] of Object.entries(manifest.candidates ?? {})) {
    console.log(`candidate: ${name}@${version} (blessed ${blessedVersions(manifest)[name]})`);
  }
  for (const checkout of checkouts) {
    console.log(`\n${checkout.name} — ${checkout.dir} (${laneLabel(checkout)})`);
    const off = offDefaultBranch(checkout.dir);
    const branchFindings: Finding[] = off
      ? [
          {
            level: 'warn',
            message: `checkout is on ${off.branch}, not ${off.main} — findings reflect the branch, not what ships`,
          },
        ]
      : [];
    const findings = [
      ...branchFindings,
      ...staleCheckoutFindings(checkout.dir),
      ...inspect(checkout.dir, manifest).findings,
    ];
    if (report(findings) > 0) drifted.push(checkout.name);
    for (const branch of unmergedSessionBranches(checkout.dir)) {
      console.log(`⚠ unmerged session branch: ${branch}`);
    }
  }
  if (missing.length > 0) console.error(`\n✗ no checkout found for: ${missing.join(', ')}`);
  for (const entry of ambiguous) {
    console.error(`✗ ambiguous checkouts for ${entry.key}: ${entry.dirs.join(', ')}`);
  }
  console.log(
    `\nscanned ${checkouts.length} repos (${lanes.join(' + ')}): ${drifted.length === 0 ? 'all in sync' : `${drifted.length} drifted (${drifted.join(', ')})`}${missing.length > 0 ? `, ${missing.length} missing` : ''}${ambiguous.length > 0 ? `, ${ambiguous.length} ambiguous` : ''}`,
  );
  process.exit(drifted.length > 0 || missing.length > 0 || ambiguous.length > 0 ? 1 : 0);
}

/** Thrown to stop one lane (or one consumer) without stopping the train. */
class Abort extends Error {}
/** A repo's own check failed: against candidates it moved onto, that repo adopts them on a branch. */
class CheckFailed extends Abort {}

if (command === 'train') {
  /**
   * Every write the train makes — installs, checks, file edits, commits, branches, publishes,
   * pushes — goes through here. A dry run prints what it would do and returns `planned`.
   */
  const effect = <T>(description: string, planned: T, run: () => T): T => {
    if (!dryRun) return run();
    console.log(`  [dry-run] would ${description}`);
    return planned;
  };
  if (dryRun) console.log('dry run: nothing is installed, written, committed, published or pushed');

  if (!isConfigCheckout(packageRoot)) {
    const message = `this config (${packageRoot}) is not a git checkout of inixiative/config — run the train from a clone, never a bunx or npm copy`;
    if (!dryRun) {
      console.error(`✗ ${message}`);
      process.exit(1);
    }
    console.log(`⚠ ${message}`);
  }

  if (!dryRun) {
    const path = trainLockPath();
    const lock = acquireTrainLock(path, {
      pid: process.pid,
      hostname: hostname(),
      processStart: processStart(process.pid),
      startedAt: new Date().toISOString(),
      lanes,
      root: dir,
      checkout: packageRoot,
    });
    if (!lock.ok) {
      const { pid, hostname: host, startedAt, lanes: held, root, checkout } = lock.heldBy;
      console.error(
        `✗ another train is running (pid ${pid} on ${host}, lanes ${held.join(' + ')}, root ${root}, from ${checkout}, since ${startedAt}) — wait for it to finish; one train at a time. If that train is truly gone, delete ${lock.path}`,
      );
      process.exit(1);
    }
    const stale = lock.reclaimed;
    if (stale?.reason === 'corrupt') {
      console.log(
        `⚠ took over a corrupt train lock at ${path} (unparsable: ${JSON.stringify(stale.contents)})`,
      );
    } else if (stale) {
      console.log(
        `⚠ took over a stale train lock (pid ${stale.holder.pid} ${stale.reason === 'gone' ? 'is gone' : 'now belongs to another process'})`,
      );
    }
    holdTrainLock(lock.release);
  }

  git(packageRoot, 'fetch', '--quiet');
  if (behindOrigin(packageRoot) > 0) {
    if (!dryRun) {
      console.error(
        '✗ this config checkout is behind origin — its blessed set is stale; pull first',
      );
      process.exit(1);
    }
    console.log('⚠ this config checkout is behind origin — the plan uses a stale blessed set');
  }
  const plan = trainPlan(dir, manifest, lanes);
  if (plan.lanes.every((lane) => lane.checkouts.length === 0) && plan.consumers.length === 0) {
    console.error(`✗ no ecosystem repos found under ${dir}`);
    process.exit(1);
  }

  /** Versions published (or found on npm) this run and recorded as candidates. */
  const recorded: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  const failedLanes = new Set<Lane>();
  const committed = new Set<string>();
  /** Branches to push and open a PR for: consumer syncs and adoptions. */
  const reviewBranches: { dir: string; branch: string; base: string }[] = [];
  /** Repos still to adopt candidates: opened this run, or an earlier run's branch not yet merged. */
  const adoptions: {
    name: string;
    dir: string;
    branch: string;
    moving: string[];
    opened: boolean;
  }[] = [];
  /** Repos that never got through this run (skipped or failed) and the candidates they'd move onto. */
  const held: { name: string; moving: string[] }[] = [];
  /** Linked worktrees the train committed branches in, removed however it ends. */
  const worktrees: { repo: string; path: string }[] = [];
  process.on('exit', () => {
    for (const { repo, path } of worktrees.splice(0)) {
      git(repo, 'worktree', 'remove', '--force', path);
    }
  });
  /** What repos move onto: the blessed sets with every candidate in place. */
  const target = () => adoptionTarget(manifest);

  /** Default branch, clean, fast-forwarded to origin — or skipped with the reason printed. */
  const ready = (checkout: Checkout): boolean => {
    const porcelain = git(checkout.dir, 'status', '--porcelain');
    if (porcelain.status !== 0) {
      console.log('⚠ not a git checkout — skipping');
      return false;
    }
    const off = offDefaultBranch(checkout.dir);
    if (off) {
      console.log(
        `⚠ on ${off.branch}, not ${off.main} — the train only ships the default branch, skipping`,
      );
      return false;
    }
    if (porcelain.stdout.trim().length > 0) {
      console.log('⚠ dirty working tree — commit your work first, skipping');
      return false;
    }
    git(checkout.dir, 'fetch', '--quiet');
    for (const branch of unmergedSessionBranches(checkout.dir)) {
      console.log(`⚠ unmerged session branch: ${branch} — a bump may be hiding there`);
    }
    const behind = behindOrigin(checkout.dir);
    if (behind > 0) {
      const localOnly = git(checkout.dir, 'rev-list', '--count', '@{upstream}..HEAD');
      if (localOnly.status === 0 && Number(localOnly.stdout.trim()) > 0) {
        console.log('⚠ diverged from origin — reconcile first, skipping');
        return false;
      }
      const merged = effect(
        `fast-forward to origin (+${behind}); the plan below reflects the local tree`,
        true,
        () => git(checkout.dir, 'merge', '--ff-only', '@{upstream}').status === 0,
      );
      if (!merged) {
        console.log('⚠ fast-forward to origin failed — reconcile first, skipping');
        return false;
      }
      if (!dryRun) {
        console.log(`↓ fast-forwarded to origin (+${behind})`);
        checkout.pkg = JSON.parse(readFileSync(join(checkout.dir, 'package.json'), 'utf8'));
      }
    }
    return true;
  };

  /** Bump ecosystem ranges to the blessed set; report whether anything moved or the lock is stale. */
  const bumpRanges = (checkout: Checkout) => {
    const inspection = inspect(checkout.dir, target());
    const bumps = inspection.findings.filter((finding) => finding.kind === 'ecosystem-range');
    for (const bump of bumps) console.log(`  ${bump.message}`);
    if (bumps.length > 0) {
      effect(
        `rewrite ${bumps.length} ecosystem range(s) to the blessed set and its candidates`,
        undefined,
        () => {
          for (const bump of bumps) bump.fix?.();
          inspection.flush();
        },
      );
    }
    return {
      inspection,
      bumped: bumps.length > 0,
      staleLock: inspection.findings.some((finding) => finding.kind === 'stale-lock'),
    };
  };

  /** Re-lock onto the blessed set and, unless told otherwise, run the repo's own check. */
  const relockAndCheck = (checkout: Checkout, check = true) =>
    effect(`re-lock ${checkout.name}${check ? ' and run its check' : ''}`, undefined, () => {
      if (spawnSync('bun', ['install'], { cwd: checkout.dir, stdio: 'inherit' }).status !== 0) {
        throw new Abort(`bun install failed in ${checkout.name}`);
      }
      for (const { cwd, names } of staleUpdates(
        checkout.dir,
        inspect(checkout.dir, target()).findings,
      )) {
        spawnSync('bun', ['update', ...names], { cwd, stdio: 'inherit' });
      }
      if (
        check &&
        spawnSync('bun', ['run', 'check'], { cwd: checkout.dir, stdio: 'inherit' }).status !== 0
      ) {
        throw new CheckFailed(`check failed in ${checkout.name}`);
      }
    });
  /**
   * Checkouts and branches this train brought onto the blessed set; they follow this package's
   * own release. `onBranch` ones are worktrees of a review or adoption branch, never pushed as main.
   */
  const followers: { checkout: Checkout; onBranch: boolean }[] = [];

  /**
   * A checkout the train could not walk. Whatever candidates it would move onto stay
   * candidates: nothing has verified it against them.
   */
  const skip = (checkout: Checkout) => {
    skipped.push(checkout.name);
    if (!existsSync(join(checkout.dir, 'package.json'))) return;
    const moving = movesOf(checkout);
    if (moving.length > 0) held.push({ name: checkout.name, moving });
  };

  /** Put the files the train rewrote back to HEAD, and node_modules back to that lockfile. */
  const restore = (checkout: Checkout, packagePaths: string[]) =>
    effect(`restore ${checkout.name}'s package.json files + bun.lock`, undefined, () => {
      const owned = [...packagePaths, 'bun.lock'];
      if (git(checkout.dir, 'status', '--porcelain', '--', ...owned).stdout.trim() === '') return;
      const tracked = git(checkout.dir, 'ls-files', '--', ...owned)
        .stdout.split('\n')
        .filter(Boolean);
      if (tracked.length > 0) git(checkout.dir, 'checkout', 'HEAD', '--', ...tracked);
      spawnSync('bun', ['install', '--frozen-lockfile'], { cwd: checkout.dir, stdio: 'inherit' });
      const left = git(checkout.dir, 'status', '--porcelain').stdout.trim();
      if (left) console.log(`⚠ ${checkout.name} has changes the train did not make:\n${left}`);
    });

  /** The candidates a checkout's ranges or lockfile would move onto. */
  const movesOf = (checkout: Checkout): string[] => {
    const candidates = manifest.candidates ?? {};
    const names = inspect(checkout.dir, target()).findings.flatMap((finding) =>
      (finding.kind === 'ecosystem-range' || finding.kind === 'stale-lock') &&
      finding.target &&
      finding.target in candidates
        ? [finding.target]
        : [],
    );
    return [...new Set(names)].sort();
  };

  const adoptionBranch = (moving: string[]): string =>
    `train/adopt-${moving.map((name) => `${name.replace(/^@inixiative\//, '')}-${manifest.candidates?.[name]}`).join('-')}`;

  const branchExists = (cwd: string, branch: string): boolean =>
    [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`].some(
      (ref) => git(cwd, 'rev-parse', '--verify', '--quiet', ref).status === 0,
    );

  /** An earlier train opened this adoption and it hasn't merged: wait for it, don't redo it. */
  const pendingAdoption = (checkout: Checkout, moving: string[]): boolean => {
    if (moving.length === 0) return false;
    const branch = adoptionBranch(moving);
    if (!branchExists(checkout.dir, branch)) return false;
    console.log(`⏳ adopting ${moving.join(', ')} on ${branch} — waiting for it to merge`);
    adoptions.push({ name: checkout.name, dir: checkout.dir, branch, moving, opened: false });
    return true;
  };

  /** A linked worktree of `checkout` on a new branch from HEAD; the checkout itself never moves. */
  const worktree = (checkout: Checkout, branch: string): Checkout => {
    const path = join(mkdtempSync(join(tmpdir(), 'inixiative-train-')), basename(checkout.dir));
    if (git(checkout.dir, 'worktree', 'add', '-b', branch, path, 'HEAD').status !== 0) {
      throw new Abort(`could not create ${branch} in ${checkout.name}`);
    }
    worktrees.push({ repo: checkout.dir, path });
    return { ...checkout, dir: path };
  };

  const defaultBranch = (cwd: string): string => offDefaultBranch(cwd)?.main ?? currentBranch(cwd);

  /**
   * Commit a consumer's passing re-lock on a review branch, in a worktree, and put the checkout
   * back as it was: a train never leaves a checkout dirty or off its default branch.
   */
  const reviewBranch = (checkout: Checkout, packagePaths: string[]) => {
    const branch = freeBranch(
      checkout.dir,
      `train/ecosystem-sync-${new Date().toISOString().slice(0, 10)}`,
    );
    const base = defaultBranch(checkout.dir);
    const opened = effect(
      `create review branch ${branch} in ${checkout.name} (in a worktree; the checkout stays on ${base})`,
      true,
      () => {
        const branchCheckout = worktree(checkout, branch);
        for (const path of [...packagePaths, 'bun.lock']) {
          if (existsSync(join(checkout.dir, path))) {
            writeFileSync(join(branchCheckout.dir, path), readFileSync(join(checkout.dir, path)));
          }
        }
        restore(checkout, packagePaths);
        // The commit hooks typecheck, so the worktree needs its own install.
        relockAndCheck(branchCheckout, false);
        if (!commitOwned(branchCheckout, packagePaths, true)) return false;
        followers.push({ checkout: branchCheckout, onBranch: true });
        console.log(`committed on ${branch} for review; ${checkout.name} stays on ${base}`);
        return true;
      },
    );
    if (opened) reviewBranches.push({ dir: checkout.dir, branch, base });
  };

  /**
   * A repo that fails against candidates adopts them on `train/adopt-<pkg>-<version>`: re-lock in
   * a worktree, run its `train:adopt` script if it declares one (Foundry re-records cassettes),
   * commit everything, and open a PR whose CI must pass against the candidates. The candidates
   * stay unblessed until it merges and a later train finds the repo on them.
   */
  const adopt = (checkout: Checkout, moving: string[]) => {
    const branch = adoptionBranch(moving);
    const base = defaultBranch(checkout.dir);
    const label = moving.map((name) => `${name}@${manifest.candidates?.[name]}`).join(', ');
    const script = checkout.pkg.scripts?.['train:adopt'];
    adoptions.push({ name: checkout.name, dir: checkout.dir, branch, moving, opened: true });
    try {
      effect(
        `open ${branch} in ${checkout.name}: re-lock onto ${label}${script ? ', run train:adopt' : ''}, commit`,
        undefined,
        () => {
          const branchCheckout = worktree(checkout, branch);
          bumpRanges(branchCheckout);
          relockAndCheck(branchCheckout, false);
          if (
            script &&
            spawnSync('bun', ['run', 'train:adopt'], { cwd: branchCheckout.dir, stdio: 'inherit' })
              .status !== 0
          ) {
            console.log(
              `⚠ train:adopt failed in ${checkout.name} — the PR needs work before it merges`,
            );
          }
          git(branchCheckout.dir, 'add', '-A');
          const commit = spawnSync('git', ['commit', '-m', `chore: adopt ${label}`], {
            cwd: branchCheckout.dir,
            stdio: 'inherit',
          });
          if (commit.status !== 0)
            throw new Abort(`commit failed on ${branch} in ${checkout.name}`);
          followers.push({ checkout: branchCheckout, onBranch: true });
        },
      );
      reviewBranches.push({ dir: checkout.dir, branch, base });
    } catch (error) {
      if (!(error instanceof Abort)) throw error;
      failed.push(checkout.name);
      console.error(`✗ ${error.message} — adopt ${label} in ${checkout.name} by hand`);
    }
  };

  // Stage exactly what the inspection owns — root package.json plus every workspace member —
  // so a bump written into packages/* cannot be left out of the commit and silently un-released.
  // A dry run wrote nothing, so `changes` (did this checkout bump or re-lock) stands in for git.
  const commitOwned = (checkout: Checkout, packagePaths: string[], changes: boolean): boolean => {
    if (dryRun && !changes) return false;
    return effect(`commit its package.json files + bun.lock in ${checkout.name}`, true, () => {
      const tracked = [...packagePaths, 'bun.lock'].filter((path) =>
        existsSync(join(checkout.dir, path)),
      );
      const mutated = git(checkout.dir, 'status', '--porcelain', '--', ...tracked);
      if (mutated.status !== 0 || mutated.stdout.trim().length === 0) return false;
      if (git(checkout.dir, 'add', '--', ...tracked).status !== 0) {
        throw new Abort(`git add failed in ${checkout.name} — is bun.lock ignored?`);
      }
      const commit = spawnSync(
        'git',
        ['commit', '-m', 'chore: sync ecosystem deps to blessed set'],
        {
          cwd: checkout.dir,
          stdio: 'inherit',
        },
      );
      if (commit.status !== 0) throw new Abort(`commit failed in ${checkout.name}`);
      return true;
    });
  };

  /**
   * A workspace member is packed by bun, which rewrites `workspace:` ranges to the versions
   * being released, then published by npm so auth and OTP prompts behave like a root publish.
   */
  const publish = (
    checkout: Checkout,
    entry: { name: string; path: string },
    version: string,
    remote: string | null,
  ) =>
    effect(`publish ${entry.name}@${version} to npm (npm has ${remote ?? 'none'})`, true, () => {
      console.log(`publishing ${entry.name}@${version} (npm has ${remote ?? 'none'})`);
      if (!publishToNpm(checkout, entry)) throw new Abort(`publish failed for ${entry.name}`);
      if (!servedByRegistry(entry.name, version)) {
        throw new Abort(`npm accepted ${entry.name}@${version} but the registry does not serve it`);
      }
      return true;
    });

  const publishToNpm = (checkout: Checkout, entry: { name: string; path: string }): boolean => {
    if (entry.path === 'package.json') {
      return spawnSync('npm', ['publish'], { cwd: checkout.dir, stdio: 'inherit' }).status === 0;
    }
    const memberDir = join(checkout.dir, dirname(entry.path));
    const out = mkdtempSync(join(tmpdir(), 'inixiative-train-'));
    try {
      const pack = spawnSync('bun', ['pm', 'pack', '--destination', out], {
        cwd: memberDir,
        stdio: 'inherit',
      });
      const tarball = readdirSync(out).find((name) => name.endsWith('.tgz'));
      if (pack.status !== 0 || !tarball) return false;
      return (
        spawnSync('npm', ['publish', join(out, tarball)], { cwd: memberDir, stdio: 'inherit' })
          .status === 0
      );
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  };

  const npmLatest = (name: string): string | null => {
    const remote = spawnSync('npm', ['view', `${name}@latest`, 'version'], { encoding: 'utf8' });
    return remote.status === 0 ? remote.stdout.trim() : null;
  };

  for (const { lane, checkouts, missing, ambiguous } of plan.lanes) {
    console.log(
      `\n═ ${lane} lane: ${checkouts.map((checkout) => checkout.name).join(' → ') || '(none)'}`,
    );
    const section = laneSection(manifest, lane);
    const before = { ...section };
    const candidatesBefore = { ...manifest.candidates };
    const laneRecorded: string[] = [];
    try {
      if (missing.length > 0) {
        throw new Abort(
          `no checkout under ${dir} for: ${missing.join(', ')} — a partial lane ships an incoherent set`,
        );
      }
      if (ambiguous.length > 0) {
        throw new Abort(
          ambiguous
            .map((entry) => `ambiguous checkouts for ${entry.key}: ${entry.dirs.join(', ')}`)
            .join('; '),
        );
      }
      for (const checkout of checkouts) {
        console.log(`\n▸ ${checkout.name} — ${checkout.dir}`);
        if (!ready(checkout)) {
          skip(checkout);
          continue;
        }
        const releases = checkout.packages.map((entry) => {
          const local =
            (JSON.parse(readFileSync(join(checkout.dir, entry.path), 'utf8')).version as string) ??
            '0.0.0';
          const remote = npmLatest(entry.name);
          return { entry, local, remote, ahead: remote === null || compare(local, remote) > 0 };
        });
        const behind = releases.find(
          (release) => release.remote && compare(release.local, release.remote) < 0,
        );
        if (behind) {
          console.log(
            `⚠ ${behind.entry.name} local ${behind.local} is behind npm ${behind.remote} — pull first, skipping`,
          );
          skip(checkout);
          continue;
        }
        const moving = movesOf(checkout);
        if (pendingAdoption(checkout, moving)) continue;
        const { inspection, bumped, staleLock } = bumpRanges(checkout);
        const relocked = bumped || staleLock || releases.some((release) => release.ahead);
        try {
          if (relocked) relockAndCheck(checkout);
          if (commitOwned(checkout, inspection.packagePaths, relocked)) committed.add(checkout.dir);
        } catch (error) {
          if (!(error instanceof Abort)) throw error;
          restore(checkout, inspection.packagePaths);
          if (!(error instanceof CheckFailed) || moving.length === 0) throw error;
          // It fails against the candidates: it adopts them on a branch, and the lane goes on.
          console.log(`✗ ${error.message} against the candidates — it adopts them on a branch`);
          adopt(checkout, moving);
          continue;
        }
        followers.push({ checkout, onBranch: false });

        for (const { entry, local, remote, ahead } of releases) {
          if (ahead) {
            publish(checkout, entry, local, remote);
          } else if (section[entry.name] === local) {
            console.log(`✓ ${entry.name}@${local} already on npm and blessed`);
            continue;
          } else if (manifest.candidates?.[entry.name] === local) {
            console.log(`✓ ${entry.name}@${local} already on npm and a candidate`);
            continue;
          } else {
            // Published outside the train, or by a train whose lane later failed.
            console.log(`✓ ${entry.name}@${local} already on npm — recording it as a candidate`);
          }
          manifest.candidates = { ...manifest.candidates, [entry.name]: local };
          laneRecorded.push(`${entry.name}@${local}`);
        }
      }
      recorded.push(...laneRecorded);
      console.log(
        `${lane} lane candidates: ${laneRecorded.length === 0 ? 'nothing new' : laneRecorded.join(', ')}`,
      );
    } catch (error) {
      if (!(error instanceof Abort)) throw error;
      for (const name of Object.keys(section)) delete section[name];
      Object.assign(section, before);
      manifest.candidates = candidatesBefore;
      failedLanes.add(lane);
      failed.push(`${lane} lane`);
      console.error(`✗ ${error.message} — ${lane} lane stopped; its BOM entries are unchanged`);
      if (laneRecorded.length > 0) {
        console.error(
          `  published but not recorded: ${laneRecorded.join(', ')} — the next train records them`,
        );
      }
    }
  }

  // Consumers publish nothing. They follow every blessed set and its candidates, after all
  // lanes, and their changes go through review on a branch: the checkout itself stays on main.
  if (plan.consumers.length > 0 || plan.missingConsumers.length > 0) {
    console.log(
      `\n═ consumers: ${plan.consumers.map((checkout) => checkout.name).join(' → ') || '(none)'}`,
    );
  }
  for (const repo of plan.missingConsumers) {
    console.error(`✗ no checkout under ${dir} for consumer ${repo}`);
    failed.push(repo);
  }
  for (const entry of plan.ambiguousConsumers) {
    console.error(`✗ ambiguous checkouts for consumer ${entry.key}: ${entry.dirs.join(', ')}`);
    failed.push(entry.key);
  }
  for (const checkout of plan.consumers) {
    console.log(`\n▸ ${checkout.name} — ${checkout.dir} (${laneLabel(checkout)})`);
    if (!ready(checkout)) {
      skip(checkout);
      continue;
    }
    const moving = movesOf(checkout);
    if (pendingAdoption(checkout, moving)) continue;
    const { inspection, bumped, staleLock } = bumpRanges(checkout);
    if (!bumped && !staleLock) {
      console.log('✓ already on the blessed set');
      continue;
    }
    try {
      relockAndCheck(checkout);
      reviewBranch(checkout, inspection.packagePaths);
    } catch (error) {
      if (!(error instanceof Abort)) throw error;
      restore(checkout, inspection.packagePaths);
      if (error instanceof CheckFailed && moving.length > 0) {
        console.log(`✗ ${error.message} against the candidates — it adopts them on a branch`);
        adopt(checkout, moving);
        continue;
      }
      failed.push(checkout.name);
      held.push({ name: checkout.name, moving });
      console.error(`✗ ${error.message} — its checkout is back on its default branch`);
    }
  }

  // A candidate is blessed once no dependent still has to adopt it: every repo that uses it
  // passed its check against it, here or in an adoption PR that has since merged.
  const waiting = new Set([...adoptions, ...held].flatMap((entry) => entry.moving));
  const promotable = Object.keys(manifest.candidates ?? {}).filter((name) => {
    const lane = laneOf(manifest, name);
    return !!lane && lanes.includes(lane) && !failedLanes.has(lane) && !waiting.has(name);
  });
  const promoted = promoteCandidates(manifest, promotable);
  const bomDirty = recorded.length > 0 || promoted.length > 0;
  if (bomDirty) {
    effect('write the candidates and blessings to versions.json', undefined, () =>
      writeManifest(manifest),
    );
  }

  console.log(`\nblessed: ${promoted.length === 0 ? 'nothing' : promoted.join(', ')}`);
  const candidates = Object.entries(manifest.candidates ?? {});
  if (candidates.length > 0) {
    console.log('candidates (check accepts them; not yet blessed):');
    for (const [name, version] of candidates) {
      const waitingOn = [
        ...adoptions
          .filter((adoption) => adoption.moving.includes(name))
          .map((adoption) => `${adoption.name} (${adoption.branch})`),
        ...held
          .filter((entry) => entry.moving.includes(name))
          .map((entry) => `${entry.name} (not verified this run)`),
      ];
      console.log(
        `  ${name}@${version}${waitingOn.length === 0 ? '' : ` — waiting on ${waitingOn.join(', ')}`}`,
      );
    }
  }
  if (adoptions.length > 0) {
    console.log('adoptions pending (merge each PR, then run the train again to bless):');
    for (const adoption of adoptions) {
      const url = adoption.opened || dryRun ? null : prUrl(adoption.dir, adoption.branch);
      console.log(
        `  ${adoption.name}: ${adoption.branch}${adoption.opened ? ' (opened this run)' : ''}${url ? ` ${url}` : ''}`,
      );
    }
  }
  if (skipped.length > 0) console.log(`skipped: ${skipped.join(', ')}`);
  if (failed.length > 0) console.log(`failed: ${failed.join(', ')}`);

  // The BOM names the new state, so this package ships last: its own version blessed in the
  // BOM, the fixtures following the blessed set, check, commit, publish. A version committed
  // ahead of npm is a release whose publish failed: ship it even when nothing new was blessed.
  const remoteVersion = npmLatest('@inixiative/config');
  const unpublished = remoteVersion !== null && compare(ownVersion(), remoteVersion) > 0;
  if (bomDirty || unpublished) {
    let version = ownVersion();
    if (remoteVersion !== null && compare(version, remoteVersion) <= 0) {
      version = bumpPatch(remoteVersion);
      const bumped = version;
      effect(`bump @inixiative/config to ${bumped} in package.json`, undefined, () => {
        const pkgPath = join(packageRoot, 'package.json');
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        pkg.version = bumped;
        writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
      });
    }
    manifest.ecosystem['@inixiative/config'] = version;
    effect(
      `bless @inixiative/config@${version} in versions.json and move test/fixtures onto the blessed set`,
      undefined,
      () => {
        writeManifest(manifest);
        for (const fixture of fixtureDirs()) {
          const inspection = inspect(fixture, manifest);
          for (const finding of inspection.findings)
            if (finding.kind === 'ecosystem-range') finding.fix?.();
          inspection.flush();
        }
      },
    );
    effect('run bun run check in @inixiative/config', undefined, () => {
      const check = spawnSync('bun', ['run', 'check'], { cwd: packageRoot, stdio: 'inherit' });
      if (check.status !== 0) {
        console.error('✗ check failed in @inixiative/config — aborting before publish');
        process.exit(1);
      }
    });
    const message = `chore: ${
      [
        promoted.length > 0 ? `bless ${promoted.join(', ')}` : '',
        recorded.length > 0 ? `candidate ${recorded.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('; ') || 'release'
    } — ${version}`;
    effect(`commit "${message}" in @inixiative/config`, undefined, () => {
      spawnSync('git', ['add', '--', 'package.json', 'versions.json', 'test/fixtures'], {
        cwd: packageRoot,
      });
      if (spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: packageRoot }).status === 0)
        return;
      const commit = spawnSync('git', ['commit', '-m', message], {
        cwd: packageRoot,
        stdio: 'inherit',
      });
      if (commit.status !== 0) {
        console.error('✗ commit failed in @inixiative/config — aborting before publish');
        process.exit(1);
      }
    });
    effect(`publish @inixiative/config@${version} to npm`, undefined, () => {
      const publish = spawnSync('npm', ['publish'], { cwd: packageRoot, stdio: 'inherit' });
      if (publish.status !== 0 || !servedByRegistry('@inixiative/config', version)) {
        console.error('✗ publish failed for @inixiative/config');
        process.exit(1);
      }
      console.log(`published: @inixiative/config@${version} — the BOM names the new state`);
    });
    committed.add(packageRoot);

    // Every checkout and branch this train re-locked still pins the previous @inixiative/config,
    // which `check` now reports as stale: bring each onto the release it just made. An adoption
    // branch needs it most — its CI accepts the candidates only through this release.
    if (followers.length > 0) console.log(`\n═ re-lock onto @inixiative/config@${version}`);
    for (const { checkout, onBranch } of followers) {
      try {
        const { inspection, bumped, staleLock } = bumpRanges(checkout);
        if (!bumped && !staleLock) continue;
        relockAndCheck(checkout, false);
        if (commitOwned(checkout, inspection.packagePaths, true) && !onBranch)
          committed.add(checkout.dir);
        if (!dryRun) console.log(`✓ ${checkout.name} locked to @inixiative/config@${version}`);
      } catch (error) {
        if (!(error instanceof Abort)) throw error;
        failed.push(checkout.name);
        console.error(`✗ ${error.message} — re-lock onto @inixiative/config@${version} by hand`);
      }
    }
  }

  if (dryRun) {
    console.log(
      `\ndry run complete — a real train would commit in ${committed.size} repo(s) and open ${reviewBranches.length} review branch(es)${commandLine.push ? ', then push them' : ''}:`,
    );
    for (const repoDir of committed) console.log(`  ${repoDir}`);
    for (const { dir: repoDir, branch } of reviewBranches) console.log(`  ${repoDir} (${branch})`);
  } else if (commandLine.push) {
    for (const repoDir of committed) {
      if (spawnSync('git', ['push'], { cwd: repoDir, stdio: 'inherit' }).status !== 0) {
        console.error(`✗ push failed in ${repoDir}`);
        process.exit(1);
      }
    }
    for (const { dir: repoDir, branch, base } of reviewBranches) {
      const push = spawnSync('git', ['push', '-u', 'origin', branch], {
        cwd: repoDir,
        stdio: 'inherit',
      });
      const pr =
        push.status === 0 &&
        spawnSync('gh', ['pr', 'create', '--fill', '--base', base, '--head', branch], {
          cwd: repoDir,
          stdio: 'inherit',
        }).status === 0;
      if (!pr) console.error(`✗ could not push ${branch} and open its PR in ${repoDir}`);
    }
    console.log(`pushed: ${committed.size + reviewBranches.length} repos`);
  } else if (committed.size > 0 || reviewBranches.length > 0) {
    console.log('train does not push without --push — review its commits, then push:');
    for (const repoDir of committed) console.log(`  git -C ${repoDir} push`);
    for (const { dir: repoDir, branch, base } of reviewBranches) {
      console.log(
        `  git -C ${repoDir} push -u origin ${branch} && (cd ${repoDir} && gh pr create --fill --base ${base})`,
      );
    }
  }
  process.exit(failed.length > 0 ? 1 : 0);
}

/** The open PR for `branch`, if gh can say. */
function prUrl(cwd: string, branch: string): string | null {
  const view = spawnSync('gh', ['pr', 'view', branch, '--json', 'url', '--jq', '.url'], {
    cwd,
    encoding: 'utf8',
  });
  return view.status === 0 ? view.stdout.trim() || null : null;
}

function currentBranch(cwd: string): string {
  return git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.trim();
}

/** `name`, or `name-2`, `name-3`… when a branch of that name already exists. */
function freeBranch(cwd: string, name: string): string {
  const taken = (candidate: string) =>
    git(cwd, 'rev-parse', '--verify', '--quiet', `refs/heads/${candidate}`).status === 0;
  let candidate = name;
  for (let n = 2; taken(candidate); n++) candidate = `${name}-${n}`;
  return candidate;
}

/** The registry can lag a publish by seconds; a version the train records must be one it serves. */
// npm now holds new versions for processing ("may take a few minutes") before serving them.
function servedByRegistry(name: string, version: string): boolean {
  const deadline = Date.now() + 15 * 60_000;
  while (true) {
    const view = spawnSync('npm', ['view', `${name}@${version}`, 'version', '--prefer-online'], {
      encoding: 'utf8',
    });
    if (view.status === 0 && view.stdout.trim() === version) return true;
    if (Date.now() >= deadline) return false;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10_000);
  }
}

function bumpPatch(version: string): string {
  const [major, minor, patch] = version.split('.').map(Number);
  return `${major}.${minor}.${(patch ?? 0) + 1}`;
}

/** Fixture packages under test/fixtures are consumers too; they follow the blessed set. */
function fixtureDirs(): string[] {
  const root = join(packageRoot, 'test', 'fixtures');
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((name) => join(root, name))
    .filter((dir) => existsSync(join(dir, 'package.json')));
}

if (existsSync(join(dir, '.git')) && !commandLine.force) {
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });
  if (status.status === 0 && status.stdout.trim().length > 0) {
    console.error('✗ working tree dirty — commit first or pass --force');
    process.exit(1);
  }
}

const first = inspect(dir, manifest, presetFlag);
for (const finding of first.findings) finding.fix?.();
first.flush();
const fixed = first.findings.filter((finding) => finding.fix).length;
if (fixed > 0) console.log(`applied ${fixed} fix${fixed === 1 ? '' : 'es'}`);

if (!commandLine.noInstall) {
  // A removed member toolchain range leaves its copy linked in the member's node_modules, and
  // neither `bun install` nor `--force` unlinks it; dropping the member's links makes bun relink.
  const relinked = new Set(
    first.findings.flatMap((finding) =>
      finding.kind === 'member-toolchain' && finding.path ? [dirname(finding.path)] : [],
    ),
  );
  for (const member of relinked) {
    rmSync(join(dir, member, 'node_modules'), { recursive: true, force: true });
  }
  const install = (...extra: string[]) => {
    if (spawnSync('bun', ['install', ...extra], { cwd: dir, stdio: 'inherit' }).status !== 0) {
      console.error('✗ bun install failed');
      process.exit(1);
    }
  };
  install();
  let installed = inspect(dir, manifest, presetFlag);
  if (installed.findings.some((finding) => finding.kind === 'toolchain-lock')) {
    install('--force');
    installed = inspect(dir, manifest, presetFlag);
  }
  for (const { cwd, names } of staleUpdates(dir, installed.findings)) {
    if (spawnSync('bun', ['update', ...names], { cwd, stdio: 'inherit' }).status !== 0) {
      console.error(`✗ bun update failed in ${cwd}`);
      process.exit(1);
    }
  }
}

const final = inspect(dir, manifest, presetFlag);
const remaining = final.findings.filter((finding) => finding.fix);
for (const finding of remaining) finding.fix?.();
final.flush();
const settled = remaining.length > 0 ? inspect(dir, manifest, presetFlag) : final;
process.exit(report(settled.findings) > 0 ? 1 : 0);
