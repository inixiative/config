import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareBaseline, readBaseline, writeBaseline } from './baseline';
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
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory() && !SKIPPED.test(`${rel}/`)) walk(root, rel, out);
    else if (entry.isFile()) out.push(rel);
  }
  return out;
};

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
 * `allow.txt`, one entry per line, each with a `#` reason above it:
 * - `<term>`: the term everywhere;
 * - `<path>\t<term>`: in one file, or under a directory when the path ends in `/` (a file that is
 *   history as a whole: a dated record, a review, a retired-names table);
 * - `<path>\t<term>\t"<snippet>"`: only the use the snippet quotes, on a line holding it (one
 *   history mention in a live doc, wherever the line moves). The snippet must contain the term.
 * A region's verbatim copy of an allowed line is allowed with it.
 */
type AllowRule = { path: string; term: string; snippet?: string };

const ALLOW_FORMS = '<term>, <path>\\t<term> or <path>\\t<term>\\t"<snippet>" (tab-separated)';

const parseAllow = (root: string): { rules: AllowRule[]; problems: string[] } => {
  const abs = join(root, ALLOW_FILE);
  const rules: AllowRule[] = [];
  const problems: string[] = [];
  if (!existsSync(abs)) return { rules, problems };
  const ids = new Map(RETIRED_TERMS.map((term) => [term.id, term]));
  for (const [index, raw] of readFileSync(abs, 'utf8').split('\n').entries()) {
    const line = raw.trimEnd();
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const at = `${ALLOW_FILE}:${index + 1}`;
    const fields = line.split('\t');
    const wrong = (why: string) => problems.push(`${at}: ${why} → write ${ALLOW_FORMS}`);
    if (fields.length > 3 || fields.some((field) => field.trim() === '')) {
      wrong(`"${line}" is not an allow entry`);
      continue;
    }
    const [path, term, quoted] =
      fields.length === 1 ? ['', fields[0], undefined] : [fields[0], fields[1], fields[2]];
    if (/\s/.test(term.trim())) {
      wrong(`"${line}" is not an allow entry (its fields are not tab-separated)`);
      continue;
    }
    const declared = ids.get(term.trim());
    if (!declared) {
      wrong(
        `"${term.trim()}" is not a retired term (${RETIRED_TERMS.map((entry) => entry.id).join(', ')})`,
      );
      continue;
    }
    if (quoted === undefined) {
      rules.push({ path, term: declared.id });
      continue;
    }
    const snippet = /^"(.+)"$/.exec(quoted.trim())?.[1];
    if (snippet === undefined) {
      wrong(`the snippet ${quoted} is not in double quotes`);
      continue;
    }
    if (![...snippet.matchAll(declared.pattern)].length) {
      wrong(`the snippet "${snippet}" does not contain ${declared.id}`);
      continue;
    }
    rules.push({ path, term: declared.id, snippet });
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

const allowedBy = (rules: AllowRule[]) => (hit: RetiredTermHit) =>
  rules.some(
    (rule) =>
      rule.term === hit.term.id &&
      (rule.snippet === undefined || quotes(rule.snippet, hit)) &&
      (rule.path === '' ||
        covers(rule.path, hit.path) ||
        (hit.copiedFrom !== undefined && covers(rule.path, hit.copiedFrom.path))),
  );

/** Retired names in generated region files that no allow entry covers: the regions rule's to report. */
export const regionRetiredHits = (root: string): RetiredTermHit[] => {
  const allowed = allowedBy(parseAllow(root).rules);
  return scanRetiredTerms(root).filter((hit) => regionFileOf(hit.path) && !allowed(hit));
};

const countByKey = (hits: RetiredTermHit[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const hit of hits) {
    const key = `${hit.path}\t${hit.term.id}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

/**
 * The `# terms:` line of a baseline: the terms it was written against. A term added to the list
 * later is one whose uses predate the rule in that repo, so `--write-baseline` may add them. A
 * baseline without the line was written by a release whose list was `FIRST_TERMS`.
 */
const TERMS_LINE = /^# terms: (.*)$/m;
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
const baselineTerms = (root: string): Set<string> | null => {
  const abs = join(root, BASELINE_FILE);
  if (!existsSync(abs)) return null;
  const match = TERMS_LINE.exec(readFileSync(abs, 'utf8'));
  return new Set(match ? match[1].split(/\s+/).filter(Boolean) : FIRST_TERMS);
};

/** Uses in docs (every file but generated regions) that no allow entry covers. */
const docHits = (root: string, rules: AllowRule[]): RetiredTermHit[] => {
  const allowed = allowedBy(rules);
  return scanRetiredTerms(root).filter((hit) => !regionFileOf(hit.path) && !allowed(hit));
};

export type RetiredTermsResult = {
  findings: Finding[];
  /** Uses in docs outside the allow list, before the baseline. */
  hits: RetiredTermHit[];
};

/**
 * Fails on a retired term in a doc that the baseline doesn't cover, on a malformed allow entry,
 * and on a baseline entry whose uses dropped (lower or delete it), so the baseline only shrinks.
 * Baselined uses are one warning. Generated regions are the regions rule's (warnings).
 */
export const checkRetiredTerms = (root: string): RetiredTermsResult => {
  const { rules, problems } = parseAllow(root);
  const hits = docHits(root, rules);
  const counts = countByKey(hits);
  const { counts: baseline, malformed } = readBaseline(root, BASELINE_FILE, 2);
  const findings: Finding[] = [
    ...problems.map((message) => ({ level: 'error' as const, message })),
    ...malformed.map((line) => ({
      level: 'error' as const,
      message: `${BASELINE_FILE}: "${line}" is not <path>\\t<term>\\t<count> → rewrite it with terms --write-baseline`,
    })),
  ];
  const { over, under, covered } = compareBaseline(counts, baseline);
  for (const { key, known } of over) {
    for (const hit of hits
      .filter((entry) => `${entry.path}\t${entry.term.id}` === key)
      .slice(known))
      findings.push({
        level: 'error',
        message: `retired term in ${hit.path}:${hit.line}: "${hit.text}" (${hit.term.id}) → ${hit.term.instead}`,
      });
  }
  for (const { key, count, known } of under) {
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
  return { findings, hits };
};

/**
 * Writes the baseline from today's uses in docs. Only when there is none yet, or when it only
 * shrinks: a new use is fixed (or, if legitimate, allowed), never baselined. Uses of a term the
 * baseline was not written against (one added to the list since) predate the rule there, and are
 * added; a baseline from a release before the `# terms:` line is read as written against
 * `FIRST_TERMS` and rewritten with the line.
 */
export const writeRetiredTermsBaseline = (root: string): { written: number; refused: string[] } => {
  const counts = countByKey(docHits(root, parseAllow(root).rules));
  const known = baselineTerms(root);
  return writeBaseline(root, BASELINE_FILE, {
    counts,
    keyFields: 2,
    mayGrow: (key) => known !== null && !known.has(key.split('\t')[1]),
    header: [
      '# Retired-term uses that predate the rule: reported, not failed (@inixiative/config check).',
      '# One per line: <path>\\t<term>\\t<count>. Fix the copy and lower or delete its line.',
      '# Rewrite after fixing: inixiative-config terms --write-baseline (it refuses to grow).',
      `# terms: ${RETIRED_TERMS.map((term) => term.id).join(' ')}`,
    ],
  });
};
