import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cutDocUnits, type DocUnit, normaliseNewlines, stripDoNotCopy } from '../src/docUnits';

// expected.json is the region builder's own cut of these docs (scripts/doc-units-parity/regenerate.py
// runs units.py); the port must reproduce it exactly.
const fixture = join(import.meta.dir, 'fixtures', 'doc-units-parity');
const expected: Record<string, { units: DocUnit[]; unstripped: DocUnit[] }> = JSON.parse(
  readFileSync(join(fixture, 'expected.json'), 'utf8'),
);

describe("the port reproduces the builder's cut", () => {
  for (const [path, cut] of Object.entries(expected)) {
    test(path, () => {
      const text = normaliseNewlines(readFileSync(join(fixture, path), 'utf8'));
      expect(cutDocUnits(stripDoNotCopy(text), path)).toEqual(cut.units);
      expect(cutDocUnits(text, path)).toEqual(cut.unstripped);
    });
  }

  test('the fixture covers the cases the port has to get right', () => {
    const ids = Object.values(expected).flatMap((cut) => cut.units.map((unit) => unit.id));
    expect(ids.some((id) => id.includes('/'))).toBe(true);
    expect(expected['docs/do-not-copy.md'].units).not.toEqual(
      expected['docs/do-not-copy.md'].unstripped,
    );
    expect(expected['docs/edge-cases.md'].units.length).toBeGreaterThan(5);
  });
});
