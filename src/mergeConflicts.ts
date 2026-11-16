import { join } from 'node:path';
import type { Finding } from './lib';
import { DEPENDENCIES_AND_BUILD_OUTPUT, listRepoFilesNotSkipped, readText } from './retiredTerms';

const OPENING_MARKER = /^<{7}(?: |$)/;
const CLOSING_MARKER = /^>{7}(?: |$)/;

export type MergeConflictBlock = { line: number; closed: boolean };

/**
 * Each conflict block in the text, at the line of its opening marker (seven `<`, then a space or
 * the line's end) through its closing marker (seven `>`, the same); a closing marker with no
 * opening is a block of its own. The separator (`=======`) and diff3 base marker (seven `|`) are
 * part of the block they sit in and never a block alone: a bare `=======` is a Markdown heading
 * underline.
 */
export const findMergeConflictBlocksInText = (text: string): MergeConflictBlock[] => {
  const blocks: MergeConflictBlock[] = [];
  let open: number | null = null;
  for (const [index, raw] of text.split('\n').entries()) {
    const line = raw.replace(/\r$/, '');
    if (OPENING_MARKER.test(line)) {
      if (open !== null) blocks.push({ line: open, closed: false });
      open = index + 1;
    } else if (CLOSING_MARKER.test(line)) {
      blocks.push({ line: open ?? index + 1, closed: open !== null });
      open = null;
    }
  }
  if (open !== null) blocks.push({ line: open, closed: false });
  return blocks;
};

/**
 * Fails on every unresolved merge conflict in the repo's text files (tracked or untracked but not
 * ignored), fixtures and changelogs included; only dependencies, build output and binary files are
 * not read. There is no allow list or baseline: no committed conflict block is legitimate.
 */
export const checkUnresolvedMergeConflicts = (root: string): Finding[] => {
  const findings: Finding[] = [];
  for (const path of listRepoFilesNotSkipped(root, DEPENDENCIES_AND_BUILD_OUTPUT)) {
    const text = readText(join(root, path));
    if (text === null || text.includes('\0')) continue;
    for (const block of findMergeConflictBlocksInText(text))
      findings.push({
        level: 'error',
        message: `unresolved merge conflict in ${path}:${block.line}${block.closed ? '' : ' (its markers are incomplete)'} → resolve it: keep the lines you want and delete the marker lines`,
      });
  }
  return findings;
};
