import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { compareBaseline, readBaseline, writeBaseline } from './baseline';
import {
  cutDocUnits,
  type DocUnit,
  demote,
  normaliseNewlines,
  sourceLine,
  stripDoNotCopy,
} from './docUnits';
import type { Finding } from './lib';

/**
 * Region freshness: a Warden region's part 4 holds the doc sections it was built from, verbatim
 * (`region.json` `sources.docUnits`). Re-cut each one from the repo's doc today, with the builder's
 * own rule (`docUnits.ts`), and compare. A region whose copy differs, or whose doc section is gone,
 * is out of date and is rebuilt, never edited: regions are generated.
 */

/** Where the builder installs a repo's own regions, and Foundry's default chorus layer. */
export const OWN_REGIONS_DIR = '.foundry/regions';
const PROJECT_SETTINGS = '.foundry/project.json';
export const REGION_FRESHNESS_DIR = 'scripts/ci/region-freshness';
const BASELINE_FILE = `${REGION_FRESHNESS_DIR}/baseline.txt`;
const PART_4A = '\n### 4a. Doc sections\n';
const PART_4B = '\n### 4b. Code entries\n';
const UNIT_MARKER = /^<!-- unit (\S+) -->$/gm;

export type UnitState =
  | { unit: string; state: 'fresh' }
  | { unit: string; state: 'changed'; added: number; removed: number; first: string }
  | { unit: string; state: 'gone'; missing: 'file' | 'section' }
  /** The unit copies another repo's docs (a library the registry names). */
  | { unit: string; state: 'elsewhere'; library: string }
  /** `region.json` names the unit, but `knowledge.md` holds no copy of it. */
  | { unit: string; state: 'uncopied' };

export type RegionFreshness = {
  /** The region's directory, repo-relative: `<regions dir>/<id>`. */
  path: string;
  id: string;
  status: 'fresh' | 'stale' | 'unverifiable' | 'elsewhere';
  units: UnitState[];
  /** Why the region can't be compared at all. */
  unreadable?: string;
};

export type RegionLayer = {
  /** Repo-relative regions directory. */
  dir: string;
  /** Checked here: the repo's own regions. Other layers were built from another repo's docs. */
  own: boolean;
  /** `registry.json` `project`, when there is one. */
  project?: string;
  regions: number;
};

const readText = (abs: string): string | null => {
  try {
    return lstatSync(abs).isFile() ? normaliseNewlines(readFileSync(abs, 'utf8')) : null;
  } catch {
    return null;
  }
};

const readObject = (abs: string): Record<string, unknown> | null => {
  const text = readText(abs);
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Every regions directory the repo's chorus names (`chorus.layers`, else `chorus.regions`), plus its own. */
const layerDirs = (root: string): string[] => {
  const settings = readObject(join(root, PROJECT_SETTINGS));
  const chorus = isObject(settings?.chorus) ? settings.chorus : {};
  const named = Array.isArray(chorus.layers)
    ? chorus.layers.flatMap((layer) =>
        isObject(layer) && typeof layer.regions === 'string' ? [layer.regions] : [],
      )
    : typeof chorus.regions === 'string'
      ? [chorus.regions]
      : [];
  const dirs = named
    .map((dir) => relative(root, isAbsolute(dir) ? resolve(dir) : resolve(root, dir)))
    .filter((dir) => dir !== '' && !dir.startsWith('..'));
  return [...new Set([...dirs, OWN_REGIONS_DIR])];
};

/** Region directories under `dir` (each holding a `region.json`), sorted. */
const regionIds = (root: string, dir: string): string[] => {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(abs, entry.name, 'region.json')))
    .map((entry) => entry.name)
    .sort();
};

/** The registry's `builtFrom.libraries` names: doc units under `<name>/` or `@scope/<name>/` are another repo's. */
const librariesOf = (registry: Record<string, unknown> | null): string[] => {
  const builtFrom = isObject(registry?.builtFrom) ? registry.builtFrom : {};
  return isObject(builtFrom.libraries) ? Object.keys(builtFrom.libraries) : [];
};

const libraryOf = (path: string, libraries: string[]): string | undefined => {
  const unscoped = path.startsWith('@') ? path.slice(path.indexOf('/') + 1) : path;
  return libraries.find((name) => path.startsWith(`${name}/`) || unscoped.startsWith(`${name}/`));
};

