import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * A shrink-only baseline: known findings that predate a rule, one `<key>\t<count>` per line, where
 * the key is `keyFields` tab-separated fields. A count above the baseline fails, and so does one
 * below it (lower or delete the line), so the file only ever shrinks.
 */

/** A list file's lines, without blanks and `#` comments. */
export const readList = (root: string, file: string): string[] => {
  const abs = join(root, file);
  if (!existsSync(abs)) return [];
  return readFileSync(abs, 'utf8')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'));
};

export type Baseline = { counts: Map<string, number>; malformed: string[] };

export const readBaseline = (root: string, file: string, keyFields: number): Baseline => {
  const counts = new Map<string, number>();
  const malformed: string[] = [];
  const shape = new RegExp(`^((?:[^\\t]+\\t){${keyFields - 1}}[^\\t]+)\\t(\\d+)$`);
  for (const line of readList(root, file)) {
    const match = shape.exec(line);
    if (match) counts.set(match[1], Number(match[2]));
    else malformed.push(line);
  }
  return { counts, malformed };
};

export type BaselineComparison = {
  /** Keys counted above the baseline: `known` of `count` are covered. */
  over: { key: string; count: number; known: number }[];
  /** Baseline entries whose count dropped (`count` 0: the key is gone). */
  under: { key: string; count: number; known: number }[];
  /** Findings the baseline covers. */
  covered: number;
};

export const compareBaseline = (
  counts: Map<string, number>,
  baseline: Map<string, number>,
): BaselineComparison => {
  const over: BaselineComparison['over'] = [];
  const under: BaselineComparison['under'] = [];
  let covered = 0;
  for (const [key, count] of counts) {
    const known = baseline.get(key) ?? 0;
    covered += Math.min(count, known);
    if (count > known) over.push({ key, count, known });
  }
  for (const [key, known] of baseline) {
    const count = counts.get(key) ?? 0;
    if (count < known) under.push({ key, count, known });
  }
  return { over, under, covered };
};

/**
 * Writes the baseline from today's counts. Only when there is none yet, or when it only shrinks,
 * except for keys `mayGrow` admits: a new finding is fixed, never baselined.
 */
export const writeBaseline = (
  root: string,
  file: string,
  {
    counts,
    keyFields,
    header,
    mayGrow = () => false,
  }: {
    counts: Map<string, number>;
    keyFields: number;
    header: string[];
    mayGrow?: (key: string) => boolean;
  },
): { written: number; refused: string[] } => {
  const path = join(root, file);
  if (existsSync(path)) {
    const { counts: baseline } = readBaseline(root, file, keyFields);
    const refused = [...counts]
      .filter(([key, count]) => count > (baseline.get(key) ?? 0) && !mayGrow(key))
      .map(
        ([key, count]) =>
          `${key.replaceAll('\t', ' ')} ${count}× (baseline ${baseline.get(key) ?? 0})`,
      );
    if (refused.length > 0) return { written: 0, refused };
  }
  const lines = [...counts]
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => `${key}\t${count}`);
  if (lines.length === 0) {
    rmSync(path, { force: true });
    return { written: 0, refused: [] };
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${[...header, ...lines].join('\n')}\n`);
  return { written: lines.length, refused: [] };
};
