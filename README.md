# @inixiative/config

Shared toolchain for the inixiative ecosystem: tsconfig/biome/tsup presets, a version manifest (BOM), and a `sync`/`check` CLI that enforces both.

## Presets

| Export | Use |
| --- | --- |
| `@inixiative/config/tsconfig/base.json` | bun library (bundler resolution, verbatimModuleSyntax, `types: ["bun"]`) |
| `@inixiative/config/tsconfig/node.json` | base + `types: ["node"]` |
| `@inixiative/config/tsconfig/react.json` | base + DOM lib + `jsx: react-jsx` |
| `@inixiative/config/biome/base.json` | formatter + linter core (single quotes, lineWidth 100, recommended + strictness block) |
| `@inixiative/config/biome/react.json` | overlay: hook dependency linting |
| `@inixiative/config/tsup` | `node(options)` / `react(options)` build presets |
| `@inixiative/config/lefthook/base.yml` | pre-commit hooks: typecheck + biome on staged files |

Adoption is three stub files plus the devDependency:

```jsonc
// tsconfig.json
{ "extends": "@inixiative/config/tsconfig/base.json", "exclude": ["dist"] }

// biome.json
{ "extends": ["@inixiative/config/biome/base.json"] }
```

```ts
// tsup.config.ts
import { node } from '@inixiative/config/tsup';

export default node();
```

Stubs hold `extends` plus minimal reviewed overrides only. This package never generates config bodies.

## versions.json (the BOM)

One version of `@inixiative/config` names one coherent ecosystem state:

- `bun` — blessed runtime, written to `.bun-version` and `packageManager`
- `toolchain` — exact pins for `@biomejs/biome`, `typescript`, `tsup`, `@types/bun`
- `required` — toolchain packages every repo must carry
- `ecosystem` — the blessed, mutually-verified `@inixiative/*` set

TypeScript 6.0 notes, discovered by this repo's fixture suite:

- TS 6.0 no longer auto-includes `node_modules/@types`, so `base.json` sets `types: ["bun"]` and `@types/bun` is required.
- tsup's dts build trips TS 6.0's `baseUrl` deprecation; the tsup presets scope `ignoreDeprecations: "6.0"` to the dts build only.

## CLI

```
bunx @inixiative/config check [dir] [--preset=base|node|react]
bunx @inixiative/config sync  [dir] [--preset=...] [--force] [--no-install]
bunx @inixiative/config scan  [root]
bunx @inixiative/config train [root]
```

`check` is read-only and exits non-zero on drift — run it in CI after a frozen-lockfile install. It verifies toolchain pins, `"latest"` ranges, `packageManager`/`.bun-version`, legacy `bun.lockb`, a committed (tracked, un-ignored) `bun.lock`, required scripts (`check`/`typecheck`/`lint`/`test`), lefthook (dep + `lefthook.yml` extending the shared hooks + `prepare` script; git repos only), stub `extends`, presence of this package, and for every ecosystem dependency that the declared range admits the blessed version and the lockfile actually resolves to it (the stale-lockfile class).

`sync` applies every fix, re-locks via `bun install`, and runs `bun update` on stale ecosystem entries. It refuses to run on a dirty working tree without `--force`. The react preset is inferred from a `react` dependency; override with `--preset`. Missing scripts are filled with defaults; existing script bodies are never touched.

`scan` runs `check` across every ecosystem checkout under a root directory. Targets are derived from the BOM's `ecosystem` keys and matched by package name, so directory names and local layout never need declaring.

`train` is the release cascade, run from this repo's checkout. It walks the ecosystem in dependency order; per repo it: skips if dirty or behind origin → bumps ecosystem ranges to the BOM → re-locks → runs the repo's `check` → commits only its own changes (`package.json` + `bun.lock`) → publishes via `npm publish` when the local version is ahead of npm (OTP prompts pass through) → records the published version in the BOM. It never pushes; review its commits, push, then commit and publish this package so the BOM names the new state.

Division of labor: this CLI owns the toolchain set, ecosystem coherence, stubs, and lockfile format. Renovate owns everything else plus bumping `@inixiative/config` itself, and must be fenced off the toolchain packages.

## CI

Every lib repo gets a two-line caller workflow:

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:
jobs:
  ci:
    uses: inixiative/config/.github/workflows/lib-ci.yml@main
```

`lib-ci.yml` pins bun from `.bun-version`, installs with `--frozen-lockfile` (kills the stale-lockfile class), runs `inixiative-config check .`, then the repo's own `bun run check`.

## Release flow

Publishing moves in dependency order (json-rules → permissions → transitions → rules-builder). `train` automates the walk; after it completes, commit and publish this package so the BOM names the new state. Downstream repos pick it up via `sync`.