const trimNewlines = (text: string): string => text.replace(/^\n+|\n+$/g, '');

/** Part 4a's copies, in order: each unit's id, its span in `knowledge`, and its body (source line and section). */
export const unitCopies = (
  knowledge: string,
): { unit: string; start: number; end: number; body: string }[] | null => {
  const start = knowledge.indexOf(PART_4A);
  if (start === -1) return null;
  const from = start + PART_4A.length;
  const last = knowledge.lastIndexOf(PART_4B);
  const to = last > start ? last : knowledge.length;
  const markers = [...knowledge.slice(from, to).matchAll(UNIT_MARKER)];
  return markers.map((marker, index) => {
    const end = from + (markers[index + 1]?.index ?? to - from);
    const bodyStart = from + marker.index + marker[0].length;
    return {
      unit: marker[1],
      start: from + marker.index,
      end,
      body: trimNewlines(knowledge.slice(bodyStart, end)),
    };
  });
};

/** The doc a unit id names: `doc:<path>#<anchor>`. */
export const unitPath = (unit: string): string | null => {
  const hash = unit.indexOf('#');
  return unit.startsWith('doc:') && hash > 4 ? unit.slice(4, hash) : null;
};

/** Part 4a's copies by unit id: the source line above each, and the section as shown. */
const copiesOf = (knowledge: string): Map<string, { source?: string; text: string }> | null => {
  const copies = unitCopies(knowledge);
  if (copies === null) return null;
  return new Map(
    copies.map(({ unit, body }) => {
      const [first, ...rest] = body.split('\n');
      return [
        unit,
        first.startsWith('**Source:** ')
          ? { source: first, text: trimNewlines(rest.join('\n')) }
          : { text: body },
      ];
    }),
  );
};

/** Lines only in one of the two texts (a multiset difference), and the first differing line. */
const lineDiff = (copy: string, today: string) => {
  const counts = new Map<string, number>();
  for (const line of copy.split('\n')) counts.set(line, (counts.get(line) ?? 0) + 1);
  let added = 0;
  let first = '';
  for (const line of today.split('\n')) {
    const left = counts.get(line) ?? 0;
    if (left > 0) counts.set(line, left - 1);
    else {
      added += 1;
      if (!first && line.trim()) first = line.trim();
    }
  }
  const removed = [...counts.values()].reduce((sum, n) => sum + n, 0);
  return { added, removed, first: first.length > 80 ? `${first.slice(0, 77)}…` : first };
};

type DocCache = Map<string, { stripped: Map<string, DocUnit>; raw: Map<string, DocUnit> } | null>;

const unitsOf = (root: string, path: string, docs: DocCache) => {
  if (!docs.has(path)) {
    const text = readText(join(root, path));
    if (text === null) docs.set(path, null);
    else {
      const byId = (units: DocUnit[]) => new Map(units.map((unit) => [unit.id, unit]));
      const stripped = stripDoNotCopy(text);
      const strippedUnits = byId(cutDocUnits(stripped, path));
      docs.set(path, {
        stripped: strippedUnits,
        // why: builders before "Do not copy" stripping cut the doc as written.
        raw: stripped === text ? strippedUnits : byId(cutDocUnits(text, path)),
      });
    }
  }
  return docs.get(path) ?? null;
};

const matches = (copy: { source?: string; text: string }, unit: DocUnit | undefined): boolean =>
  unit !== undefined &&
  copy.text === demote(unit.text) &&
  (copy.source === undefined || copy.source === sourceLine(unit));

const checkUnit = (
  root: string,
  unit: string,
  copy: { source?: string; text: string } | undefined,
  libraries: string[],
  docs: DocCache,
): UnitState => {
  const path = unitPath(unit);
  if (path === null) return { unit, state: 'gone', missing: 'section' };
  if (relative(root, resolve(root, path)).startsWith('..'))
    return { unit, state: 'gone', missing: 'file' };
  const cut = unitsOf(root, path, docs);
  if (cut === null) {
    const library = libraryOf(path, libraries);
    return library
      ? { unit, state: 'elsewhere', library }
      : { unit, state: 'gone', missing: 'file' };
  }
  if (copy === undefined) return { unit, state: 'uncopied' };
  const today = cut.stripped.get(unit) ?? cut.raw.get(unit);
  if (matches(copy, cut.stripped.get(unit)) || matches(copy, cut.raw.get(unit)))
    return { unit, state: 'fresh' };
  if (today === undefined) return { unit, state: 'gone', missing: 'section' };
  const shown = (source: string | undefined, text: string) =>
    source === undefined ? text : `${source}\n${text}`;
  return {
    unit,
    state: 'changed',
    ...lineDiff(
      shown(copy.source, copy.text),
      shown(copy.source && sourceLine(today), demote(today.text)),
    ),
  };
};

