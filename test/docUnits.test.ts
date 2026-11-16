import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cutDocUnits,
  type DocUnit,
  demote,
  normaliseNewlines,
  sourceLine,
  stripDoNotCopy,
  unitCopies,
} from '../src/docUnits';

// expected.json is the region builder's own output for these docs (scripts/doc-units-parity/regenerate.py
// runs units.py's cut and assemble.py's demote and part-4a block); the port must reproduce it exactly.
const fixture = join(import.meta.dir, 'fixtures', 'doc-units-parity');
const expected: {
  docs: Record<string, { units: DocUnit[]; unstripped: DocUnit[]; shown: string[] }>;
  knowledge: string;
} = JSON.parse(readFileSync(join(fixture, 'expected.json'), 'utf8'));

const docs = Object.entries(expected.docs);

describe("the port reproduces the builder's cut", () => {
  for (const [path, cut] of docs) {
    test(path, () => {
      const text = normaliseNewlines(readFileSync(join(fixture, path), 'utf8'));
      expect(cutDocUnits(stripDoNotCopy(text), path)).toEqual(cut.units);
      expect(cutDocUnits(text, path)).toEqual(cut.unstripped);
      expect(cut.units.map((unit) => demote(unit.text))).toEqual(cut.shown);
    });
  }
});

describe("the port reads the builder's part 4a", () => {
  test('every unit is found, in order, as its source line and its demoted text', () => {
    const units = docs.flatMap(([, cut]) => cut.units);
    const copies = unitCopies(expected.knowledge) ?? [];
    expect(copies.map((copy) => copy.unit)).toEqual(units.map((unit) => unit.id));
    expect(copies.map((copy) => copy.body)).toEqual(
      units.map((unit) => `${sourceLine(unit)}\n\n${demote(unit.text)}`),
    );
    for (const copy of copies)
      expect(expected.knowledge.slice(copy.start).startsWith(`<!-- unit ${copy.unit} -->`)).toBe(
        true,
      );
  });

  test('a knowledge.md without part 4a has no copies', () => {
    expect(unitCopies('# A region\n\n## 1. What this Warden covers\n')).toBeNull();
  });
});
