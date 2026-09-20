import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  compare,
  discoverRepos,
  type Finding,
  inspect,
  loadManifest,
  missingRepos,
  ownVersion,
  type Preset,
  packageRoot,
  topoOrder,
  writeManifest,
} from './lib';

const args = process.argv.slice(2);
const command = args[0];
const flags = new Set(args.filter((arg) => arg.startsWith('--')).map((arg) => arg.split('=')[0]));
const presetFlag = args.find((arg) => arg.startsWith('--preset='))?.split('=')[1] as
  | Preset
  | undefined;
const positional = args.slice(1).filter((arg) => !arg.startsWith('--'));
const dir = resolve(positional[0] ?? '.');

const usage = () => {
  console.log(
    'Usage: inixiative-config <check|sync|scan|train> [dir] [--preset=base|node|react] [--force] [--no-install]',
  );
  process.exit(2);
};

if (!['check', 'sync', 'scan', 'train'].includes(command)) usage();
if (presetFlag && !['base', 'node', 'react'].includes(presetFlag)) usage();

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

if (command === 'scan') {
  const repos = discoverRepos(dir, manifest);
  if (repos.length === 0) {
    console.error(`✗ no ecosystem repos found under ${dir}`);
    process.exit(1);
  }
  const missing = missingRepos(repos, manifest);
  const drifted: string[] = [];
  for (const repo of repos) {
    console.log(`\n${repo.name} — ${repo.dir}`);
    const off = offDefaultBranch(repo.dir);
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
      ...staleCheckoutFindings(repo.dir),
      ...inspect(repo.dir, manifest).findings,
    ];
    if (report(findings) > 0) drifted.push(repo.name);
    for (const branch of unmergedSessionBranches(repo.dir)) {
      console.log(`⚠ unmerged session branch: ${branch}`);
    }
  }
  if (missing.length > 0) console.error(`\n✗ no checkout found for: ${missing.join(', ')}`);
  console.log(
    `\nscanned ${repos.length} repos: ${drifted.length === 0 ? 'all in sync' : `${drifted.length} drifted (${drifted.join(', ')})`}${missing.length > 0 ? `, ${missing.length} missing` : ''}`,
  );
  process.exit(drifted.length > 0 || missing.length > 0 ? 1 : 0);
}

