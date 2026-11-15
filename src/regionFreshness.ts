import { type Dirent, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  cutDocUnits,
  type DocUnit,
  demote,
  normaliseNewlines,
  sourceLine,
  stripDoNotCopy,
  trimNewlines,
  unitCopies,
  unitPath,
} from './docUnits';
import type { Finding } from './lib';
import { type RetiredTermHit, regionHitGroups, regionRetiredHits } from './retiredTerms';

/**
 * Region freshness: a Warden region's part 4 holds the doc sections it was built from, verbatim
 * (`region.json` `sources.docUnits`). Re-cut each one from the repo's doc today, with the builder's
 * own rule (`docUnits.ts`), and compare. A copy that differs is stale: the region still
 * points at things that exist. A unit whose file or heading is gone, and a retired name inside a
 * region, are warnings too: only the machine that holds the builder can rebuild a region.
 */

/** Where the builder installs a repo's own regions, and Foundry's default chorus layer. */
const OWN_REGIONS_DIR = '.foundry/regions';
const PROJECT_SETTINGS = '.foundry/project.json';

export type UnitState =
  | { unit: string; state: 'fresh' }
  | { unit: string; state: 'changed'; added: number; removed: number; first: string }
  | { unit: string; state: 'gone'; missing: 'file' | 'section' }
  /** The unit copies another repo's docs (a library the registry names). */
  | { unit: string; state: 'elsewhere'; library: string }
  /** `region.json` names the unit, but `knowledge.md` holds no copy of it. */
  | { unit: string; state: 'uncopied' }
  /** Its doc is there but can't be read (permissions, not a regular file). */
  | { unit: string; state: 'unreadable'; why: string };

export type RegionStatus =
  /** Every unit it names was compared and matches. */
  | 'fresh'
  /** The units compared match; some it names copy another repo's docs. */
  | 'partly checked'
  /** Nothing to compare: no doc units, or all from another repo. */
  | 'not checked'
  /** A copy differs from its doc today (a warning). */
  | 'stale'
  /** A unit's file or heading is gone (a warning). */
  | 'gone'
  /** The region can't be read as a built one (a warning). */
  | 'unverifiable';

export type RegionFreshness = {
  /** The region's directory, repo-relative: `<regions dir>/<id>`. */
  path: string;
  id: string;
  status: RegionStatus;
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

/** A file's text, or that it is missing, or why it can't be read: never a throw. */
type Read<T> = { ok: T } | { missing: true } | { error: string };

const failure = (error: unknown): string =>
  (error as NodeJS.ErrnoException).code ?? (error instanceof Error ? error.message : String(error));

const readText = (abs: string): Read<string> => {
  try {
    if (!lstatSync(abs).isFile()) return { error: 'not a regular file' };
    return { ok: normaliseNewlines(readFileSync(abs, 'utf8')) };
  } catch (error) {
    return failure(error) === 'ENOENT' ? { missing: true } : { error: failure(error) };
  }
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const readObject = (abs: string): Read<Record<string, unknown>> => {
  const read = readText(abs);
  if (!('ok' in read)) return read;
  try {
    const value: unknown = JSON.parse(read.ok);
    return isObject(value) ? { ok: value } : { error: 'not a JSON object' };
  } catch {
    return { error: 'not JSON' };
  }
};

/**
 * The regions directories a project's chorus is built from, as Foundry reads them
 * (`region-roster.ts` `chorusLayers`): `chorus.layers` as written, else the one `chorus.regions`
 * names, else `.foundry/regions`. Directories outside the repo are not its files.
 */
const layerDirs = (root: string, problems: string[]): { dir: string; named: boolean }[] => {
  const read = readObject(join(root, PROJECT_SETTINGS));
  if ('error' in read)
    problems.push(`can't read ${PROJECT_SETTINGS} (${read.error}): read ${OWN_REGIONS_DIR} only`);
  const chorus = 'ok' in read && isObject(read.ok.chorus) ? read.ok.chorus : {};
  const listed = Array.isArray(chorus.layers)
    ? chorus.layers.flatMap((layer) =>
        isObject(layer) && typeof layer.regions === 'string' ? [layer.regions] : [],
      )
    : typeof chorus.regions === 'string'
      ? [chorus.regions]
      : [];
  const named = listed.length > 0 || Array.isArray(chorus.layers);
  const dirs = (named ? listed : [OWN_REGIONS_DIR])
    .map((dir) => relative(root, isAbsolute(dir) ? resolve(dir) : resolve(root, dir)))
    .filter((dir) => dir !== '' && !dir.startsWith('..'));
  return [...new Set(dirs)].map((dir) => ({ dir, named }));
};

/** Region directories under `dir` (each holding a `region.json`), sorted; what can't be read is a problem. */
const regionIds = (root: string, dir: string, named: boolean, problems: string[]): string[] => {
  let entries: Dirent[];
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true });
  } catch (error) {
    const code = failure(error);
    if (code === 'ENOENT' && named)
      problems.push(`${PROJECT_SETTINGS} names ${dir} as a layer, but it does not exist`);
    else if (code !== 'ENOENT')
      problems.push(
        code === 'ENOTDIR'
          ? `${dir} is not a directory: no regions read there`
          : `can't read ${dir} (${code}): no regions read there`,
      );
    return [];
  }
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      statSync(join(root, dir, entry.name, 'region.json'));
      ids.push(entry.name);
    } catch (error) {
      const code = failure(error);
      if (code !== 'ENOENT')
        problems.push(`can't read ${dir}/${entry.name} (${code}): not read as a region`);
    }
  }
  return ids.sort();
};

