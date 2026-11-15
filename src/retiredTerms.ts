import { spawnSync } from 'node:child_process';
import {
  type Dirent,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { unitCopies, unitPath } from './docUnits';
import type { Finding } from './lib';

/**
 * Retired terms: names and phrases the project has retired (CLAUDE.md "Dead concepts", the copy
 * brief's "Retired words"), checked in the text people read, never in code identifiers.
 *
 * `public` terms are retired only as marketing words: Foundry still has a Librarian and a
 * Cartographer in its code and internal docs, so those names are checked only on the surfaces
 * a visitor reads first (READMEs, package descriptions, site pages). `docs` terms are dead
 * everywhere and are checked in every Markdown, HTML, MDX and Astro file as well.
 *
 * `removedConcept` terms name something that no longer exists (a concept, an API, a repo). They are
 * also checked in generated Warden regions, where a stale name points a Warden at nothing; the rest
 * are words, which a region repeats harmlessly until its next rebuild.
 *
 * Deliberately absent, each because a pattern would flag mostly legitimate text:
 * - "medical" / "healthcare": the doctor's-visit story is allowed in marketing (CLAUDE.md
 *   2026-10-12); only the dead demo's identifiers are listed.
 * - "Connection" and `connectionId`: WebSocket and database connections are everywhere, and
 *   Foundry's viewer has a live per-socket `connectionId`.
 * - "principal": the permissions README uses it as the glossary word for any holder, beside
 *   job titles ("principal engineer") and the principal–agent problem in governance prose.
 * - "Cursor as a runtime", "token savings": a phrase can't tell a claim from a comparison.
 */
export type RetiredTerm = {
  id: string;
  pattern: RegExp;
  scope: 'public' | 'docs';
  instead: string;
  removedConcept?: true;
};

export const RETIRED_TERMS: readonly RetiredTerm[] = [
  {
    id: 'kastle',
    pattern: /\bkastles?\b/gi,
    scope: 'docs',
    instead: 'Kingdom, owner, integration or Signet',
    removedConcept: true,
  },
  {
    id: 'castle',
    pattern: /\bCastles?\b/g,
    scope: 'docs',
    instead: 'Kingdom, owner, integration or Signet',
    removedConcept: true,
  },
  {
    id: 'runtime-keys',
    pattern: /\bRuntimeInstallations?\b|\bkingdom_runtime_/g,
    scope: 'docs',
    instead: 'a Signet enrollment on the Foundry integration',
    removedConcept: true,
  },
  {
    id: 'medical-demo',
    pattern: /\bsignetDemo\b|\bmedicalQuestionStep\b/g,
    scope: 'docs',
    instead: 'nothing: the demo is gone (demos live in template-workbench)',
    removedConcept: true,
  },
  {
    id: 'retired-workspaces',
    pattern: /\bkingdom-workspace\b|\bfoundry-lab\b|\bnative-candidate\b/g,
    scope: 'docs',
    instead: 'the canonical repos (kingdom, foundry)',
    removedConcept: true,
  },
  {
    id: 'foundry-oracle',
    pattern: /\bfoundry-oracle\b/gi,
    scope: 'docs',
    instead: 'Foundry and Oracle, two products',
  },
  {
    id: 'own-llm-keys',
    pattern: /\byour own (?:LLM|model|API) keys?\b/gi,
    scope: 'docs',
    instead: 'your own subscriptions (Foundry runs on subscription logins)',
  },
  {
    id: 'foundry-roles',
    pattern: /\b(?:Cartographer|Librarian|Artificer|Steward)s?\b/g,
    scope: 'public',
    instead: 'say what it does: Wardens point at what exists; your agent decides',
  },
  // signet 0.18.0 (CHANGELOG "a conversation is an integration resource; grant terms are gone").
  {
    id: 'signet-grant-terms',
    pattern:
      /\b(?:threadsTermsSchema|threadsTerms|grantTermsSchema|grantTermsFitKind|narrowsThreadsTerms|meetThreadsTerms|termsNarrow|threadViewSchema|threadDeliverySchema|threadOutboundSchema|threadFloorTermsSchema|threadPostsSchema|threadActSchema)\b/g,
    scope: 'docs',
    instead:
      'conversation permissions, picked on the grant like operations: member.log, member.wake, member.take, member.agent, agent.instruct, agent.read, agent.act (signet conversationPermissionSchema; CHANGELOG 0.18.0)',
    removedConcept: true,
  },
  {
    id: 'signet-threads-resource',
    pattern: /\bthreadsResourceKind\b|(?:`threads`|\bthreads) resources?\b/g,
    scope: 'docs',
    instead:
      'a `conversation` integration resource per shared thread (signet conversationResourceKind; its externalId is the thread id)',
    removedConcept: true,
  },
  {
    id: 'signet-may-take',
    pattern: /\b(?:floor\.)?mayTake\b/g,
    scope: 'docs',
    instead: 'the member.take conversation permission (signet 0.18.0)',
    removedConcept: true,
  },
  {
    id: 'signet-grant-reach',
    pattern: /\bgrantReach\b/g,
    scope: 'docs',
    instead:
      "the grant row on the thread's `conversation` resource: a call's resource is the conversation (signet 0.18.0)",
    removedConcept: true,
  },
];

export const RETIRED_TERMS_DIR = 'scripts/ci/retired-terms';
const ALLOW_FILE = `${RETIRED_TERMS_DIR}/allow.txt`;
const BASELINE_FILE = `${RETIRED_TERMS_DIR}/baseline.txt`;

const TEXT_FILE = /\.(md|mdx|html|astro)$/i;
const PUBLIC_FILE = /(^|\/)README[^/]*\.md$|\.(html|astro|mdx)$/i;
// Skipped: dependencies and build output at the root; fixtures (they hold the words on purpose);
// changelogs (history records the rename).
const SKIPPED =
  /(^|\/)(node_modules|\.git|\.worktrees|fixtures|rule-violations)\/|^(dist|build|coverage|tmp)\/|(^|\/)CHANGELOG[^/]*\.md$/i;
/**
 * The files the region builder writes, in any regions directory (`.foundry/regions`, or a base
 * layer such as Kingdom's `.foundry/template/regions`): each region's three, and the set's own.
 */
const REGION_FILE =
  /^(\.foundry\/(?:[^/]+\/)*regions)\/(?:([^/]+)\/(?:knowledge\.md|recognise\.md|region\.json)|(?:GLOSSARY\.md|registry\.json|ECOSYSTEM\.md|ERRORS\.md))$/;

/** A generated region file's regions directory and region id (none for the set's own files). */
export const regionFileOf = (path: string): { dir: string; region?: string } | null => {
  const match = REGION_FILE.exec(path);
  return match ? { dir: match[1], region: match[2] } : null;
};

export type RetiredTermHit = {
  path: string;
  line: number;
  term: RetiredTerm;
  text: string;
  /** The whole line the hit is on, and where on it the hit starts. */
  lineText: string;
  column: number;
  /** For a hit inside a region's copy of a doc section: the unit, and the doc it was copied from. */
  copiedFrom?: { unit: string; path: string };
};

const walk = (root: string, dir = '', out: string[] = []): string[] => {
  let entries: Dirent[] = [];
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory() && !SKIPPED.test(`${rel}/`)) walk(root, rel, out);
    else if (entry.isFile()) out.push(rel);
  }
  return out;
};