if (command === 'train') {
  const order = topoOrder(dir, manifest);
  if (order.length === 0) {
    console.error(`✗ no ecosystem repos found under ${dir}`);
    process.exit(1);
  }
  const missing = missingRepos(order, manifest);
  if (missing.length > 0) {
    console.error(
      `✗ no checkout under ${dir} for: ${missing.join(', ')} — a partial train ships an incoherent set`,
    );
    process.exit(1);
  }
  git(packageRoot, 'fetch', '--quiet');
  if (behindOrigin(packageRoot) > 0) {
    console.error('✗ this config checkout is behind origin — its blessed set is stale; pull first');
    process.exit(1);
  }
  console.log(`train order: ${order.map((repo) => repo.name).join(' → ')}`);
  const published: string[] = [];
  const skipped: string[] = [];
  const committed: string[] = [];
  let bomDirty = false;

  for (const repo of order) {
    console.log(`\n▸ ${repo.name} — ${repo.dir}`);
    const porcelain = spawnSync('git', ['status', '--porcelain'], {
      cwd: repo.dir,
      encoding: 'utf8',
    });
    if (porcelain.status !== 0) {
      console.log('⚠ not a git checkout — skipping');
      skipped.push(repo.name);
      continue;
    }
    const off = offDefaultBranch(repo.dir);
    if (off) {
      console.log(
        `⚠ on ${off.branch}, not ${off.main} — the train only ships the default branch, skipping`,
      );
      skipped.push(repo.name);
      continue;
    }
    if (porcelain.stdout.trim().length > 0) {
      console.log('⚠ dirty working tree — commit or stash your work first, skipping');
      skipped.push(repo.name);
      continue;
    }
    git(repo.dir, 'fetch', '--quiet');
    for (const branch of unmergedSessionBranches(repo.dir)) {
      console.log(`⚠ unmerged session branch: ${branch} — a bump may be hiding there`);
    }
    const behind = behindOrigin(repo.dir);
    if (behind > 0) {
      const localOnly = git(repo.dir, 'rev-list', '--count', '@{upstream}..HEAD');
      if (localOnly.status === 0 && Number(localOnly.stdout.trim()) > 0) {
        console.log('⚠ diverged from origin — reconcile first, skipping');
        skipped.push(repo.name);
        continue;
      }
      const ff = git(repo.dir, 'merge', '--ff-only', '@{upstream}');
      if (ff.status !== 0) {
        console.log('⚠ fast-forward to origin failed — reconcile first, skipping');
        skipped.push(repo.name);
        continue;
      }
      console.log(`↓ fast-forwarded to origin (+${behind})`);
      repo.pkg = JSON.parse(readFileSync(join(repo.dir, 'package.json'), 'utf8'));
    }

    const inspection = inspect(repo.dir, manifest);
    const bumps = inspection.findings.filter((finding) => finding.kind === 'ecosystem-range');
    for (const bump of bumps) {
      console.log(`  ${bump.message}`);
      bump.fix?.();
    }
    inspection.flush();
    const bumped = bumps.length > 0;
    const staleLock = inspection.findings.some((finding) => finding.kind === 'stale-lock');

    const remote = spawnSync('npm', ['view', `${repo.name}@latest`, 'version'], {
      encoding: 'utf8',
    });
    const remoteVersion = remote.status === 0 ? remote.stdout.trim() : null;
    const localVersion = repo.pkg.version ?? '0.0.0';
    const ahead = remoteVersion === null || compare(localVersion, remoteVersion) > 0;
    if (remoteVersion && compare(localVersion, remoteVersion) < 0) {
      console.log(`⚠ local ${localVersion} is behind npm ${remoteVersion} — pull first, skipping`);
      skipped.push(repo.name);
      continue;
    }

    if (bumped || ahead || staleLock) {
      const install = spawnSync('bun', ['install'], { cwd: repo.dir, stdio: 'inherit' });
      if (install.status !== 0) {
        console.error('✗ bun install failed — aborting train');
        process.exit(1);
      }
      const stale = inspect(repo.dir, manifest)
        .findings.filter((finding) => finding.kind === 'stale-lock' && finding.name)
        .map((finding) => finding.name as string);
      if (stale.length > 0) {
        spawnSync('bun', ['update', ...new Set(stale)], { cwd: repo.dir, stdio: 'inherit' });
      }
      const check = spawnSync('bun', ['run', 'check'], { cwd: repo.dir, stdio: 'inherit' });
      if (check.status !== 0) {
        console.error(`✗ check failed in ${repo.name} — aborting train`);
        process.exit(1);
      }
    }

    // Stage exactly what the inspection owns — root package.json plus every
    // workspace member — so a bump written into packages/* cannot be left out of
    // the commit and silently un-released.
    const tracked = [...inspection.packagePaths, 'bun.lock'];
    const mutated = spawnSync('git', ['status', '--porcelain', '--', ...tracked], {
      cwd: repo.dir,
      encoding: 'utf8',
    });
    if (mutated.status === 0 && mutated.stdout.trim().length > 0) {
      spawnSync('git', ['add', '--', ...tracked], { cwd: repo.dir });
      const commit = spawnSync(
        'git',
        ['commit', '-m', 'chore: sync ecosystem deps to blessed set'],
        { cwd: repo.dir, stdio: 'inherit' },
      );
      if (commit.status !== 0) {
        console.error(`✗ commit failed in ${repo.name} — aborting train`);
        process.exit(1);
      }
      committed.push(repo.dir);
    }

    if (ahead) {
      console.log(`publishing ${repo.name}@${localVersion} (npm has ${remoteVersion ?? 'none'})`);
      const publish = spawnSync('npm', ['publish'], { cwd: repo.dir, stdio: 'inherit' });
      if (publish.status !== 0) {
        console.error(`✗ publish failed for ${repo.name} — aborting train`);
        process.exit(1);
      }
      if (!servedByRegistry(repo.name, localVersion)) {
        console.error(
          `✗ npm accepted ${repo.name}@${localVersion} but the registry does not serve it — aborting train`,
        );
        process.exit(1);
      }
      committed.push(repo.dir);
      manifest.ecosystem[repo.name] = localVersion;
      writeManifest(manifest);
      bomDirty = true;
      published.push(`${repo.name}@${localVersion}`);
    } else {
      console.log(`✓ ${repo.name}@${localVersion} already on npm`);
    }
  }

  console.log(`\npublished: ${published.length === 0 ? 'nothing' : published.join(', ')}`);
  if (skipped.length > 0) console.log(`skipped: ${skipped.join(', ')}`);

  // The BOM names the new state, so this package ships last: its own version blessed in the
  // BOM, the fixtures following the blessed set, check, commit, publish.
  if (bomDirty) {
    const remote = spawnSync('npm', ['view', '@inixiative/config@latest', 'version'], {
      encoding: 'utf8',
    });
    const remoteVersion = remote.status === 0 ? remote.stdout.trim() : null;
    let version = ownVersion();
    if (remoteVersion !== null && compare(version, remoteVersion) <= 0) {
      version = bumpPatch(remoteVersion);
      const pkgPath = join(packageRoot, 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      pkg.version = version;
      writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    }
    manifest.ecosystem['@inixiative/config'] = version;
    writeManifest(manifest);
    for (const fixture of fixtureDirs()) {
      const inspection = inspect(fixture, manifest);
      for (const finding of inspection.findings)
        if (finding.kind === 'ecosystem-range') finding.fix?.();
      inspection.flush();
    }
    const check = spawnSync('bun', ['run', 'check'], { cwd: packageRoot, stdio: 'inherit' });
    if (check.status !== 0) {
      console.error('✗ check failed in @inixiative/config — aborting before publish');
      process.exit(1);
    }
    spawnSync('git', ['add', '--', 'package.json', 'versions.json', 'test/fixtures'], {
      cwd: packageRoot,
    });
    const commit = spawnSync(
      'git',
      ['commit', '-m', `chore: bless ${published.join(', ')} — ${version}`],
      {
        cwd: packageRoot,
        stdio: 'inherit',
      },
    );
    if (commit.status !== 0) {
      console.error('✗ commit failed in @inixiative/config — aborting before publish');
      process.exit(1);
    }
    const publish = spawnSync('npm', ['publish'], { cwd: packageRoot, stdio: 'inherit' });
    if (publish.status !== 0 || !servedByRegistry('@inixiative/config', version)) {
      console.error('✗ publish failed for @inixiative/config');
      process.exit(1);
    }
    committed.push(packageRoot);
    console.log(`published: @inixiative/config@${version} — the BOM names the new state`);
  }

  if (flags.has('--push')) {
    for (const repoDir of committed) {
      const push = spawnSync('git', ['push'], { cwd: repoDir, stdio: 'inherit' });
      if (push.status !== 0) {
        console.error(`✗ push failed in ${repoDir}`);
        process.exit(1);
      }
    }
    console.log(`pushed: ${committed.length} repo${committed.length === 1 ? '' : 's'}`);
  } else if (committed.length > 0) {
    console.log('train does not push without --push — review its commits, then push:');
    for (const repoDir of committed) console.log(`  git -C ${repoDir} push`);
  }
  process.exit(0);
}

/** The registry can lag a publish by seconds; a version the train records must be one it serves. */
function servedByRegistry(name: string, version: string): boolean {
  for (let attempt = 0; attempt < 10; attempt++) {
    const view = spawnSync('npm', ['view', `${name}@${version}`, 'version'], { encoding: 'utf8' });
    if (view.status === 0 && view.stdout.trim() === version) return true;
    Bun.sleepSync(3000);
  }
  return false;
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

if (existsSync(join(dir, '.git')) && !flags.has('--force')) {
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

if (!flags.has('--no-install')) {
  const install = spawnSync('bun', ['install'], { cwd: dir, stdio: 'inherit' });
  if (install.status !== 0) {
    console.error('✗ bun install failed');
    process.exit(1);
  }
  const stale = inspect(dir, manifest, presetFlag)
    .findings.filter((finding) => finding.kind === 'stale-lock' && finding.name)
    .map((finding) => finding.name as string);
  if (stale.length > 0) {
    const update = spawnSync('bun', ['update', ...new Set(stale)], { cwd: dir, stdio: 'inherit' });
    if (update.status !== 0) {
      console.error('✗ bun update failed');
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
