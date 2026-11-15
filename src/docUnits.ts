/**
 * The region builder's doc units, cut the way it cuts them, so a region's part-4 copy can be
 * compared with the doc it came from. A port of the builder's `units.py` (`doc_units`, `sections`,
 * `strip_do_not_copy`, `slug`) and `assemble.py` (`demote`, the part-4 source line); the builder
 * lives outside the repos (`~/.foundry/evals/setup-practice/pipeline/`), so the two must change
 * together. Python counts and slices by code point, so lengths here do too.
 */

export type DocUnit = {
  /** `doc:<path>#<h2 slug>`, or `…#<h2 slug>/<h3 slug>` for a part split off a large H2. */
  id: string;
  path: string;
  h1: string;
  heading: string;
  text: string;
};

/** An H2 section over this many tokens (code points / 4) is split at H3. */
const SPLIT_H3 = 2500;
const DROPPED_HEADINGS = new Set(['contents', 'table of contents']);
const PREFACE = '(preface)';

// Python's whitespace (`str.strip`, `\s`), digits and word characters, which differ from JS's on a few
// code points (U+FEFF, U+001C–U+001F, U+0085).
const WS =
  '[\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const LEADING_WS = new RegExp(`^${WS}+`);
const TRAILING_WS = new RegExp(`${WS}+$`);
const lstrip = (text: string): string => text.replace(LEADING_WS, '');
const rstrip = (text: string): string => text.replace(TRAILING_WS, '');
const strip = (text: string): string => lstrip(rstrip(text));
const WORD_END = '(?![\\p{L}\\p{N}_])';

const tokens = (text: string): number => Math.floor(Array.from(text).length / 4);
export const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Python's text-mode read: every line ending becomes `\n`. */
export const normaliseNewlines = (text: string): string => text.replace(/\r\n?/g, '\n');

const sections = (lines: string[], level: number): [string, string[]][] => {
  const heading = new RegExp(`^${'#'.repeat(level)}${WS}+([^\\n]+)$`, 'u');
  let fence = false;
  let current: [string, string[]] = ['', []];
  const out: [string, string[]][] = [];
  for (const line of lines) {
    if (line.startsWith('```')) fence = !fence;
    const match = fence ? null : heading.exec(line);
    if (match) {
      out.push(current);
      current = [strip(match[1]), [line]];
    } else current[1].push(line);
  }
  out.push(current);
  return out;
};

const HEADING = new RegExp(`^(#{1,6})${WS}+([^\\n]*)$`, 'u');
const DO_NOT_COPY = new RegExp(
  `^${WS}*(?:[-*+]${WS}+|>${WS}*)?(?:\\*\\*|__)?do not copy${WORD_END}`,
  'iu',
);
const DO_NOT_COPY_HEADING = new RegExp(`(?<![\\p{L}\\p{N}_])do not copy${WORD_END}`, 'iu');
const LIST_ITEM = new RegExp(`^${WS}*[-*+]${WS}`, 'u');
const LIST_LINE = new RegExp(`^${WS}*([-*+]|\\p{Nd}+\\.)${WS}`, 'u');

/**
 * Drops a doc's "Do not copy" material the way the builder does: a section whose heading says it
 * (to the next heading of its level or higher), and a paragraph or list item that starts with it
 * (with the list a trailing colon introduces).
 */
export const stripDoNotCopy = (text: string): string => {
  const lines = text.split('\n');
  const out: string[] = [];
  let fence = false;
  let dropLevel = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = lstrip(line);
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) fence = !fence;
    const heading = fence ? null : HEADING.exec(line);
    if (dropLevel) {
      if (heading && heading[1].length <= dropLevel) dropLevel = 0;
      else {
        i += 1;
        continue;
      }
    }
    if (heading && DO_NOT_COPY_HEADING.test(heading[2])) {
      dropLevel = heading[1].length;
      i += 1;
      continue;
    }
    if (!fence && DO_NOT_COPY.test(line)) {
      const item = LIST_ITEM.test(line);
      let j = i + 1;
      while (
        j < lines.length &&
        strip(lines[j]) &&
        !HEADING.test(lines[j]) &&
        !(item && LIST_ITEM.test(lines[j]))
      )
        j += 1;
      if (rstrip(lines[j - 1]).endsWith(':')) {
        let k = j;
        while (k < lines.length && !strip(lines[k])) k += 1;
        if (k < lines.length && LIST_LINE.test(lines[k])) {
          j = k;
          while (
            j < lines.length &&
            (LIST_LINE.test(lines[j]) ||
              ((lines[j].startsWith(' ') || lines[j].startsWith('\t')) && strip(lines[j])))
          )
            j += 1;
        }
      }
      i = j;
      continue;
    }
    out.push(line);
    i += 1;
  }
  return out.join('\n');
};

/** A doc's units: split at H2, an H2 over the token limit at H3; empty, contents and tiny prefaces dropped. */
export const cutDocUnits = (text: string, path: string): DocUnit[] => {
  const lines = text.split('\n');
  const h1Line = lines.find((line) => line.startsWith('# '));
  const h1 = h1Line === undefined ? path : strip(h1Line.slice(2));
  const units: DocUnit[] = [];
  sections(lines, 2).forEach(([found, body], index) => {
    const bodyText = strip(body.join('\n'));
    if (!bodyText) return;
    const heading = index === 0 ? PREFACE : found;
    if (DROPPED_HEADINGS.has(heading.toLowerCase())) return;
    if (heading === PREFACE && tokens(bodyText) < 40) return;
    if (tokens(bodyText) <= SPLIT_H3) {
      units.push({ id: `doc:${path}#${slug(heading)}`, path, h1, heading, text: bodyText });
      return;
    }
    sections(body, 3).forEach(([h3, part], partIndex) => {
      const partText = strip(part.join('\n'));
      if (!partText) return;
      units.push({
        id: `doc:${path}#${slug(heading)}${partIndex === 0 ? '' : `/${slug(h3)}`}`,
        path,
        h1,
        heading: partIndex === 0 ? heading : `${heading} › ${h3}`,
        text: partText,
      });
    });
  });
  return units;
};

const DEMOTED = new RegExp(`^#{1,4}${WS}`, 'u');

/** A unit as part 4 shows it: H1–H4 outside fences moved down two levels. */
export const demote = (text: string): string => {
  let fence = false;
  return text
    .split('\n')
    .map((line) => {
      if (line.startsWith('```')) fence = !fence;
      return !fence && DEMOTED.test(line) ? `##${line}` : line;
    })
    .join('\n');
};

/** The line part 4 puts above each unit. */
export const sourceLine = (unit: DocUnit): string =>
  `**Source:** \`${unit.path}\` § ${unit.heading} (in "${unit.h1}")`;
