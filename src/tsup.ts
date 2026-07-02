import { defineConfig, type Options } from 'tsup';

const base: Options = {
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  splitting: false,
  sourcemap: true,
  clean: true,
};

export const node = (options: Options = {}) => defineConfig({ ...base, ...options });

export const react = (options: Options = {}) => {
  const external = Array.isArray(options.external) ? options.external : [];
  return defineConfig({
    ...base,
    ...options,
    external: [...new Set(['react', 'react-dom', 'react/jsx-runtime', ...external])],
  });
};