/** The registry's `builtFrom.libraries` names: doc units under `<name>/` or `@scope/<name>/` are another repo's. */
const librariesOf = (registry: Record<string, unknown> | undefined): string[] => {
  const builtFrom = isObject(registry?.builtFrom) ? registry.builtFrom : {};
  return isObject(builtFrom.libraries) ? Object.keys(builtFrom.libraries) : [];
};

const libraryOf = (path: string, libraries: string[]): string | undefined => {
  const unscoped = path.startsWith('@') ? path.slice(path.indexOf('/') + 1) : path;
  return libraries.find((name) => path.startsWith(`${name}/`) || unscoped.startsWith(`${name}/`));
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

type DocCut = { stripped: Map<string, DocUnit>; raw: Map<string, DocUnit> };
type DocCache = Map<string, Read<DocCut>>;

const unitsOf = (root: string, path: string, docs: DocCache): Read<DocCut> => {
  const cached = docs.get(path);
  if (cached) return cached;
  const read = readText(join(root, path));
  let cut: Read<DocCut> = read as Read<DocCut>;
  if ('ok' in read) {
    const byId = (units: DocUnit[]) => new Map(units.map((unit) => [unit.id, unit]));
    const stripped = stripDoNotCopy(read.ok);
    const strippedUnits = byId(cutDocUnits(stripped, path));
    cut = {
      ok: {
        stripped: strippedUnits,
        // why: builders before "Do not copy" stripping cut the doc as written.
        raw: stripped === read.ok ? strippedUnits : byId(cutDocUnits(read.ok, path)),
      },
    };
  }
  docs.set(path, cut);
  return cut;
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
  const read = unitsOf(root, path, docs);
  if ('error' in read) return { unit, state: 'unreadable', why: read.error };
  if (!('ok' in read)) {
    const library = libraryOf(path, libraries);
    return library
      ? { unit, state: 'elsewhere', library }
      : { unit, state: 'gone', missing: 'file' };
  }
  const cut = read.ok;
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
  const metaRead = readObject(join(root, path, 'region.json'));
  if (!('ok' in metaRead))
    return unreadable(
      'error' in metaRead ? `can't read region.json (${metaRead.error})` : 'it has no region.json',
    );
  const meta = metaRead.ok;
  const sources = isObject(meta.sources) ? meta.sources : {};
  const docUnits = Array.isArray(sources.docUnits)
    ? sources.docUnits.filter((unit): unit is string => typeof unit === 'string')
    : null;
  if (docUnits === null) return unreadable('region.json names no sources.docUnits');
  const knowledgeRead = readText(join(root, path, 'knowledge.md'));
  if (!('ok' in knowledgeRead))
    return unreadable(
      'error' in knowledgeRead
        ? `can't read knowledge.md (${knowledgeRead.error})`
        : 'it has no knowledge.md',
    );
  const knowledge = knowledgeRead.ok;
  const copies = docUnits.length > 0 ? copiesOf(knowledge) : new Map();
  if (copies === null) return unreadable('knowledge.md has no part 4a (doc sections) to compare');
  const units = docUnits.map((unit) => checkUnit(root, unit, copies.get(unit), libraries, docs));
  const states = new Set(units.map((unit) => unit.state));
  const checked = units.filter((unit) => unit.state !== 'elsewhere').length;
  const status: RegionStatus = states.has('gone')
    ? 'gone'
    : states.has('changed')
      ? 'stale'
      : states.has('uncopied') || states.has('unreadable')
        ? 'unverifiable'
        : checked === 0
          ? 'not checked'
          : checked < units.length
            ? 'partly checked'
            : 'fresh';
  return { path, id, status, units };
};

const describeUnit = (unit: UnitState): string => {
  switch (unit.state) {
    case 'changed':
      return `${unit.unit} changed (+${unit.added} −${unit.removed} lines${unit.first ? `; now: "${unit.first}"` : ''})`;
    case 'gone':
      return `${unit.unit} gone (${unit.missing === 'file' ? 'no such file' : 'no such section today'})`;
    case 'uncopied':
      return `${unit.unit} has no copy in knowledge.md`;
    case 'unreadable':
      return `${unit.unit}: can't read its doc (${unit.why})`;
    default:
      return unit.unit;
  }
};

const outOf = (region: RegionFreshness, state: UnitState['state']): UnitState[] =>
  region.units.filter((unit) => unit.state === state);

const rebuild = (region: RegionFreshness) =>
  `rebuild region ${region.id} (generated from the docs: never edit its files by hand)`;

/** Units compared here, of the units the region names. */
const coverage = (region: RegionFreshness): string => {
  const named = region.units.length;
  const checked = named - outOf(region, 'elsewhere').length;
  return `${checked} of ${named} doc unit${named === 1 ? '' : 's'} checked`;
};

/** One line per region: what it is and what to do. */
export const describeRegion = (region: RegionFreshness): string => {
  if (region.unreadable)
    return `region ${region.path} can't be checked: ${region.unreadable} → ${rebuild(region)}`;
  const named = region.units.length;
  switch (region.status) {
    case 'fresh':
      return `region ${region.path} is fresh (${coverage(region)})`;
    case 'partly checked':
      return `region ${region.path} is partly checked (${coverage(region)}; the rest copy another repo's docs)`;
    case 'not checked':
      return named === 0
        ? `region ${region.path} is not checked (it copies no doc sections)`
        : `region ${region.path} is not checked (${coverage(region)}: all copy another repo's docs)`;
    case 'gone':
      return `region ${region.path} copies sections that are gone: ${[...outOf(region, 'gone'), ...outOf(region, 'changed')].map(describeUnit).join('; ')} → ${rebuild(region)}`;
    case 'stale':
      return `region ${region.path} is stale: ${outOf(region, 'changed').map(describeUnit).join('; ')} → ${rebuild(region)} when you can; not blocking`;
    default:
      return `region ${region.path} can't be checked: ${[
        ...outOf(region, 'uncopied'),
        ...outOf(region, 'unreadable'),
      ]
        .map(describeUnit)
        .join('; ')} → ${rebuild(region)}`;
  }
};

/** What this rule reads and doesn't, said wherever its results are. */
const REGIONS_SEEN =
  "compared with the docs: part 4a only; the rest of each region (parts 1–3, part 4b's code entries, recognise.md, region.json) and the set's GLOSSARY.md and registry.json are only scanned for retired names; doc sections no region copies are not seen";

/** One line: how many regions are in each state. */
const summariseRegions = (regions: RegionFreshness[], naming = 0): string => {
  const order: RegionStatus[] = [
    'fresh',
    'partly checked',
    'not checked',
    'stale',
    'gone',
    'unverifiable',
  ];
  const counts = order
    .map((status) => [status, regions.filter((region) => region.status === status).length] as const)
    .filter(([, n]) => n > 0)
    .map(([status, n]) => `${n} ${status}`);
  if (naming > 0) counts.push(`${naming} naming something retired`);
  return `${regions.length} region${regions.length === 1 ? '' : 's'} in ${OWN_REGIONS_DIR}: ${counts.join(', ')}; ${REGIONS_SEEN}`;
};

/** Every region of the repo's own layer, compared; other layers named, not checked; what can't be read, said. */
const scanRegionFreshness = (root: string) => {
  const layers: RegionLayer[] = [];
  const regions: RegionFreshness[] = [];
  const problems: string[] = [];
  const docs: DocCache = new Map();
  for (const { dir, named } of layerDirs(root, problems)) {
    const ids = regionIds(root, dir, named, problems);
    if (ids.length === 0) continue;
    const registryRead = readObject(join(root, dir, 'registry.json'));
    if ('error' in registryRead)
      problems.push(
        `can't read ${dir}/registry.json (${registryRead.error}): its libraries are unknown`,
      );
    const registry = 'ok' in registryRead ? registryRead.ok : undefined;
    const project = typeof registry?.project === 'string' ? registry.project : undefined;
    const own = dir === OWN_REGIONS_DIR;
    layers.push({ dir, own, project, regions: ids.length });
    if (!own) continue;
    const libraries = librariesOf(registry);
    for (const id of ids) regions.push(checkRegion(root, dir, id, libraries, docs));
  }
  return { layers, regions, problems };
};

export type RegionFreshnessResult = {
  findings: Finding[];
  layers: RegionLayer[];
  regions: RegionFreshness[];
  /** The one summary line (also the last finding when there are any). */
  summary?: string;
};

/**
 * Every finding about regions is a warning, and nothing here throws: a region is rebuilt only
 * where the builder runs, so a repo's CI never fails on one. A stale copy, a gone section and a
 * retired name each say to rebuild the region; another repo's layer, units copied from another
 * repo's docs and anything that can't be read are named; the summary counts the regions in each
 * state. `retiredHits` are the retired-terms rule's region hits, when it has already scanned.
 */
export const checkRegionFreshness = (
  root: string,
  retired: { hits: RetiredTermHit[]; problems: string[] } = regionRetiredHits(root),
): RegionFreshnessResult => {
  const { layers, regions, problems } = scanRegionFreshness(root);
  problems.push(...retired.problems);
  const findings: Finding[] = [];
  const warn = (message: string) => findings.push({ level: 'warn', message });
  for (const problem of problems) warn(`regions: ${problem}`);
  for (const region of regions)
    if (['gone', 'stale', 'unverifiable'].includes(region.status)) warn(describeRegion(region));
  const groups = regionHitGroups(retired.hits);
  for (const group of groups) warn(group.message);
  for (const layer of layers.filter((layer) => !layer.own))
    warn(
      `${layer.dir}: ${layer.regions} region${layer.regions === 1 ? '' : 's'} built from ${layer.project ? `${layer.project}'s` : 'another repo’s'} docs, not checked here`,
    );
  const elsewhere = regions.flatMap((region) =>
    region.units.flatMap((unit) => (unit.state === 'elsewhere' ? [unit.library] : [])),
  );
  if (elsewhere.length > 0)
    warn(
      `${elsewhere.length} doc unit${elsewhere.length === 1 ? '' : 's'} in ${OWN_REGIONS_DIR} copy other repos' docs (${[...new Set(elsewhere)].sort().join(', ')}), not checked here`,
    );
  const naming = new Set(
    groups.flatMap((group) => (group.dir === OWN_REGIONS_DIR && group.region ? [group.key] : [])),
  ).size;
  const summary = regions.length > 0 ? summariseRegions(regions, naming) : undefined;
  if (summary && findings.length > 0) warn(summary);
  return { findings, layers, regions, summary };
};
