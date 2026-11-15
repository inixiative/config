# config, for its Wardens

config (`@inixiative/config`) is the published toolchain, theme, version manifest and release
train every inixiative repo depends on. One config version names one coherent set of
`@inixiative/*` versions: `check` fails a repo's CI when it drifts from that set, `sync` fixes
the drift, `scan` checks every checkout under a root, and `train` publishes the lanes in
dependency order and ships config last. A change here reaches every repo at once, through their
CI: a new finding in `inspect` fails other repos' checks on their next config bump, so say so
before making one.

## Shape of the repository

- Shipped files, not code: `tsconfig/`, `biome/`, `lefthook/base.yml`, `theme/` (CSS and fonts),
  `versions.json` (the BOM), `ports.json` (the local port registry). Consumers extend or load
  them by their export path.
- `src/tsup.ts` is the only code export (`@inixiative/config/tsup`). `src/cli.ts` is the
  `inixiative-config` bin; its logic lives in `src/args.ts` (flags per command), `src/lib.ts`
  (the BOM helpers, `inspect`, checkout discovery, the train lock), `src/ports.ts` and
  `src/retiredTerms.ts`.
- `.github/workflows/lib-ci.yml` is the reusable CI every lib repo calls; `ci.yml` is this
  repo's own.
- `test/`: bun tests over real fixture repos in `test/fixtures/` (which follow the blessed set).
- Check: `bun run check` (typecheck, Biome, tests). `README.md` is the full doc.

## Rules that hold everywhere

- Origin is the truth: `scan` and `train` fetch and refuse or flag checkouts behind origin.
- The train only ships a clean default branch, never leaves a checkout dirty, and opens no PRs;
  a repo that fails against candidates adopts them on a `train/adopt-*` branch instead.
- Every train write goes through one `effect` helper, so `--dry-run` prints it and runs nothing.
- One train at a time per machine (`~/.inixiative/train.lock`).
- This package has no runtime dependencies and only optional peers; a test holds both.

## Words used here

BOM, lane (primitives, agentic), blessed set, candidate, hold, consumer, upstream, adoption
branch, incomplete adoption, promote, toolchain pin, required, preset, stub, finding, fix,
stale lock, retired term, allow list, baseline, block (ports), domain palette.