const checkRegion = (
  root: string,
  dir: string,
  id: string,
  libraries: string[],
  docs: DocCache,
): RegionFreshness => {
  const path = `${dir}/${id}`;
  const unreadable = (why: string): RegionFreshness => ({
    path,
    id,
    status: 'unverifiable',
    units: [],
    unreadable: why,
  });
  const meta = readObject(join(root, path, 'region.json'));
  if (meta === null) return unreadable('region.json is not a JSON object');
  const sources = isObject(meta.sources) ? meta.sources : {};
  const docUnits = Array.isArray(sources.docUnits)
    ? sources.docUnits.filter((unit): unit is string => typeof unit === 'string')
    : null;
  if (docUnits === null) return unreadable('region.json names no sources.docUnits');
  const knowledge = readText(join(root, path, 'knowledge.md'));
  if (knowledge === null) return unreadable('it has no knowledge.md');
  const copies = docUnits.length > 0 ? copiesOf(knowledge) : new Map();
  if (copies === null) return unreadable('knowledge.md has no part 4a (doc sections) to compare');
  const units = docUnits.map((unit) => checkUnit(root, unit, copies.get(unit), libraries, docs));
  const states = new Set(units.map((unit) => unit.state));
  const status =
    states.has('changed') || states.has('gone')
      ? 'stale'
      : states.has('uncopied')
        ? 'unverifiable'
        : units.length > 0 && units.every((unit) => unit.state === 'elsewhere')
          ? 'elsewhere'
          : 'fresh';
  return { path, id, status, units };
};

export type RegionFreshnessResult = {
  findings: Finding[];
  layers: RegionLayer[];
  regions: RegionFreshness[];
};

const describeUnit = (unit: UnitState): string => {
  switch (unit.state) {
    case 'changed':
      return `${unit.unit} changed (+${unit.added} −${unit.removed} lines${unit.first ? `; now: "${unit.first}"` : ''})`;
    case 'gone':
      return `${unit.unit} gone (${unit.missing === 'file' ? 'no such file' : 'no such section today'})`;
    case 'uncopied':
      return `${unit.unit} has no copy in knowledge.md`;
    default:
      return unit.unit;
  }
};

/** Units that make a region out of date: their doc changed, or is gone. */
const outOfDate = (region: RegionFreshness): UnitState[] =>
  region.units.filter((unit) => unit.state === 'changed' || unit.state === 'gone');

const rebuild = (region: RegionFreshness) =>
  `rebuild region ${region.id} (generated from the docs: never edit its files by hand)`;

/** One line per region: what it is and what to do. */
export const describeRegion = (region: RegionFreshness): string => {
  if (region.unreadable)
    return `region ${region.path} can't be checked: ${region.unreadable} → ${rebuild(region)}`;
  const units = region.units.length;
  switch (region.status) {
    case 'fresh': {
      const elsewhere = region.units.filter((unit) => unit.state === 'elsewhere').length;
      const checked = units - elsewhere;
      return `region ${region.path} is fresh (${checked} doc unit${checked === 1 ? '' : 's'}${elsewhere ? `; ${elsewhere} from another repo, not checked here` : ''})`;
    }
    case 'elsewhere':
      return `region ${region.path} copies only other repos' docs: not checked here`;
    case 'stale':
      return `region ${region.path} is stale: ${outOfDate(region).map(describeUnit).join('; ')} → ${rebuild(region)}`;
    default:
      return `region ${region.path} can't be checked: ${region.units
        .filter((unit) => unit.state === 'uncopied')
        .map(describeUnit)
        .join('; ')} → ${rebuild(region)}`;
  }
};