const errorCode = (error: unknown): string =>
  (error as NodeJS.ErrnoException).code ?? (error instanceof Error ? error.message : String(error));

/** A regular file's text; a symlink, directory or vanished path reads as nothing. */
const readText = (abs: string): string | null => {
  try {
    return lstatSync(abs).isFile() ? readFileSync(abs, 'utf8') : null;
  } catch {
    return null;
  }
};

/** Tracked files in a git checkout (ignored and generated files never ship); every file otherwise. */
const listFiles = (root: string): string[] => {
  if (existsSync(join(root, '.git'))) {
    const listed = spawnSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      {
        cwd: root,
        encoding: 'utf8',
      },
    );
    if (listed.status === 0) return listed.stdout.split('\0').filter(Boolean);
  }
  return walk(root);
};

const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length;

/**
 * Every retired term in the repo's readable text, before the allow list. Generated region files
 * are read for removed concepts only.
 */
export const scanRetiredTerms = (root: string): RetiredTermHit[] => {
  const hits: RetiredTermHit[] = [];
  for (const path of listFiles(root).sort()) {
    if (SKIPPED.test(path) || path.startsWith(`${RETIRED_TERMS_DIR}/`)) continue;
    const generated = regionFileOf(path) !== null;
    const isManifest = !generated && /(^|\/)package\.json$/.test(path);
    if (!generated && !isManifest && !TEXT_FILE.test(path)) continue;
    const raw = readText(join(root, path));
    if (raw === null) continue;
    let text = raw;
    if (isManifest) {
      try {
        const description = (JSON.parse(raw) as { description?: unknown }).description;
        if (typeof description !== 'string') continue;
        text = description;
      } catch {
        continue;
      }
    }
    const isPublic = isManifest || PUBLIC_FILE.test(path);
    const copies = generated && path.endsWith('/knowledge.md') ? (unitCopies(raw) ?? []) : [];
    const copiedFrom = (index: number) => {
      const copy = copies.find((span) => span.start <= index && index < span.end);
      const from = copy && unitPath(copy.unit);
      return copy && from ? { unit: copy.unit, path: from } : undefined;
    };
    const lineStart = (index: number) => text.lastIndexOf('\n', index - 1) + 1;
    const lineTextAt = (index: number) => {
      const end = text.indexOf('\n', index);
      return text.slice(lineStart(index), end === -1 ? undefined : end);
    };
    for (const term of RETIRED_TERMS) {
      if (generated ? !term.removedConcept : term.scope === 'public' && !isPublic) continue;
      for (const match of text.matchAll(term.pattern)) {
        hits.push({
          path,
          line: isManifest ? lineOf(raw, raw.indexOf('"description"')) : lineOf(text, match.index),
          term,
          text: match[0],
          lineText: lineTextAt(match.index),
          column: match.index - lineStart(match.index),
          copiedFrom: copiedFrom(match.index),
        });
      }
    }
  }
  return hits.sort((a, b) => (a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1));
};

