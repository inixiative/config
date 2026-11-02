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

const values = (css: string) =>
  new Map([...css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], (m[2] ?? '').trim()]));
const blockText = (css: string, selector: string) =>
  css.match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

const publicCss = code(read('theme/public.css'));
const statusCss = code(read('theme/status.css'));
const domainsCss = code(read('theme/domains.css'));
const marketingCss = code(read('theme/marketing.css'));
const sheets = [publicCss, statusCss, domainsCss, marketingCss];

const domains = ['agentic', 'building-blocks', 'governance', 'inixiative'];
const slots = ['primary', 'secondary', 'tertiary', 'quaternary'];

const hslToRgb = (channels: string) => {
  const [h = 0, s = 0, l = 0] = channels.replace(/%/g, '').split(/\s+/).map(Number);
  const k = (n: number) => (n + h / 30) % 12;
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => l / 100 - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)].map((x) => Math.round(x * 255) / 255);
};
const luminance = (channels: string) => {
  const [r = 0, g = 0, b = 0] = hslToRgb(channels).map((x) =>
    x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};

describe('theme', () => {
  test('ships and exports every stylesheet and the fonts', () => {
    expect(pkg.files).toContain('theme');
    expect(pkg.files).not.toContain('demo');
    for (const sheet of ['public', 'status', 'domains', 'marketing'])
      expect(pkg.exports[`./theme/${sheet}.css`]).toBe(`./theme/${sheet}.css`);
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

  test('every variable a stylesheet uses is defined by the theme', () => {
    const all = new Set(sheets.flatMap((css) => [...defined(css)]));
    for (const name of sheets.flatMap((css) => [...used(css)])) expect(all).toContain(name);
  });

  test('light and dark define the same tokens', () => {
    for (const css of [publicCss, statusCss, domainsCss]) {
      const light = blocks(css, ':root');
      const dark = blocks(css, '.dark');
      for (const name of dark) expect(light).toContain(name);
    }
  });

  test('the status layer names every category', () => {
    for (const status of ['problem', 'attention', 'working', 'queued', 'done', 'idle', 'archived'])
      expect(defined(statusCss)).toContain(`--status-${status}`);
  });
});

describe('domain palettes', () => {
  test('every domain maps all four slots, their foregrounds and the ring', () => {
    for (const domain of domains) {
      const mapped = defined(blockText(domainsCss, `\\[data-domain="${domain}"\\]`));
      for (const slot of slots) {
        expect(mapped).toContain(`--app-${slot}`);
        expect(mapped).toContain(`--app-${slot}-foreground`);
      }
      expect(mapped).toContain('--ring');
    }
  });

  test('the mappings hold no colour of their own, so they work in both modes and nested', () => {
    for (const domain of domains)
      for (const value of values(blockText(domainsCss, `\\[data-domain="${domain}"\\]`)).values())
        expect(value).toMatch(/^var\(--[\w-]+\)$/);
  });

  test('agentic is exactly public.css', () => {
    for (const mode of [':root', '.dark']) {
      const base = values(blockText(publicCss, mode));
      const agentic = values(blockText(domainsCss, mode));
      for (const slot of slots) {
        expect(agentic.get(`--agentic-${slot}`)).toBe(base.get(`--app-${slot}`));
        expect(agentic.get(`--agentic-${slot}-foreground`)).toBe(
          base.get(`--app-${slot}-foreground`),
        );
      }
      expect(agentic.get('--agentic-ring')).toBe(base.get('--ring'));
    }
  });

  test('inixiative wears the three domain primaries as its other slots', () => {
    const mapped = values(blockText(domainsCss, '\\[data-domain="inixiative"\\]'));
    expect(mapped.get('--app-secondary')).toBe('var(--agentic-primary)');
    expect(mapped.get('--app-tertiary')).toBe('var(--building-blocks-primary)');
    expect(mapped.get('--app-quaternary')).toBe('var(--governance-primary)');
  });

  test('accents are AA text on the background and card, and their foregrounds are AA on them', () => {
    for (const mode of [':root', '.dark']) {
      const base = values(blockText(publicCss, mode));
      const palette = values(blockText(domainsCss, mode));
      for (const surface of ['--background', '--card']) {
        const ground = base.get(surface) ?? '';
        for (const [name, value] of palette) {
          if (name.endsWith('-foreground') || name.endsWith('-ring') || name.endsWith('-secondary'))
            continue;
          expect({ name, mode, surface, ratio: contrast(value, ground) >= 4.5 }).toEqual({
            name,
            mode,
            surface,
            ratio: true,
          });
          const ink = palette.get(`${name}-foreground`) ?? '';
          expect({ name, mode, onAccent: contrast(ink, value) >= 4.5 }).toEqual({
            name,
            mode,
            onAccent: true,
          });
        }
      }
    }
  });
});

describe('marketing grammar', () => {
  test('holds no colour of its own: every colour reads a theme token', () => {
    expect(marketingCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(marketingCss).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch)\(\s*\d/i);
  });

  test('every motion duration drops to zero under prefers-reduced-motion', () => {
    const durations = [...defined(blockText(marketingCss, ':root'))].filter((name) =>
      name.startsWith('--duration-'),
    );
    const reduced = marketingCss.split('prefers-reduced-motion')[1] ?? '';
    for (const name of durations.filter((name) => name !== '--duration-live'))
      expect(reduced).toContain(`${name}: 0ms`);
    expect(reduced).toContain('--lift: 0px');
    expect(reduced).toContain('animation: none');
  });

  test('shared classes sit in @layer components, every selector scoped to :where(.marketing)', () => {
    const layered = marketingCss.split('@layer components {')[1] ?? '';
    expect(layered).not.toBe('');
    const selectors = [...layered.matchAll(/([^{};]+)\{/g)]
      .map((m) => (m[1] ?? '').trim())
      .filter((sel) => sel && !sel.startsWith('@') && !/^\d+%$/.test(sel));
    for (const list of selectors)
      for (const selector of list.split(/,(?![^(]*\))/).map((part) => part.trim()))
        expect(selector).toMatch(/^:where\((\.marketing|\.dark \.marketing)/);
    for (const cls of [
      'eyebrow',
      'button',
      'button-secondary',
      'nav',
      'footer',
      'section',
      'card',
      'prose',
    ])
      expect(layered).toContain(`:where(.marketing) .${cls}`);
  });

  test('no token shadows a Tailwind theme name', () => {
    for (const name of defined(marketingCss))
      expect(name).not.toMatch(/^--(radius|text|leading|tracking)-(xs|sm|md|lg|xl|\dxl|base)$/);
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
