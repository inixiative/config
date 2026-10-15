import { describe, expect, test } from 'bun:test';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseCommandLine, UsageError } from '../src/args';
import { loadManifest, packageRoot } from '../src/lib';

const manifest = loadManifest();
const cli = join(import.meta.dir, '..', 'src', 'cli.ts');

const write = (path: string, body: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`);
};

const run = (cwd: string, ...command: string[]) => {
  const result = Bun.spawnSync(command, { cwd, stdout: 'pipe', stderr: 'pipe' });
  return { status: result.exitCode, stdout: result.stdout.toString().trim() };
};

const realGit = Bun.which('git') ?? 'git';

/** A committed repo on `main`; `repo` adds a GitHub origin, as consumers are found by it. */
const repo = (dir: string, files: Record<string, unknown>, origin?: string) => {
  for (const [path, body] of Object.entries(files)) write(join(dir, path), body);
  run(dir, realGit, 'init', '-q', '-b', 'main');
  if (origin) run(dir, realGit, 'remote', 'add', 'origin', `git@github.com:${origin}.git`);
  run(dir, realGit, 'add', '-A');
  run(dir, realGit, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
};

/**
 * The agentic lane plus its consumers, every package ahead of npm and every consumer pinned to
 * an old range: a real train would publish, bump, re-lock, commit and branch in each.
 */
const agenticRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'inixiative-train-'));
  const next = (name: string) => {
    const [major, minor] = (manifest.agentic?.[name] ?? '0.0.0').split('.');
    return `${major}.${Number(minor) + 1}.0`;
  };
  const pkg = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    version: next(name),
    ...extra,
  });
  repo(join(root, 'signet'), { 'package.json': pkg('@inixiative/signet') });
  repo(join(root, 'archive'), { 'package.json': pkg('@inixiative/archive') });
  repo(join(root, 'agent-session'), { 'package.json': pkg('@inixiative/agent-session') });
  repo(join(root, 'foundry'), {
    'package.json': {
      name: '@inixiative/foundry-monorepo',
      private: true,
      workspaces: ['packages/*'],
    },
    'packages/core/package.json': pkg('@inixiative/foundry-core'),
    'packages/foundry/package.json': pkg('@inixiative/foundry', {
      dependencies: { '@inixiative/foundry-core': 'workspace:*' },
    }),
    'packages/acp/package.json': pkg('@inixiative/foundry-acp', {
      dependencies: { '@inixiative/foundry': 'workspace:*' },
    }),
  });
  const consumer = { dependencies: { '@inixiative/signet': '^0.0.1' } };
  repo(
    join(root, 'kingdom'),
    { 'package.json': { name: 'kingdom', private: true, ...consumer } },
    'inixiative/kingdom',
  );
  repo(
    join(root, 'oracle'),
    { 'package.json': { name: 'oracle', private: true, ...consumer } },
    'inixiative/oracle',
  );
  repo(
    join(root, 'template'),
    { 'package.json': { name: 'template', private: true } },
    'inixiative/template',
  );
  return root;
};

/**
 * Every process the train can reach for side effects — npm, bun, git, gh — is shimmed on PATH
 * and logged. git's read-only calls pass through to the real binary; fetch is a no-op so the
 * test never touches the network.
 */
const shimmedPath = (): { path: string; log: string } => {
  const bin = mkdtempSync(join(tmpdir(), 'inixiative-train-bin-'));
  const log = join(bin, 'calls.log');
  writeFileSync(log, '');
  const shim = (name: string, body: string) => {
    write(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  shim('npm', 'exit 1');
  shim('gh', 'exit 1');
  shim('bun', 'exit 1');
  shim('git', `if [ "$1" = fetch ]; then exit 0; fi\nexec "${realGit}" "$@"`);
  return { path: `${bin}:${process.env.PATH}`, log };
};

const train = (...args: string[]) => {
  const { path, log } = shimmedPath();
  const result = Bun.spawnSync([process.execPath, cli, 'train', ...args], {
    env: { ...process.env, PATH: path },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    status: result.exitCode,
    out: `${result.stdout.toString()}${result.stderr.toString()}`,
    calls: readFileSync(log, 'utf8').split('\n').filter(Boolean),
  };
};

const snapshot = (dirs: string[]) =>
  dirs.map((dir) => ({
    dir,
    head: run(dir, realGit, 'rev-parse', 'HEAD').stdout,
    branch: run(dir, realGit, 'rev-parse', '--abbrev-ref', 'HEAD').stdout,
    status: run(dir, realGit, 'status', '--porcelain').stdout,
  }));

describe('train --dry-run', () => {
  test('plans the release without installing, writing, committing, publishing or pushing', () => {
    const root = agenticRoot();
    const repos = ['signet', 'archive', 'agent-session', 'foundry', 'kingdom', 'oracle'].map(
      (name) => join(root, name),
    );
    const own = ['versions.json', 'package.json'].map((file) => join(packageRoot, file));
    const before = snapshot(repos);
    const ownBefore = own.map((file) => readFileSync(file, 'utf8'));

    const { out, calls } = train(root, '--lane=agentic', '--dry-run', '--push');

    expect(out).toContain('dry run: nothing is installed, written, committed, published or pushed');
    expect(out).toContain(`would publish @inixiative/signet@`);
    expect(out).toContain(`would publish @inixiative/foundry@`);
    expect(out).toContain('would re-lock kingdom and run its check');
    expect(out).toContain('would create review branch train/adopt-signet-');
    expect(out).toContain('would publish @inixiative/config@');
    expect(out).toContain('dry run complete');

    const mutating = calls.filter((call) =>
      /^(npm publish|npm pack|bun |gh |git (commit|add|push|merge|switch|checkout|reset|stash))/.test(
        call,
      ),
    );
    expect(mutating).toEqual([]);
    expect(snapshot(repos)).toEqual(before);
    expect(own.map((file) => readFileSync(file, 'utf8'))).toEqual(ownBefore);
  }, 30_000);

  test('an unknown flag stops the train before it touches anything', () => {
    const root = agenticRoot();
    const { status, out, calls } = train(root, '--lane=agentic', '--dryrun');
    expect(status).toBe(2);
    expect(out).toContain("Unknown option '--dryrun'");
    expect(calls).toEqual([]);
  });
});

/**
 * A whole train, for real but offline: a throwaway config clone (its own versions.json, its own
 * lock under a throwaway HOME), npm shimmed onto a registry directory, bun shimmed so a repo's
 * check fails while it carries `needs-adopt` and lacks `adopted` (which its `train:adopt` writes).
 */
const offlineTrain = () => {
  const base = mkdtempSync(join(tmpdir(), 'inixiative-two-phase-'));
  const config = join(base, 'config');
  for (const file of readdirSync(join(packageRoot, 'src')))
    write(join(config, 'src', file), readFileSync(join(packageRoot, 'src', file), 'utf8'));
  copyFileSync(join(packageRoot, 'ports.json'), join(config, 'ports.json'));
  write(join(config, 'test', 'fixtures', '.gitkeep'), '');
  write(join(config, 'package.json'), { name: '@inixiative/config', version: '1.0.0' });
  write(join(config, 'versions.json'), {
    bun: manifest.bun,
    toolchain: manifest.toolchain,
    required: manifest.required,
    ecosystem: { '@inixiative/config': '1.0.0' },
    agentic: { '@inixiative/archive': '0.18.0', '@inixiative/foundry': '0.5.0' },
    consumers: { 'inixiative/oracle': { lanes: ['agentic'] } },
  });
  repo(config, {}, 'inixiative/config');

  const root = join(base, 'repos');
  const archive = { name: '@inixiative/archive', version: '0.19.0' };
  repo(join(root, 'archive'), { 'package.json': archive });
  repo(join(root, 'foundry'), {
    'package.json': {
      name: '@inixiative/foundry',
      version: '0.5.0',
      // Its own worktree tooling, as template-based repos have; the shimmed bun stands in for it.
      scripts: {
        'train:adopt': 'bun run test:live',
        'worktree:create': './scripts/worktree/create.sh',
        'worktree:destroy': './scripts/worktree/destroy.sh',
      },
      dependencies: { '@inixiative/archive': '^0.18.0' },
    },
    'needs-adopt': '',
    '.gitignore': '.env*\n.worktrees/\n',
    // Ignored, so git leaves it out of a worktree; the adoption still needs it.
    'apps/api/.env.local': 'SECRET=1\n',
  });
  repo(
    join(root, 'oracle'),
    {
      'package.json': {
        name: 'oracle',
        private: true,
        dependencies: { '@inixiative/archive': '^0.18.0' },
      },
    },
    'inixiative/oracle',
  );

  const registry = join(base, 'registry');
  const published = (name: string, ...versions: string[]) =>
    write(join(registry, name.replace('/', '_')), `${versions.join('\n')}\n`);
  published('@inixiative/config', '1.0.0');
  published('@inixiative/archive', '0.18.0');
  published('@inixiative/foundry', '0.5.0');

  const bin = join(base, 'bin');
  const log = join(base, 'calls.log');
  writeFileSync(log, '');
  const shim = (name: string, body: string) => {
    write(join(bin, name), `#!/bin/sh\necho "${name} $* (in $PWD)" >> "${log}"\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  shim(
    'npm',
    `case "$1" in
view) spec="$2"; name="\${spec%@*}"; version="\${spec##*@}"; file="${registry}/$(echo "$name" | tr / _)"
  [ -f "$file" ] || exit 1
  if [ "$version" = latest ]; then tail -n 1 "$file"; else grep -qx "$version" "$file" && echo "$version" || exit 1; fi ;;
publish) set -- $("${process.execPath}" -e 'const p = require(process.cwd() + "/package.json"); console.log(p.name, p.version)')
  echo "$2" >> "${registry}/$(echo "$1" | tr / _)" ;;
*) exit 1 ;;
esac`,
  );
  shim(
    'bun',
    `case "$1 $2" in
"run check") [ -f needs-adopt ] && [ ! -f adopted ] && { touch generated.txt; exit 1; }; exit 0 ;;
"run train:adopt") [ -f apps/api/.env.local ] && touch adopted ;;
"run worktree:create") exec "${realGit}" worktree add -q -b "$4" ".worktrees/$(echo "$4" | tr / -)" "$3" ;;
"run worktree:destroy") exec "${realGit}" worktree remove --force ".worktrees/$3" ;;
esac
exit 0`,
  );
  shim('gh', 'exit 1');
  shim('git', `if [ "$1" = fetch ]; then exit 0; fi\nexec "${realGit}" "$@"`);

  const train = () => {
    const result = Bun.spawnSync(
      [process.execPath, join(config, 'src', 'cli.ts'), 'train', root, '--lane=agentic'],
      {
        env: {
          ...process.env,
          HOME: base,
          PATH: `${bin}:${process.env.PATH}`,
          GIT_AUTHOR_NAME: 't',
          GIT_AUTHOR_EMAIL: 't@t',
          GIT_COMMITTER_NAME: 't',
          GIT_COMMITTER_EMAIL: 't@t',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    return { status: result.exitCode, out: `${result.stdout}${result.stderr}` };
  };
  const bom = () => JSON.parse(readFileSync(join(config, 'versions.json'), 'utf8'));
  const at = (name: string) => join(root, name);
  const calls = () => readFileSync(log, 'utf8');
  return { train, bom, at, config, registry, log, calls };
};

const gitOut = (dir: string, ...args: string[]) => run(dir, realGit, ...args).stdout;

describe('two-phase blessing', () => {
  test('candidate → adoption PR → promoted once it merges', () => {
    const { train, bom, at, config, registry, calls } = offlineTrain();

    // Run 1: archive 0.19.0 publishes and becomes a candidate. Foundry's check fails against it
    // (and litters its tree), so the train opens an adoption branch instead of stopping. Oracle
    // passes, but its main stays on 0.18.0 until its branch merges, so that branch is an adoption
    // too. Nothing is blessed yet; config ships a release that carries the candidate.
    const first = train();
    expect(first.status).toBe(0);
    expect(first.out).toContain('against the candidates — it adopts them on a branch');
    expect(first.out).toContain('blessed: nothing');
    expect(first.out).toContain(
      '@inixiative/archive@0.19.0 — waiting on @inixiative/foundry (train/adopt-archive-0.19.0), oracle (train/adopt-archive-0.19.0)',
    );
    expect(first.out).toContain(
      '@inixiative/foundry: train/adopt-archive-0.19.0 — opened this run',
    );
    expect(bom().agentic['@inixiative/archive']).toBe('0.18.0');
    expect(bom().candidates).toEqual({ '@inixiative/archive': '0.19.0' });
    expect(bom().ecosystem['@inixiative/config']).toBe('1.0.1');
    expect(readFileSync(join(registry, '@inixiative_config'), 'utf8')).toContain('1.0.1');
    expect(gitOut(config, 'log', '-1', '--format=%s')).toBe(
      'chore: candidate @inixiative/archive@0.19.0 — 1.0.1',
    );

    // Every checkout is left on main and clean; the work sits on branches.
    for (const name of ['archive', 'foundry', 'oracle']) {
      expect(gitOut(at(name), 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
      expect(gitOut(at(name), 'status', '--porcelain')).toBe('');
      expect(gitOut(at(name), 'worktree', 'list').split('\n')).toHaveLength(1);
    }
    const foundryMain = JSON.parse(readFileSync(join(at('foundry'), 'package.json'), 'utf8'));
    expect(foundryMain.dependencies['@inixiative/archive']).toBe('^0.18.0');
    const adoption = 'train/adopt-archive-0.19.0';
    for (const name of ['foundry', 'oracle']) {
      expect(gitOut(at(name), 'show', `${adoption}:package.json`)).toContain('"^0.19.0"');
      expect(gitOut(at(name), 'log', '-1', '--format=%s', adoption)).toBe(
        'chore: adopt @inixiative/archive@0.19.0',
      );
    }
    // Foundry's adoption came from its own worktree tooling, destroyed the same way; oracle has
    // none, so it got a plain linked worktree.
    expect(calls()).toContain('bun run worktree:create main train/adopt-archive-0.19.0');
    expect(calls()).toContain('bun run worktree:destroy train-adopt-archive-0.19.0 --force');
    // train:adopt ran with the checkout's nested, ignored env file in place.
    expect(gitOut(at('foundry'), 'ls-tree', '--name-only', adoption)).toContain('adopted');

    // Run 2, nothing merged. Foundry's branch was pushed, oracle's never was: the train waits on
    // both, says which is which, and opens nothing new.
    run(at('foundry'), realGit, 'update-ref', `refs/remotes/origin/${adoption}`, adoption);
    const waiting = train();
    expect(waiting.out).toContain(
      '@inixiative/foundry: train/adopt-archive-0.19.0 — waiting for its PR to merge',
    );
    expect(waiting.out).toContain(
      'oracle: train/adopt-archive-0.19.0 — committed but never pushed',
    );
    expect(waiting.out).toContain('blessed: nothing');
    expect(bom().candidates).toEqual({ '@inixiative/archive': '0.19.0' });
    for (const name of ['foundry', 'oracle']) {
      expect(gitOut(at(name), 'branch', '--list', 'train/*').trim().split('\n')).toHaveLength(1);
    }

    // Both adoptions merge, but oracle is dirty, so this run cannot verify it: the candidate holds.
    run(at('foundry'), realGit, 'merge', '-q', '--ff-only', adoption);
    run(at('oracle'), realGit, 'merge', '-q', '--ff-only', adoption);
    write(join(at('oracle'), 'scratch.txt'), 'work in progress');
    const held = train();
    expect(held.out).toContain('dirty working tree — commit your work first, skipping');
    expect(held.out).toContain(
      '@inixiative/archive@0.19.0 — waiting on oracle (not verified this run)',
    );
    expect(bom().candidates).toEqual({ '@inixiative/archive': '0.19.0' });

    // Oracle is clean again; the next train promotes the candidate.
    rmSync(join(at('oracle'), 'scratch.txt'));
    const promoted = train();
    expect(promoted.status).toBe(0);
    expect(promoted.out).toContain('blessed: @inixiative/archive@0.19.0');
    expect(bom().agentic['@inixiative/archive']).toBe('0.19.0');
    expect(bom().candidates).toBeUndefined();
    expect(gitOut(config, 'log', '-1', '--format=%s')).toMatch(
      /^chore: bless @inixiative\/archive@0\.19\.0 — 1\.0\.\d+$/,
    );
  }, 90_000);

  test('an adoption its hooks reject leaves no branch behind and holds the candidate', () => {
    const { train, bom, at } = offlineTrain();
    write(join(at('foundry'), '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n');
    chmodSync(join(at('foundry'), '.git', 'hooks', 'pre-commit'), 0o755);
    const { out } = train();
    expect(out).toContain('its hooks reject the adoption');
    expect(out).toContain('@inixiative/foundry: the train could not commit it — adopt by hand');
    expect(bom().candidates).toEqual({ '@inixiative/archive': '0.19.0' });
    expect(gitOut(at('foundry'), 'branch', '--list', 'train/*')).toBe('');
    expect(gitOut(at('foundry'), 'status', '--porcelain')).toBe('');
    expect(gitOut(at('foundry'), 'worktree', 'list').split('\n')).toHaveLength(1);
  }, 30_000);
});

describe('parseCommandLine', () => {
  test('reads train flags', () => {
    expect(parseCommandLine(['train', '/root', '--lane=agentic', '--dry-run'])).toMatchObject({
      command: 'train',
      positionals: ['/root'],
      lane: 'agentic',
      dryRun: true,
      push: false,
    });
  });

  test('a flag belongs to its command only', () => {
    expect(() => parseCommandLine(['sync', '--push'])).toThrow(UsageError);
    expect(() => parseCommandLine(['check', '--dry-run'])).toThrow(UsageError);
    expect(() => parseCommandLine(['scan', '--force'])).toThrow(UsageError);
    expect(parseCommandLine(['sync', '--force', '--no-install'])).toMatchObject({
      force: true,
      noInstall: true,
    });
  });

  test('rejects unknown commands, lanes and presets', () => {
    expect(() => parseCommandLine(['publish'])).toThrow(UsageError);
    expect(() => parseCommandLine(['train', '--lane=everything'])).toThrow(UsageError);
    expect(() => parseCommandLine(['check', '--preset=vue'])).toThrow(UsageError);
  });

  test('a forgotten dash is an error, not a real train', () => {
    expect(() => parseCommandLine(['train', '/root', 'dry-run'])).toThrow(
      'unexpected argument dry-run — did you mean --dry-run?',
    );
    expect(() => parseCommandLine(['ports', 'a', 'b'])).toThrow(UsageError);
  });

  test('a flag given twice is an error', () => {
    expect(() =>
      parseCommandLine(['train', '/root', '--lane=agentic', '--lane=primitives']),
    ).toThrow('--lane given more than once');
  });
});
