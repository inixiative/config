import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareBaseline, readBaseline, readList, writeBaseline } from './baseline';
import type { Finding } from './lib';
import {
  freshUnits,
  OWN_REGIONS_DIR,
  scanRegionFreshness,
  unitCopies,
  unitPath,
} from './regionFreshness';

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
  /** The whole line the hit is on. */
  lineText: string;
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
    const lineTextAt = (index: number) => {
      const end = text.indexOf('\n', index);
      return text.slice(text.lastIndexOf('\n', index - 1) + 1, end === -1 ? undefined : end);
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
          copiedFrom: copiedFrom(match.index),
        });
      }
    }
  }
  return hits.sort((a, b) => (a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1));
};

/**
 * Hits in generated region files, one finding per region (or per regions directory, for the set's
 * own files): the fix is a rebuild, so no line is named to edit.
 */
const rebuildFindings = (hits: RetiredTermHit[]): Finding[] => {
  const groups = new Map<string, RetiredTermHit[]>();
  for (const hit of hits) {
    const generated = regionFileOf(hit.path);
    if (!generated) continue;
    const key = generated.region ? `${generated.dir}/${generated.region}` : generated.dir;
    groups.set(key, [...(groups.get(key) ?? []), hit]);
  }
  return [...groups].map(([key, group]) => {
    const generated = regionFileOf(group[0].path);
    const files = new Map<string, number>();
    for (const hit of group) {
      const file = hit.path.slice(hit.path.lastIndexOf('/') + 1);
      files.set(file, (files.get(file) ?? 0) + 1);
    }
    const terms = [...new Map(group.map((hit) => [hit.term.id, hit.term])).values()];
    const names = [...new Set(group.map((hit) => hit.text))];
    const target = generated?.region
      ? `rebuild region ${generated.region}`
      : `rebuild the regions in ${key}`;
    const elsewhere =
      generated?.dir === OWN_REGIONS_DIR
        ? ''
        : ` in the repo whose docs ${generated?.dir} was built from, then copy it here`;
    return {
      level: 'error' as const,
      message: `retired names in ${generated?.region ? `region ${key}` : `${key} (the set's own files)`}: ${names
        .slice(0, 4)
        .map((name) => `"${name}"`)
        .join(
          ', ',
        )}${names.length > 4 ? ` and ${names.length - 4} more` : ''} (${[...files].map(([file, n]) => `${file} ×${n}`).join(', ')}) → ${target}${elsewhere} (generated from the docs: never edit it by hand; fix any source doc that still says this first). Today: ${terms.map((term) => `${term.id}: ${term.instead}`).join('; ')}`,
    };
  });
};

/**
 * `<term>` allows a term everywhere; `<path>\t<term>` in one file, or under a directory when the
 * path ends in `/` (a file that is history as a whole: a dated record, a review); and
 * `<path>\t<term>\t"<snippet>"` only on a line of that file holding the snippet (one history
 * mention in a live doc, wherever the line moves). For legitimate uses only; stale copy belongs in
 * the baseline until it is fixed. A region's verbatim copy of an allowed line is allowed with it
 * while the regions check finds that copy fresh: a stale copy carrying a retired name is not.
 */
type AllowRule = { path: string; term: string; snippet?: string };

const SNIPPET = /^"(.+)"$/;

const parseAllow = (lines: string[]): { rules: AllowRule[]; malformed: string[] } => {
  const rules: AllowRule[] = [];
  const malformed: string[] = [];
  for (const line of lines) {
    const fields = line.split('\t');
    if (fields.length === 1) rules.push({ path: '', term: fields[0].trim() });
    else if (fields.length === 2) rules.push({ path: fields[0], term: fields[1].trim() });
    else {
      const snippet = fields.length === 3 ? SNIPPET.exec(fields[2].trim()) : null;
      if (snippet) rules.push({ path: fields[0], term: fields[1].trim(), snippet: snippet[1] });
      else malformed.push(line);
    }
  }
  return { rules, malformed };
};

const allowedBy = (rules: AllowRule[], fresh: Set<string>) => {
  const covers = (rulePath: string, path: string) =>
    rulePath === path || (rulePath.endsWith('/') && path.startsWith(rulePath));
  const freshCopy = (hit: RetiredTermHit) => {
    const region = regionFileOf(hit.path);
    return (
      hit.copiedFrom !== undefined &&
      region?.region !== undefined &&
      fresh.has(`${region.dir}/${region.region}\t${hit.copiedFrom.unit}`)
    );
  };
  return (hit: RetiredTermHit) =>
    rules.some(
      (rule) =>
        rule.term === hit.term.id &&
        (rule.snippet === undefined || hit.lineText.includes(rule.snippet)) &&
        (rule.path === '' ||
          covers(rule.path, hit.path) ||
          (hit.copiedFrom !== undefined &&
            covers(rule.path, hit.copiedFrom.path) &&
            freshCopy(hit))),
    );
};

const allowList = (root: string) => {
  const { rules, malformed } = parseAllow(readList(root, ALLOW_FILE));
  return { allowed: allowedBy(rules, freshUnits(scanRegionFreshness(root).regions)), malformed };
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

export type RetiredTermsResult = {
  findings: Finding[];
  /** Uses outside the allow list, before the baseline. */
  hits: RetiredTermHit[];
};

/**
 * Fails on a retired term the baseline doesn't cover, and on a baseline entry whose uses dropped
 * (lower or delete it), so the baseline only shrinks. Baselined uses are one warning.
 */
export const checkRetiredTerms = (root: string): RetiredTermsResult => {
  const { allowed, malformed: badRules } = allowList(root);
  const hits = scanRetiredTerms(root).filter((hit) => !allowed(hit));
  const counts = countByKey(hits);
  const { counts: baseline, malformed } = readBaseline(root, BASELINE_FILE, 2);
  const findings: Finding[] = [
    ...badRules.map((line) => ({
      level: 'error' as const,
      message: `${ALLOW_FILE}: "${line}" is not <term>, <path>\\t<term> or <path>\\t<term>\\t"<snippet>"`,
    })),
    ...malformed.map((line) => ({
      level: 'error' as const,
      message: `${BASELINE_FILE}: "${line}" is not <path>\\t<term>\\t<count> → rewrite it with terms --write-baseline`,
    })),
  ];
  const { over, under, covered } = compareBaseline(counts, baseline);
  const fresh = over.flatMap(({ key, known }) =>
    hits.filter((hit) => `${hit.path}\t${hit.term.id}` === key).slice(known),
  );
  for (const hit of fresh) {
    if (regionFileOf(hit.path)) continue;
    findings.push({
      level: 'error',
      message: `retired term in ${hit.path}:${hit.line}: "${hit.text}" (${hit.term.id}) → ${hit.term.instead}`,
    });
  }
  findings.push(...rebuildFindings(fresh));
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
 * Writes the baseline from today's uses. Only when there is none yet, or when it only shrinks:
 * a new use is fixed (or, if legitimate, allowed), never baselined. Uses of a term the baseline
 * was not written against (one added to the list since) predate the rule there, and are added;
 * a baseline from a release before the `# terms:` line is read as written against `FIRST_TERMS`
 * and rewritten with the line.
 */
export const writeRetiredTermsBaseline = (root: string): { written: number; refused: string[] } => {
  const { allowed } = allowList(root);
  const counts = countByKey(scanRetiredTerms(root).filter((hit) => !allowed(hit)));
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