/**
 * Region hits grouped per region (or per regions directory, for the set's own files), as one line
 * each that says to rebuild it: the regions rule reports them, as warnings.
 */
export const regionHitGroups = (
  hits: RetiredTermHit[],
): { key: string; dir: string; region?: string; message: string }[] => {
  const groups = new Map<string, RetiredTermHit[]>();
  for (const hit of hits) {
    const generated = regionFileOf(hit.path);
    if (!generated) continue;
    const key = generated.region ? `${generated.dir}/${generated.region}` : generated.dir;
    groups.set(key, [...(groups.get(key) ?? []), hit]);
  }
  return [...groups].map(([key, group]) => {
    const { dir, region } = regionFileOf(group[0].path) ?? { dir: key };
    const files = new Map<string, number>();
    for (const hit of group) {
      const file = hit.path.slice(hit.path.lastIndexOf('/') + 1);
      files.set(file, (files.get(file) ?? 0) + 1);
    }
    const terms = [...new Map(group.map((hit) => [hit.term.id, hit.term])).values()];
    const names = [...new Set(group.map((hit) => hit.text))];
    const shown = `${names
      .slice(0, 4)
      .map((name) => `"${name}"`)
      .join(', ')}${names.length > 4 ? ` and ${names.length - 4} more` : ''}`;
    const target = region ? `rebuild region ${region}` : `rebuild the regions in ${key}`;
    const elsewhere =
      dir === '.foundry/regions'
        ? ''
        : ` in the repo whose docs ${dir} was built from, then copy it here`;
    return {
      key,
      dir,
      region,
      message: `${region ? `region ${key}` : `${key} (the set's own files)`} names something retired: ${shown} (${[...files].map(([file, n]) => `${file} ×${n}`).join(', ')}) → ${target}${elsewhere} (generated from the docs: never edit it by hand; fix any source doc that still says this first). Today: ${terms.map((term) => `${term.id}: ${term.instead}`).join('; ')}`,
    };
  });
};

/**
 * `allow.txt`: each entry under a `#` comment that gives its reason (one comment may head a block
 * of entries; a blank line ends the block). Fields are tab-separated, exact, with no spaces
 * around them:
 * - `<term>`: the term everywhere;
 * - `<path>\t<term>`: in one file, or under a directory when the path ends in `/` (a file that is
 *   history as a whole: a dated record, a review, a retired-names table). Paths are exact: no globs;
 * - `<path>\t<term>\t"<snippet>"`: one history mention in a live doc. The snippet holds the
 *   retired name and words around it, and appears on exactly one line of the file; it allows the
 *   use it quotes on that line, wherever the line moves.
 * An entry that covers no use is stale and fails. A region's verbatim copy of an allowed line is
 * allowed with it.
 */
type AllowRule = { line: number; path: string; term: RetiredTerm; snippet?: string; used: boolean };

const ALLOW_FORMS = '<term>, <path>\\t<term> or <path>\\t<term>\\t"<snippet>"';
const GLOB = /[*?[\]{}]/;

const parseAllow = (
  root: string,
): { rules: AllowRule[]; problems: string[]; unreadable?: string } => {
  const abs = join(root, ALLOW_FILE);
  const rules: AllowRule[] = [];
  const problems: string[] = [];
  if (!existsSync(abs)) return { rules, problems };
  let body: string;
  try {
    body = readFileSync(abs, 'utf8');
  } catch (error) {
    return {
      rules,
      problems,
      unreadable: `can't read ${ALLOW_FILE} (${errorCode(error)}): no allow entry applies`,
    };
  }
  const ids = new Map(RETIRED_TERMS.map((term) => [term.id, term]));
  let reasoned = false;
  for (const [index, raw] of body.split('\n').entries()) {
    const line = raw.replace(/\r$/, '');
    if (line.trim() === '') {
      reasoned = false;
      continue;
    }
    if (line.trimStart().startsWith('#')) {
      reasoned = true;
      continue;
    }
    const wrong = (why: string) =>
      problems.push(`${ALLOW_FILE}:${index + 1}: ${why} → write ${ALLOW_FORMS}`);
    const fields = line.split('\t');
    if (fields.length > 3 || fields.some((field) => field === '' || field !== field.trim())) {
      wrong(
        `"${line}" is not an allow entry (tab-separated fields, nothing empty, no spaces around them)`,
      );
      continue;
    }
    const [path, id, quoted] = fields.length === 1 ? ['', fields[0]] : fields;
    if (/\s/.test(id)) {
      wrong(`"${line}" is not an allow entry (its fields are not tab-separated)`);
      continue;
    }
    const term = ids.get(id);
    if (!term) {
      wrong(`"${id}" is not a retired term (${RETIRED_TERMS.map((entry) => entry.id).join(', ')})`);
      continue;
    }
    if (GLOB.test(path)) {
      wrong(`"${path}" is a pattern; paths are exact (a file, or a directory ending in /)`);
      continue;
    }
    if (!reasoned) {
      wrong(`"${line}" has no reason: put a # comment saying why above it`);
      continue;
    }
    if (quoted === undefined) {
      rules.push({ line: index + 1, path, term, used: false });
      continue;
    }
    const snippet = /^"(.+)"$/.exec(quoted)?.[1];
    if (snippet === undefined) {
      wrong(`the snippet ${quoted} is not in double quotes`);
      continue;
    }
    const names = [...snippet.matchAll(term.pattern)].map((match) => match[0]);
    if (names.length === 0) {
      wrong(`the snippet "${snippet}" does not contain ${term.id}`);
      continue;
    }
    if (!/[\p{L}\p{N}]/u.test(snippet.replace(term.pattern, ''))) {
      wrong(`the snippet "${snippet}" is only the retired name: quote the words around it too`);
      continue;
    }
    if (path === '' || path.endsWith('/')) {
      wrong(`a snippet entry names one file, not "${path}"`);
      continue;
    }
    const text = readText(join(root, path));
    const lines = text === null ? [] : text.split('\n').filter((entry) => entry.includes(snippet));
    if (lines.length > 1) {
      wrong(
        new Set(lines.map((entry) => entry.trim())).size === 1
          ? `the snippet "${snippet}" is on ${lines.length} identical lines of ${path}, so no snippet can name one: make the lines differ, allow the file with <path>\\t<term> if it is history as a whole, or baseline them`
          : `the snippet "${snippet}" is on ${lines.length} lines of ${path}: lengthen it so it names one`,
      );
      continue;
    }
    rules.push({ line: index + 1, path, term, snippet, used: false });
  }
  return { rules, problems };
};

const covers = (rulePath: string, path: string) =>
  rulePath === path || (rulePath.endsWith('/') && path.startsWith(rulePath));

/** The snippet holds this very use: an occurrence of it on the line spans the hit. */
const quotes = (snippet: string, hit: RetiredTermHit) => {
  for (
    let at = hit.lineText.indexOf(snippet);
    at !== -1;
    at = hit.lineText.indexOf(snippet, at + 1)
  )
    if (at <= hit.column && hit.column + hit.text.length <= at + snippet.length) return true;
  return false;
};

/** Marks the rule that allows the hit as used; false when none does. */
const allow = (rules: AllowRule[], hit: RetiredTermHit): boolean => {
  const rule = rules.find(
    (entry) =>
      entry.term.id === hit.term.id &&
      (entry.snippet === undefined || quotes(entry.snippet, hit)) &&
      (entry.path === '' ||
        covers(entry.path, hit.path) ||
        (hit.copiedFrom !== undefined && covers(entry.path, hit.copiedFrom.path))),
  );
  if (rule) rule.used = true;
  return rule !== undefined;
};

const REGIONS_PATH = /^\.foundry\/(?:[^/]+\/)*regions(?:\/|$)/;

/** Why an allow entry covers nothing, when that can be told. */
const whyUnused = (root: string, rule: AllowRule, rules: AllowRule[], hits: RetiredTermHit[]) => {
  const alone = hits.some((hit) => allow([{ ...rule, used: false }], hit));
  if (alone) {
    const earlier = rules.find(
      (entry) => entry !== rule && entry.used && entry.term.id === rule.term.id,
    );
    return `an earlier entry${earlier ? ` (line ${earlier.line})` : ''} already covers its uses`;
  }
  if (rule.path === '') return `nothing anywhere uses ${rule.term.id}`;
  if (SKIPPED.test(rule.path) || rule.path.startsWith(`${RETIRED_TERMS_DIR}/`))
    return 'its path is never scanned';
  if (!rule.path.endsWith('/') && !existsSync(join(root, rule.path))) return 'no such file';
  return `nothing there uses ${rule.term.id}`;
};

/**
 * Every use, split into docs (this rule's) and generated regions (the regions rule's), after the
 * allow list; and what is wrong with the allow list. An entry that covers nothing is an error,
 * unless its path is a region file or under a regions directory: a rebuilt region drops a name
 * nobody edited, so that is a warning.
 */
const classify = (root: string) => {
  const { rules, problems, unreadable } = parseAllow(root);
  const docs: RetiredTermHit[] = [];
  const regions: RetiredTermHit[] = [];
  const all = scanRetiredTerms(root);
  for (const hit of all) {
    if (allow(rules, hit)) continue;
    (regionFileOf(hit.path) ? regions : docs).push(hit);
  }
  const findings: Finding[] = [
    ...(unreadable ? [{ level: 'error' as const, message: unreadable }] : []),
    ...problems.map((message) => ({ level: 'error' as const, message })),
  ];
  for (const rule of rules.filter((entry) => !entry.used)) {
    const why = whyUnused(root, rule, rules, all);
    findings.push(
      REGIONS_PATH.test(rule.path)
        ? {
            level: 'warn',
            message: `${ALLOW_FILE}:${rule.line}: this allow covers nothing now (${why}): delete it when you next touch this file`,
          }
        : {
            level: 'error',
            message: `${ALLOW_FILE}:${rule.line}: this allow covers nothing (${why}): delete it`,
          },
    );
  }
  return { docs, regions, findings, unreadable };
};

/** Retired names in generated region files that no allow entry covers, and an allow list that can't be read. */
export const regionRetiredHits = (root: string): { hits: RetiredTermHit[]; problems: string[] } => {
  const { regions, unreadable } = classify(root);
  return { hits: regions, problems: unreadable ? [unreadable] : [] };
};

const countByKey = (hits: RetiredTermHit[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const hit of hits) {
    const key = `${hit.path}\t${hit.term.id}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

/** The baseline's `<path>\t<term>\t<count>` lines by `<path>\t<term>`, and any line that isn't one. */
const BASELINE_LINE = /^([^\t]+\t[^\t]+)\t(\d+)$/;
const readBaseline = (root: string) => {
  const counts = new Map<string, number>();
  const malformed: string[] = [];
  const abs = join(root, BASELINE_FILE);
  let text = '';
  let unreadable: string | undefined;
  try {
    if (existsSync(abs)) text = readFileSync(abs, 'utf8');
  } catch (error) {
    unreadable = `can't read ${BASELINE_FILE} (${errorCode(error)}): fix or delete it`;
  }
  for (const line of text.split('\n').map((entry) => entry.trimEnd())) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const match = BASELINE_LINE.exec(line);
    if (match) counts.set(match[1], Number(match[2]));
    else malformed.push(line);
  }
  const terms = /^# terms: (.*)$/m.exec(text);
  return {
    exists: existsSync(abs),
    unreadable,
    counts,
    malformed,
    // A baseline without the line was written by the release whose list was FIRST_TERMS.
    terms: new Set(terms ? terms[1].split(/\s+/).filter(Boolean) : FIRST_TERMS),
  };
};

