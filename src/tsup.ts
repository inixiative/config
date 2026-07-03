import { defineConfig, type Options } from 'tsup';

const base: Options = {
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  splitting: false,
  sourcemap: true,
  clean: true,
};

// `dts: true` would drop the ignoreDeprecations that keeps tsup's injected
// baseUrl from failing dts builds on TS 6 — normalize it back to the base form.
const withDts = (options: Options): Options =>
  options.dts === true ? { ...options, dts: base.dts } : options;

export const node = (options: Options = {}) => defineConfig({ ...base, ...withDts(options) });

export const react = (options: Options = {}) => {
  const external = Array.isArray(options.external) ? options.external : [];
  return defineConfig({
    ...base,
    ...withDts(options),
    external: [...new Set(['react', 'react-dom', 'react/jsx-runtime', ...external])],
  });
};
