import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  blessedVersions,
  consumersFor,
  discover,
  inspect,
  LANES,
  lanePackages,
  loadManifest,
  lockedVersion,
  type Manifest,
  missingFor,
  npmAlias,
  ownVersion,
  topoOrder,
  trainPlan,
} from '../src/lib';

const manifest = loadManifest();

/** A small BOM shaped like the real one, so these tests do not move when versions do. */
const bom = (): Manifest => ({
  bun: manifest.bun,
  toolchain: manifest.toolchain,
  required: manifest.required,
  ecosystem: {
    '@inixiative/config': '9.9.9',
    '@inixiative/json-rules': '2.25.0',
    '@inixiative/archive': '0.2.1',
  },
  agentic: {
    '@inixiative/agent-session': '0.2.0',
    '@inixiative/foundry-core': '0.1.0',
    '@inixiative/foundry': '0.1.0',
  },
  consumers: {
    'inixiative/template': { lanes: ['primitives'] },
    'inixiative/kingdom': { lanes: ['primitives', 'agentic'], upstream: 'inixiative/template' },
    'inixiative/oracle': { lanes: ['agentic'] },
  },
});

const write = (path: string, body: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`);
};

const git = (dir: string, ...args: string[]) =>
  Bun.spawnSync(['git', ...args], { cwd: dir, stdout: 'ignore', stderr: 'ignore' });

/** A primary clone whose origin is github.com/<repo>. */
const clone = (dir: string, repo: string, pkg: Record<string, unknown>) => {
  write(join(dir, 'package.json'), pkg);
  git(dir, 'init', '-q');
  git(dir, 'remote', 'add', 'origin', `git@github.com:${repo}.git`);
};

/**
 * The real layout in miniature: packages at the root, a monorepo publishing two members, the
 * app consumers one level down in a workspace folder, and the clutter that must be ignored.
 */
const ecosystemRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'inixiative-lanes-'));
  write(join(root, 'json-rules', 'package.json'), { name: '@inixiative/json-rules' });
  write(join(root, 'archive', 'package.json'), { name: '@inixiative/archive' });
  write(join(root, 'agent-session', 'package.json'), { name: '@inixiative/agent-session' });
  write(join(root, 'foundry', 'package.json'), {
    name: '@inixiative/foundry-monorepo',
    private: true,
    workspaces: ['packages/*'],
  });
  write(join(root, 'foundry', 'packages', 'foundry', 'package.json'), {
    name: '@inixiative/foundry',
    dependencies: {
      '@inixiative/foundry-core': 'workspace:*',
      '@inixiative/agent-session': '^0.2.0',
      '@inixiative/session-archive': 'npm:@inixiative/archive@^0.2.1',
    },
  });
  write(join(root, 'foundry', 'packages', 'core', 'package.json'), {
    name: '@inixiative/foundry-core',
  });
  // Another session's linked worktree of the same monorepo is never a candidate.
  write(join(root, 'foundry-feature', 'package.json'), {
    name: '@inixiative/foundry-monorepo',
    workspaces: ['packages/*'],
  });
  write(join(root, 'foundry-feature', 'packages', 'core', 'package.json'), {
    name: '@inixiative/foundry-core',
  });
  write(join(root, 'foundry-feature', '.git'), 'gitdir: /elsewhere/.git/worktrees/feature\n');
  clone(join(root, 'template'), 'inixiative/template', { name: 'template', private: true });
  clone(join(root, 'oracle'), 'inixiative/oracle', { name: '@inixiative/oracle', private: true });
  clone(join(root, 'kingdom-workspace', 'kingdom'), 'inixiative/kingdom', {
    name: 'kingdom',
    private: true,
  });
  // A handoff clone of agent-session without an origin loses to the one with an origin.
  write(join(root, 'kingdom-workspace', 'agent-session', 'package.json'), {
    name: '@inixiative/agent-session',
  });
  git(join(root, 'kingdom-workspace', 'agent-session'), 'init', '-q');
  git(join(root, 'agent-session'), 'init', '-q');
  git(
    join(root, 'agent-session'),
    'remote',
    'add',
    'origin',
    'git@github.com:inixiative/agent-session.git',
  );
  write(join(root, 'unrelated', 'package.json'), { name: 'something-else' });
  mkdirSync(join(root, 'no-pkg'));
  write(join(root, 'config', 'package.json'), { name: '@inixiative/config' });
  return root;
};

describe('the BOM', () => {
  test('blesses the current config version', () => {
    expect(manifest.ecosystem['@inixiative/config']).toBe(ownVersion());
  });

  test('lanes are disjoint and config belongs to none of them', () => {
    const seen = new Set<string>();
    for (const lane of LANES) {
      for (const name of Object.keys(lanePackages(manifest, lane))) {
        expect(seen.has(name)).toBe(false);
        seen.add(name);
      }
    }
    expect(seen.has('@inixiative/config')).toBe(false);
  });

  test('every consumer names real lanes and an upstream that is itself a consumer', () => {
    const consumers = manifest.consumers ?? {};
    expect(Object.keys(consumers).length).toBeGreaterThan(0);
    for (const consumer of Object.values(consumers)) {
      expect(consumer.lanes.length).toBeGreaterThan(0);
      for (const lane of consumer.lanes) expect(LANES).toContain(lane);
      if (consumer.upstream) expect(consumers).toHaveProperty(consumer.upstream);
    }
  });

  test('the blessed set spans every lane', () => {
    const all = blessedVersions(manifest);
    for (const lane of LANES) {
      for (const [name, version] of Object.entries(lanePackages(manifest, lane))) {
        expect(all[name]).toBe(version);
      }
    }
  });
});

describe('consumersFor', () => {
  test('a consumer of several lanes rides whichever lane runs', () => {
    expect(consumersFor(bom(), ['primitives'])).toEqual([
      'inixiative/template',
      'inixiative/kingdom',
    ]);
    expect(consumersFor(bom(), ['agentic'])).toEqual(['inixiative/kingdom', 'inixiative/oracle']);
  });

  test('runs each consumer once, upstreams before the repos that sync from them', () => {
    expect(consumersFor(bom(), LANES)).toEqual([
      'inixiative/template',
      'inixiative/kingdom',
      'inixiative/oracle',
    ]);
  });

  test('refuses an upstream cycle', () => {
    const cyclic = bom();
    cyclic.consumers = {
      'inixiative/a': { lanes: ['primitives'], upstream: 'inixiative/b' },
      'inixiative/b': { lanes: ['primitives'], upstream: 'inixiative/a' },
    };
    expect(() => consumersFor(cyclic, ['primitives'])).toThrow('cycle');
  });
});

describe('discover', () => {
  test('finds packages by name, including workspace members, and consumers by origin', () => {
    const root = ecosystemRoot();
    const { checkouts, ambiguous } = discover(root, bom());
    expect(ambiguous).toEqual([]);
    const byName = Object.fromEntries(checkouts.map((checkout) => [checkout.name, checkout]));
    expect(Object.keys(byName).sort()).toEqual([
      '@inixiative/agent-session',
      '@inixiative/archive',
      '@inixiative/foundry-monorepo',
      '@inixiative/json-rules',
      '@inixiative/oracle',
      'kingdom',
      'template',
    ]);
    expect(byName['@inixiative/json-rules'].lane).toBe('primitives');
    expect(byName['@inixiative/agent-session'].dir).toBe(join(root, 'agent-session'));
    const foundry = byName['@inixiative/foundry-monorepo'];
    expect(foundry.dir).toBe(join(root, 'foundry'));
    expect(foundry.lane).toBe('agentic');
    // core publishes before the package that depends on it
    expect(foundry.packages.map((entry) => entry.name)).toEqual([
      '@inixiative/foundry-core',
      '@inixiative/foundry',
    ]);
    expect(byName.kingdom.dir).toBe(join(root, 'kingdom-workspace', 'kingdom'));
    expect(byName.kingdom.consumer?.lanes).toEqual(['primitives', 'agentic']);
    expect(byName.kingdom.packages).toEqual([]);
  });

  test('a lane selection discovers only its packages and consumers', () => {
    const root = ecosystemRoot();
    const names = discover(root, bom(), ['primitives']).checkouts.map((checkout) => checkout.name);
    expect(names.sort()).toEqual([
      '@inixiative/archive',
      '@inixiative/json-rules',
      'kingdom',
      'template',
    ]);
  });

  test('two eligible checkouts of one package are ambiguous, not guessed', () => {
    const root = ecosystemRoot();
    clone(join(root, 'json-rules-copy'), 'inixiative/json-rules', {
      name: '@inixiative/json-rules',
    });
    clone(join(root, 'json-rules'), 'inixiative/json-rules', { name: '@inixiative/json-rules' });
    const { checkouts, ambiguous } = discover(root, bom());
    expect(ambiguous).toEqual([
      {
        key: '@inixiative/json-rules',
        dirs: [join(root, 'json-rules'), join(root, 'json-rules-copy')],
      },
    ]);
    expect(checkouts.map((checkout) => checkout.name)).not.toContain('@inixiative/json-rules');
  });

  test('names lane packages and consumers without a checkout', () => {
    const root = ecosystemRoot();
    const manifest = bom();
    manifest.ecosystem['@inixiative/gloss'] = '0.0.4';
    const { checkouts } = discover(root, manifest);
    expect(missingFor(checkouts, manifest)).toEqual(['@inixiative/gloss']);
    expect(missingFor([], manifest, ['agentic'])).toEqual([
      '@inixiative/agent-session',
      '@inixiative/foundry-core',
      '@inixiative/foundry',
      'inixiative/kingdom',
      'inixiative/oracle',
    ]);
  });
});

describe('topoOrder', () => {
  test('orders checkouts so dependencies publish before dependents', () => {
    const root = mkdtempSync(join(tmpdir(), 'inixiative-train-'));
    write(join(root, 'builder', 'package.json'), {
      name: '@inixiative/rules-builder',
      peerDependencies: { '@inixiative/json-rules': '^2.12.1' },
    });
    write(join(root, 'rules', 'package.json'), { name: '@inixiative/json-rules' });
    write(join(root, 'trans', 'package.json'), {
      name: '@inixiative/transitions',
      dependencies: { '@inixiative/permissions': '^0.3.0' },
    });
    write(join(root, 'perms', 'package.json'), { name: '@inixiative/permissions' });
    const primitives = bom();
    Object.assign(primitives.ecosystem, {
      '@inixiative/rules-builder': '0.28.0',
      '@inixiative/transitions': '0.1.0',
      '@inixiative/permissions': '0.3.2',
    });

    const order = topoOrder(discover(root, primitives).checkouts).map((entry) => entry.name);
    expect(order.indexOf('@inixiative/json-rules')).toBeLessThan(
      order.indexOf('@inixiative/rules-builder'),
    );
    expect(order.indexOf('@inixiative/permissions')).toBeLessThan(
      order.indexOf('@inixiative/transitions'),
    );
    expect(order).toHaveLength(4);
  });

  test('a monorepo waits for the checkouts its workspace members depend on', () => {
    const root = ecosystemRoot();
    const agentic = discover(root, bom(), ['agentic']).checkouts;
    expect(topoOrder(agentic).map((checkout) => checkout.name)).toEqual([
      '@inixiative/agent-session',
      '@inixiative/foundry-monorepo',
    ]);
  });
});

describe('trainPlan', () => {
  test('each lane stands alone; a gap in one never holds back the other', () => {
    const root = ecosystemRoot();
    const manifest = bom();
    manifest.ecosystem['@inixiative/gloss'] = '0.0.4';
    const plan = trainPlan(root, manifest);
    const [primitives, agentic] = plan.lanes;
    expect(primitives.lane).toBe('primitives');
    expect(primitives.missing).toEqual(['@inixiative/gloss']);
    expect(agentic.lane).toBe('agentic');
    expect(agentic.missing).toEqual([]);
    expect(agentic.checkouts.map((checkout) => checkout.name)).toEqual([
      '@inixiative/agent-session',
      '@inixiative/foundry-monorepo',
    ]);
  });

  test('consumers run once, after every selected lane, upstream first', () => {
    const root = ecosystemRoot();
    const both = trainPlan(root, bom());
    expect(both.consumers.map((checkout) => checkout.consumer?.repo)).toEqual([
      'inixiative/template',
      'inixiative/kingdom',
      'inixiative/oracle',
    ]);
    const agenticOnly = trainPlan(root, bom(), ['agentic']);
    expect(agenticOnly.lanes.map((lane) => lane.lane)).toEqual(['agentic']);
    expect(agenticOnly.consumers.map((checkout) => checkout.consumer?.repo)).toEqual([
      'inixiative/kingdom',
      'inixiative/oracle',
    ]);
    expect(agenticOnly.missingConsumers).toEqual([]);
  });
});

describe('ranges across lanes', () => {
  const consumer = (deps: Record<string, string>, lock?: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'inixiative-consumer-'));
    write(join(dir, 'package.json'), {
      name: 'app',
      private: true,
      workspaces: ['apps/*'],
    });
    write(join(dir, 'apps', 'api', 'package.json'), { name: 'api', dependencies: deps });
    if (lock) write(join(dir, 'bun.lock'), lock);
    return dir;
  };
  const rangeFindings = (dir: string, manifest: Manifest) =>
    inspect(dir, manifest).findings.filter(
      (finding) => finding.kind === 'ecosystem-range' || finding.kind === 'stale-lock',
    );

  test('an agentic range is held to the agentic lane and bumped like any other', () => {
    const dir = consumer({ '@inixiative/foundry-core': '^0.0.9' });
    const inspection = inspect(dir, bom());
    const bump = inspection.findings.find((finding) => finding.kind === 'ecosystem-range');
    expect(bump?.message).toContain('does not admit blessed 0.1.0');
    bump?.fix?.();
    inspection.flush();
    const api = JSON.parse(readFileSync(join(dir, 'apps', 'api', 'package.json'), 'utf8'));
    expect(api.dependencies['@inixiative/foundry-core']).toBe('^0.1.0');
  });

  test('workspace: ranges are the monorepo linking itself, never drift', () => {
    const dir = consumer({ '@inixiative/foundry-core': 'workspace:*' });
    expect(inspect(dir, bom()).findings.map((finding) => finding.message)).not.toContainEqual(
      expect.stringContaining('foundry-core'),
    );
  });

  test('an npm alias is checked against its target and rewritten as an alias', () => {
    const dir = consumer({ '@inixiative/session-archive': 'npm:@inixiative/archive@^0.1.0' });
    const inspection = inspect(dir, bom());
    const bump = inspection.findings.find((finding) => finding.kind === 'ecosystem-range');
    expect(bump?.message).toContain('does not admit blessed 0.2.1');
    bump?.fix?.();
    inspection.flush();
    const api = JSON.parse(readFileSync(join(dir, 'apps', 'api', 'package.json'), 'utf8'));
    expect(api.dependencies['@inixiative/session-archive']).toBe('npm:@inixiative/archive@^0.2.1');
    expect(rangeFindings(dir, bom())).toEqual([]);
  });

  test('stale locks are caught in workspace members, aliases included', () => {
    const lock = JSON.stringify({
      packages: {
        '@inixiative/session-archive': ['@inixiative/archive@0.2.0', '', {}, 'sha'],
        '@inixiative/agent-session': ['@inixiative/agent-session@0.2.0', '', {}, 'sha'],
      },
    });
    const dir = consumer(
      {
        '@inixiative/session-archive': 'npm:@inixiative/archive@^0.2.0',
        '@inixiative/agent-session': '^0.2.0',
      },
      lock,
    );
    const stale = rangeFindings(dir, bom());
    expect(stale.map((finding) => [finding.kind, finding.name])).toEqual([
      ['stale-lock', '@inixiative/session-archive'],
    ]);
    expect(stale[0].message).toContain('locked at 0.2.0, blessed is 0.2.1');
  });

  test('npmAlias and lockedVersion understand aliases', () => {
    expect(npmAlias('npm:@inixiative/archive@^0.2.1')).toEqual({
      name: '@inixiative/archive',
      range: '^0.2.1',
    });
    expect(npmAlias('npm:left-pad@1.0.0')).toEqual({ name: 'left-pad', range: '1.0.0' });
    expect(npmAlias('^0.2.1')).toBeNull();
    const lock = JSON.stringify({
      packages: { '@inixiative/session-archive': ['@inixiative/archive@0.2.1', '', {}, 'sha'] },
    });
    expect(lockedVersion(lock, '@inixiative/session-archive', '@inixiative/archive')).toBe('0.2.1');
    expect(lockedVersion(lock, '@inixiative/session-archive')).toBeNull();
  });
});