/** The terms of the release before the baseline recorded which terms it was written against. */
const FIRST_TERMS = [
  'kastle',
  'castle',
  'runtime-keys',
  'medical-demo',
  'retired-workspaces',
  'foundry-oracle',
  'own-llm-keys',
  'foundry-roles',
];

export type RetiredTermsResult = {
  findings: Finding[];
  /** Uses in docs outside the allow list, before the baseline. */
  hits: RetiredTermHit[];
  /** Uses in generated regions outside the allow list: the regions rule reports them. */
  regionHits: RetiredTermHit[];
};

/**
 * Fails on a retired term in a doc that the baseline doesn't cover, on an allow entry that is
 * malformed or covers nothing, and on a baseline entry whose uses dropped (lower or delete it), so
 * the baseline only shrinks. Baselined uses are one warning. Generated regions are the regions
 * rule's (warnings).
 */
export const checkRetiredTerms = (root: string): RetiredTermsResult => {
  const { docs: hits, regions: regionHits, findings: allowFindings } = classify(root);
  const counts = countByKey(hits);
  const baseline = readBaseline(root);
  const findings: Finding[] = [
    ...allowFindings,
    ...(baseline.unreadable ? [{ level: 'error' as const, message: baseline.unreadable }] : []),
    ...baseline.malformed.map((line) => ({
      level: 'error' as const,
      message: `${BASELINE_FILE}: "${line}" is not <path>\\t<term>\\t<count> → rewrite it with terms --write-baseline`,
    })),
  ];
  let covered = 0;
  for (const [key, count] of counts) {
    const known = baseline.counts.get(key) ?? 0;
    covered += Math.min(count, known);
    if (count <= known) continue;
    for (const hit of hits
      .filter((entry) => `${entry.path}\t${entry.term.id}` === key)
      .slice(known))
      findings.push({
        level: 'error',
        message: `retired term in ${hit.path}:${hit.line}: "${hit.text}" (${hit.term.id}) → ${hit.term.instead}`,
      });
  }
  for (const [key, known] of baseline.counts) {
    const count = counts.get(key) ?? 0;
    if (count >= known) continue;
    const [path, term] = key.split('\t');
    findings.push({
      level: 'error',
      message:
        count === 0
          ? `${BASELINE_FILE}: ${path} no longer uses ${term} → delete its line`
          : `${BASELINE_FILE}: ${path} uses ${term} ${count}× now, not ${known} → lower its count`,
    });
  }
  if (covered > 0) {
    findings.push({
      level: 'warn',
      message: `${covered} retired-term use${covered === 1 ? '' : 's'} in ${BASELINE_FILE} (not blocking; fix the copy and shrink the baseline)`,
    });
  }
  return { findings, hits, regionHits };
};