/** Every region of the repo's own layer, compared; other layers named, not checked. */
export const scanRegionFreshness = (root: string): Omit<RegionFreshnessResult, 'findings'> => {
  const layers: RegionLayer[] = [];
  const regions: RegionFreshness[] = [];
  const docs: DocCache = new Map();
  for (const dir of layerDirs(root)) {
    const ids = regionIds(root, dir);
    const registry = readObject(join(root, dir, 'registry.json'));
    const project = typeof registry?.project === 'string' ? registry.project : undefined;
    const own = dir === OWN_REGIONS_DIR;
    if (ids.length === 0 && !own) continue;
    if (ids.length > 0) layers.push({ dir, own, project, regions: ids.length });
    if (!own) continue;
    const libraries = librariesOf(registry);
    for (const id of ids) regions.push(checkRegion(root, dir, id, libraries, docs));
  }
  return { layers, regions };
};

/**
 * Fails on a region whose copied doc sections changed or are gone, unless the baseline covers it
 * (`<region path>\t<units out of date>`, shrink-only). A region that can't be read as a built
 * region, a layer built from another repo, and units copied from another repo are warnings.
 */
export const checkRegionFreshness = (root: string): RegionFreshnessResult => {
  const { layers, regions } = scanRegionFreshness(root);
  const { counts: baseline, malformed } = readBaseline(root, BASELINE_FILE, 1);
  const findings: Finding[] = malformed.map((line) => ({
    level: 'error',
    message: `${BASELINE_FILE}: "${line}" is not <region path>\\t<units out of date> → rewrite it with regions --write-baseline`,
  }));
  const counts = new Map<string, number>();
  for (const region of regions) {
    const stale = outOfDate(region).length;
    if (stale > 0) counts.set(region.path, stale);
  }
  const { over, under, covered } = compareBaseline(counts, baseline);
  const failing = new Set(over.map(({ key }) => key));
  for (const region of regions) {
    if (failing.has(region.path))
      findings.push({ level: 'error', message: describeRegion(region) });
    else if (region.status === 'unverifiable')
      findings.push({ level: 'warn', message: describeRegion(region) });
  }
  for (const { key, count, known } of under) {
    findings.push({
      level: 'error',
      message:
        count === 0
          ? `${BASELINE_FILE}: ${key} is no longer stale → delete its line`
          : `${BASELINE_FILE}: ${key} has ${count} unit${count === 1 ? '' : 's'} out of date now, not ${known} → lower its count`,
    });
  }
  for (const layer of layers.filter((layer) => !layer.own)) {
    findings.push({
      level: 'warn',
      message: `${layer.dir}: ${layer.regions} region${layer.regions === 1 ? '' : 's'} built from ${layer.project ? `${layer.project}'s` : 'another repo’s'} docs, not checked here (that repo's check covers them)`,
    });
  }
  const elsewhere = regions.flatMap((region) =>
    region.units.flatMap((unit) => (unit.state === 'elsewhere' ? [unit.library] : [])),
  );
  if (elsewhere.length > 0) {
    findings.push({
      level: 'warn',
      message: `${elsewhere.length} doc unit${elsewhere.length === 1 ? '' : 's'} in ${OWN_REGIONS_DIR} copy other repos' docs (${[...new Set(elsewhere)].sort().join(', ')}), not checked here`,
    });
  }
  const baselinedRegions = [...counts.keys()].filter(
    (key) => !failing.has(key) && (baseline.get(key) ?? 0) > 0,
  ).length;
  if (covered > 0) {
    findings.push({
      level: 'warn',
      message: `${baselinedRegions} stale region${baselinedRegions === 1 ? '' : 's'} in ${BASELINE_FILE} (not blocking; rebuild ${baselinedRegions === 1 ? 'it' : 'them'} and shrink the baseline)`,
    });
  }
  return { findings, layers, regions };
};

/** Writes the baseline from today's stale regions: when there is none yet, or only to shrink it. */
export const writeRegionFreshnessBaseline = (
  root: string,
): { written: number; refused: string[] } => {
  const counts = new Map<string, number>();
  for (const region of scanRegionFreshness(root).regions) {
    const stale = outOfDate(region).length;
    if (stale > 0) counts.set(region.path, stale);
  }
  return writeBaseline(root, BASELINE_FILE, {
    counts,
    keyFields: 1,
    header: [
      '# Stale Warden regions waiting for a rebuild: reported, not failed (@inixiative/config check).',
      '# One per line: <region path>\\t<doc units out of date>. Rebuild the region and lower or delete its line.',
      '# Rewrite after rebuilding: inixiative-config regions --write-baseline (it refuses to grow).',
    ],
  });
};
