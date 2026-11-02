import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
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
 * Deliberately absent, each because a pattern would flag mostly legitimate text:
 * - "medical" / "healthcare": the doctor's-visit story is allowed in marketing (CLAUDE.md
 *   2026-10-12); only the dead demo's identifiers are listed.
 * - "Connection" as a word: WebSocket and database connections are everywhere; only the dead
 *   model's field name `connectionId` is listed.
 * - "principal": the permissions README uses it as the glossary word for any holder, beside
 *   job titles ("principal engineer") and the principal–agent problem in governance prose.
 * - "Cursor as a runtime", "token savings": a phrase can't tell a claim from a comparison.
 */
export type RetiredTerm = {
  id: string;
  pattern: RegExp;
  scope: 'public' | 'docs';
  instead: string;
};

export const RETIRED_TERMS: readonly RetiredTerm[] = [
  {
    id: 'kastle',
    pattern: /\bkastles?\b/gi,
    scope: 'docs',
    instead: 'Kingdom, owner, integration or Signet',
  },
  {
    id: 'castle',
    pattern: /\bCastles?\b/g,
    scope: 'docs',
    instead: 'Kingdom, owner, integration or Signet',
  },
  {
    id: 'connection-id',
    pattern: /\bconnectionIds?\b/g,
    scope: 'docs',
    instead: 'integrationId (Connection was folded into Integration)',
  },
  {
    id: 'runtime-keys',
    pattern: /\bRuntimeInstallations?\b|\bkingdom_runtime_/g,
    scope: 'docs',
    instead: 'a Signet enrollment on the Foundry integration',
  },
  {
    id: 'medical-demo',
    pattern: /\bsignetDemo\b|\bmedicalQuestionStep\b/g,
    scope: 'docs',
    instead: 'nothing: the demo is gone (demos live in template-workbench)',
  },
  {
    id: 'retired-workspaces',
    pattern: /\bkingdom-workspace\b|\bfoundry-lab\b|\bnative-candidate\b/g,
    scope: 'docs',
    instead: 'the canonical repos (kingdom, foundry)',
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
];

export const RETIRED_TERMS_DIR = 'scripts/ci/retired-terms';
const ALLOW_FILE = `${RETIRED_TERMS_DIR}/allow.txt`;
const BASELINE_FILE = `${RETIRED_TERMS_DIR}/baseline.txt`;

const TEXT_FILE = /\.(md|mdx|html|astro)$/i;
const PUBLIC_FILE = /(^|\/)README[^/]*\.md$|\.(html|astro|mdx)$/i;
// Test data and history: fixtures hold the words on purpose, and a changelog records the rename.
const SKIPPED =
  /(^|\/)(node_modules|\.git|\.worktrees|dist|build|coverage|tmp|fixtures|rule-violations)\/|(^|\/)CHANGELOG[^/]*\.md$/i;

export type RetiredTermHit = { path: string; line: number; term: RetiredTerm; text: string };

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

/** Every retired term in the repo's readable text, before the allow list. */
export const scanRetiredTerms = (root: string): RetiredTermHit[] => {
  const hits: RetiredTermHit[] = [];
  for (const path of listFiles(root).sort()) {
    if (SKIPPED.test(path) || path.startsWith(`${RETIRED_TERMS_DIR}/`)) continue;
    const isManifest = /(^|\/)package\.json$/.test(path);
    if (!isManifest && !TEXT_FILE.test(path)) continue;
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
    for (const term of RETIRED_TERMS) {
      if (term.scope === 'public' && !isPublic) continue;
      for (const match of text.matchAll(term.pattern)) {
        hits.push({
          path,
          line: isManifest ? lineOf(raw, raw.indexOf('"description"')) : lineOf(text, match.index),
          term,
          text: match[0],
        });
      }
    }
  }
  return hits;
};

const readList = (root: string, file: string): string[] => {
  const abs = join(root, file);
  if (!existsSync(abs)) return [];
  return readFileSync(abs, 'utf8')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'));
};

/**
 * `<term>` allows a term everywhere; `<path>\t<term>` in one file, or under a directory when the
 * path ends in `/`. For legitimate uses only (a retired-names table, an icon name); stale copy
 * belongs in the baseline until it is fixed.
 */
const allowedBy = (lines: string[]) => {
  const rules = lines.map((line) => {
    const [first, second] = line.split('\t');
    return second === undefined
      ? { path: '', term: first.trim() }
      : { path: first, term: second.trim() };
  });
  return (hit: RetiredTermHit) =>
    rules.some(
      (rule) =>
        rule.term === hit.term.id &&
        (rule.path === '' ||
          rule.path === hit.path ||
          (rule.path.endsWith('/') && hit.path.startsWith(rule.path))),
    );
};

const countByKey = (hits: RetiredTermHit[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const hit of hits) {
    const key = `${hit.path}\t${hit.term.id}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

const readBaseline = (root: string): Map<string, number> =>
  new Map(
    readList(root, BASELINE_FILE).map((line) => {
      const [path, term, count] = line.split('\t');
      return [`${path}\t${term}`, Number(count)] as const;
    }),
  );

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
  const allowed = allowedBy(readList(root, ALLOW_FILE));
  const hits = scanRetiredTerms(root).filter((hit) => !allowed(hit));
  const counts = countByKey(hits);
  const baseline = readBaseline(root);
  const findings: Finding[] = [];

  for (const [key, count] of counts) {
    const known = baseline.get(key) ?? 0;
    if (count <= known) continue;
    const fresh = hits.filter((hit) => `${hit.path}\t${hit.term.id}` === key).slice(known);
    for (const hit of fresh) {
      findings.push({
        level: 'error',
        message: `retired term in ${hit.path}:${hit.line}: "${hit.text}" (${hit.term.id}) → ${hit.term.instead}`,
      });
    }
  }
  for (const [key, known] of baseline) {
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
  const baselined = [...counts].reduce(
    (sum, [key, count]) => sum + Math.min(count, baseline.get(key) ?? 0),
    0,
  );
  if (baselined > 0) {
    findings.push({
      level: 'warn',
      message: `${baselined} retired-term use${baselined === 1 ? '' : 's'} in ${BASELINE_FILE} (not blocking; fix the copy and shrink the baseline)`,
    });
  }
  return { findings, hits };
};

/**
 * Writes the baseline from today's uses. Only when there is none yet, or when it only shrinks:
 * a new use is fixed (or, if legitimate, allowed), never baselined.
 */
export const writeRetiredTermsBaseline = (root: string): { written: number; refused: string[] } => {
  const allowed = allowedBy(readList(root, ALLOW_FILE));
  const counts = countByKey(scanRetiredTerms(root).filter((hit) => !allowed(hit)));
  const path = join(root, BASELINE_FILE);
  if (existsSync(path)) {
    const baseline = readBaseline(root);
    const refused = [...counts]
      .filter(([key, count]) => count > (baseline.get(key) ?? 0))
      .map(
        ([key, count]) =>
          `${key.replace('\t', ' ')} ${count}× (baseline ${baseline.get(key) ?? 0})`,
      );
    if (refused.length > 0) return { written: 0, refused };
  }
  const header = [
    '# Retired-term uses that predate the rule: reported, not failed (@inixiative/config check).',
    '# One per line: <path>\\t<term>\\t<count>. Fix the copy and lower or delete its line.',
    '# Rewrite after fixing: inixiative-config terms --write-baseline (it refuses to grow).',
  ];
  const lines = [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, n]) => `${key}\t${n}`);
  if (lines.length === 0) {
    rmSync(path, { force: true });
    return { written: 0, refused: [] };
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${[...header, ...lines].join('\n')}\n`);
  return { written: lines.length, refused: [] };
};
