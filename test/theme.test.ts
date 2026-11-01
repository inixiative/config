import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = join(import.meta.dir, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const code = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const pkg = JSON.parse(read('package.json')) as {
  files: string[];
  exports: Record<string, unknown>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

const defined = (css: string) => new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
const used = (css: string) => new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
const blocks = (css: string, selector: string) => {
  const match = css.match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`));
  return match ? defined(match[1] ?? '') : new Set<string>();
};

const publicCss = code(read('theme/public.css'));
const agenticCss = code(read('theme/agentic.css'));

describe('theme', () => {
  test('ships and exports both stylesheets and the fonts', () => {
    expect(pkg.files).toContain('theme');
    expect(pkg.exports['./theme/public.css']).toBe('./theme/public.css');
    expect(pkg.exports['./theme/agentic.css']).toBe('./theme/agentic.css');
    expect(pkg.exports['./theme/fonts/*']).toBe('./theme/fonts/*');
  });

  test('every font public.css loads exists beside it, with its licence', () => {
    const urls = [...publicCss.matchAll(/url\("(\.\/fonts\/[^"]+)"\)/g)].map((m) => m[1] ?? '');
    expect(urls.length).toBe(3);
    const licences = read('theme/fonts/LICENSES.md');
    for (const url of urls) {
      expect(existsSync(join(root, 'theme', url))).toBe(true);
      expect(licences).toContain(url.replace('./fonts/', ''));
    }
    expect(dirname(urls[0] ?? '')).toBe('./fonts');
  });

  test('every variable either stylesheet uses is defined by the theme', () => {
    const all = new Set([...defined(publicCss), ...defined(agenticCss)]);
    for (const name of [...used(publicCss), ...used(agenticCss)]) expect(all).toContain(name);
  });

  test('light and dark define the same tokens', () => {
    for (const css of [publicCss, agenticCss]) {
      const light = blocks(css, ':root');
      const dark = blocks(css, '.dark');
      for (const name of dark) expect(light).toContain(name);
    }
  });

  test('the status layer names every category', () => {
    for (const status of ['problem', 'attention', 'working', 'queued', 'done', 'idle', 'archived'])
      expect(defined(agenticCss)).toContain(`--status-${status}`);
  });
});

// Apps load the theme at runtime, so installing this package must stay cheap.
describe('this package stays light enough to be a runtime dependency', () => {
  test('no runtime dependencies', () => {
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  });

  test('every peer is optional', () => {
    for (const peer of Object.keys(pkg.peerDependencies ?? {}))
      expect(pkg.peerDependenciesMeta?.[peer]?.optional).toBe(true);
  });
});