/**
 * Writes the baseline from today's uses in docs. Only when there is none yet, or when it only
 * shrinks: a new use is fixed (or, if legitimate, allowed), never baselined. Uses of a term the
 * baseline was not written against (one added to the list since) predate the rule there, and are
 * added; a baseline from a release before the `# terms:` line is read as written against
 * `FIRST_TERMS` and rewritten with the line.
 */
export const writeRetiredTermsBaseline = (root: string): { written: number; refused: string[] } => {
  const counts = countByKey(classify(root).docs);
  const path = join(root, BASELINE_FILE);
  const baseline = readBaseline(root);
  if (baseline.unreadable) return { written: 0, refused: [baseline.unreadable] };
  if (baseline.exists) {
    const refused = [...counts]
      .filter(
        ([key, count]) =>
          count > (baseline.counts.get(key) ?? 0) && baseline.terms.has(key.split('\t')[1]),
      )
      .map(
        ([key, count]) =>
          `${key.replace('\t', ' ')} ${count}× (baseline ${baseline.counts.get(key) ?? 0})`,
      );
    if (refused.length > 0) return { written: 0, refused };
  }
  const lines = [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => `${key}\t${count}`);
  if (lines.length === 0) {
    rmSync(path, { force: true });
    return { written: 0, refused: [] };
  }
  const header = [
    '# Retired-term uses that predate the rule: reported, not failed (@inixiative/config check).',
    '# One per line: <path>\\t<term>\\t<count>. Fix the copy and lower or delete its line.',
    '# Rewrite after fixing: inixiative-config terms --write-baseline (it refuses to grow).',
    `# terms: ${RETIRED_TERMS.map((term) => term.id).join(' ')}`,
  ];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${[...header, ...lines].join('\n')}\n`);
  return { written: lines.length, refused: [] };
};
