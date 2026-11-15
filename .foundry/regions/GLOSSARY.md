# config glossary

**Every term config's region Wardens use, alphabetical, each with the region that holds it.**

<!-- Generated with the region Warden docs by the region pipeline's assemble.py. A term defined by two regions appears once per region. -->

---

## 4

**4.5:1**  
Minimum contrast every accent holds on the background and card, enforced by a test. *Region:* [Brand theme CSS](brand-theme/knowledge.md)

## A

**--adopt-check-timeout**  
Seconds the adoption check may take (default 1800); a timeout is a failure. *Region:* [Release train and holds](release-train/knowledge.md)

**adoption**  
Moving a repo that fails against candidates onto them on a branch in a worktree. *Region:* [Release train and holds](release-train/knowledge.md)

**agentic**  
Domain palette: green primary, blue tertiary for shared, pink quaternary for Signet. *Region:* [Brand theme CSS](brand-theme/knowledge.md)

**agentic**  
BOM section and lane building on primitives: signet, kcp, archive, agent-session, foundry-core, foundry, foundry-acp. *Region:* [BOM, drift check and sync](version-coherence/knowledge.md)

**allow.txt**  
scripts/ci/retired-terms/allow.txt: legitimate uses by term, path+term, or directory ending in /. *Region:* [Retired product names](retired-terms/knowledge.md)

**--app-* slots**  
The four palette slots (primary, secondary, tertiary, quaternary) each domain fills; marketing CSS reads them directly. *Region:* [Brand theme CSS](brand-theme/knowledge.md)

**--app-primary**  
The page's one accent (CTA, eyebrow, wordmark stop); follows a nested data-domain. *Region:* [Brand theme CSS](brand-theme/knowledge.md)

## B

**baseline.txt**  
scripts/ci/retired-terms/baseline.txt: `<path>\t<term>\t<count>` pre-existing uses, warned not failed. *Region:* [Retired product names](retired-terms/knowledge.md)

**below**  
Hold field: every version at or above it is held. *Region:* [Release train and holds](release-train/knowledge.md)

**biome/base.json**  
Shared Biome formatter (2 spaces, width 100, single quotes, trailing commas, semicolons) and lint rules. *Region:* [Shared toolchain presets](toolchain-presets/knowledge.md)

**biome/react.json**  
Adds useExhaustiveDependencies as a warning; a react repo's biome.json extends it alongside base. *Region:* [Shared toolchain presets](toolchain-presets/knowledge.md)

**blessed version**  
The version a lane section names; ranges and bun.lock must admit it. *Region:* [BOM, drift check and sync](version-coherence/knowledge.md)

**block**  
A project's offset number; its ports are the service defaults plus 100 times the block. *Region:* [Local dev port registry](port-registry/knowledge.md)

**block 0**  
The defaults themselves, held by Zealot alone; never given to a new project. *Region:* [Local dev port registry](port-registry/knowledge.md)

**blockSize**  
100: the gap between two projects' ports for the same service. *Region:* [Local dev port registry](port-registry/knowledge.md)

**bom**  
Class tag: versions.json, the bill of materials naming one coherent state of the inixiative packages. *Region:* [BOM, drift check and sync](version-coherence/knowledge.md)

**<branch>-output**  
Branch holding an incomplete adoption's script output, one commit on top. *Region:* [Release train and holds](release-train/knowledge.md)

**building-blocks**  
Domain palette: amber primary, teal tertiary, brick quaternary. *Region:* [Brand theme CSS](brand-theme/knowledge.md)

**bun pm pack**  
Packs workspace members, rewriting workspace: ranges, before npm publish. *Region:* [Release train and holds](release-train/knowledge.md)

**.bun-version**  
File holding the blessed bun, matched with packageManager; lib-ci reads it. *Region:* [BOM, drift check and sync](version-coherence/knowledge.md)

**button / button-secondary / text-link**  
Marketing call-to-action classes. *Region:* [Brand theme CSS](brand-theme/knowledge.md)

## C

**candidate**  
A published version recorded under `candidates`, accepted by check until promoted. *Region:* [Release train and holds](release-train/knowledge.md)

**candidates**  
Published lane versions newer than blessed, waiting for adoption; check also accepts them. *Region:* [BOM, drift check and sync](version-coherence/knowledge.md)

**check**  
inixiative-config check also runs the retired-terms rule; scan, sync and train don't. *Region:* [Retired product names](retired-terms/knowledge.md)

**check-and-sync**  
Class tag: detecting one repo's drift from the BOM (check) and repairing it (sync). *Region:* [BOM, drift check and sync](version-coherence/knowledge.md)

**Checked in**  
A term's scope: every doc, or READMEs, package descriptions and site pages only. *Region:* [Retired product names](retired-terms/knowledge.md)

**checkout-scan**  
Class tag: finding every inixiative checkout under a root and running check across them. *Region:* [BOM, drift check and sync](version-coherence/knowledge.md)

**CJS + ESM**  
The two output formats both tsup presets emit from src/index.ts. *Region:* [Shared toolchain presets](toolchain-presets/knowledge.md)

**cli**  
Class tag: the inixiative-config bin, its commands and per-command flags. *Region:* [BOM, drift check and sync](version-coherence/knowledge.md)

**collision**  
Two project/service pairs on one port, or a non-block-0 project on a default; the tests fail on it. *Region:* [Local dev port registry](port-registry/knowledge.md)

**config ships last**  
@inixiative/config is bumped, blessed and published last, then touched checkouts re-lock onto it. *Region:* [Release train and holds](release-train/knowledge.md)

**consumers**  
Private repos trained once after all lanes, upstreams first, never published. *Region:* [Release train and holds](release-train/knowledge.md)

**consumers**  
Private repos keyed by owner/repo with `lanes` and `upstream`; they follow lanes and never publish. *Region:* [BOM, drift check and sync](version-coherence/knowledge.md)

## D

**.dark**  
Class on <html> that switches to the dark theme; light is :root. *Region:* [Brand theme CSS](brand-theme/knowledge.md)

**data-domain**  
Attribute selecting a palette: agentic, building-blocks, governance or inixiative. *Region:* [Brand theme CSS](brand-theme/knowledge.md)

**Dead concepts**  
Workspace CLAUDE.md section the list is drawn from, with the copy brief's Retired words. *Region:* [Retired product names](retired-terms/knowledge.md)

**default branch only**  
train skips whole any checkout on a feature branch and refuses a config checkout behind origin. *Region:* [Release train and holds](release-train/knowledge.md)

**dependency order**  
Within a lane, each checkout follows the checkouts whose packages it depends on (topoOrder). *Region:* [Release train and holds](release-train/knowledge.md)

**--dry-run**  
Walk the plan and print each step without running any; takes no lock. *Region:* [Release train and holds](release-train/knowledge.md)

**dts: true**  
Turns on declarations; through a preset it keeps the TS 6.0 ignoreDeprecations fix. *Region:* [Shared toolchain presets](toolchain-presets/knowledge.md)

## E

**ecosystem**  
BOM section: the primitives lane's blessed @inixiative/* set plus @inixiative/config. *Region:* [BOM, drift check and sync](version-coherence/knowledge.md)

**extends**  
How a repo's tsconfig.json, biome.json and lefthook.yml consume the presets; check enforces it. *Region:* [Shared toolchain presets](toolchain-presets/knowledge.md)

**eyebrow + status-dot**  
Marketing classes for the small label above a heading. *Region:* [Brand theme CSS](brand-theme/knowledge.md)

## F

**Finding**  
One drift result from inspect, optionally with a fix that sync applies. *Region:* [BOM, drift check and sync](version-coherence/knowledge.md)

**--frozen-lockfile**  
lib-ci's install mode, which kills the stale-lockfile class. *Region:* [BOM, drift check and sync](version-coherence/knowledge.md)

## G

**governance**  
Domain palette: violet primary, jade tertiary, rose quaternary. *Region:* [Brand theme CSS](brand-theme/knowledge.md)

## H

**holds**  
Class tag and BOM field: lane packages kept below a version (`below`, `reason`, optional `until`, `owner`). *Region:* [Release train and holds](release-train/knowledge.md)

**holds**  
BOM field keeping a package's versions at or above `below` out of the blessed set; none today. *Region:* [BOM, drift check and sync](version-coherence/knowledge.md)

**HSL channels**  
Token values are bare channels, used as hsl(var(--token)) or hsl(var(--token) / alpha). *Region:* [Brand theme CSS](brand-theme/knowledge.md)

## I

**ignoreDeprecations "6.0"**  
Compiler option the presets scope to tsup's dts build so TS 6.0's baseUrl deprecation does not fail it. *Region:* [Shared toolchain presets](toolchain-presets/knowledge.md)

**inixiative**  
Neutral ink palette whose other slots are the three domains' primaries, for the hub. *Region:* [Brand theme CSS](brand-theme/knowledge.md)

**inixiative-config ports [project]**  
Prints every project's local ports, or one project's. *Region:* [Local dev port registry](port-registry/knowledge.md)

**@inixiative/config/ports.json**  
The package export of the registry for consumers to read. *Region:* [Local dev port registry](port-registry/knowledge.md)

**@inixiative/config/tsup**  
The package's only code export: the node(options) and react(options) tsup presets. *Region:* [Shared toolchain presets](toolchain-presets/knowledge.md)

## L

**lane**  
primitives or agentic; each releases in dependency order and stops alone on failure. *Region:* [Release train and holds](release-train/knowledge.md)

**lane**  
A release cascade with its own blessed set: primitives or agentic (LANES). *Region:* [BOM, drift check and sync](version-coherence/knowledge.md)

**@layer components**  
Layer holding the .marketing classes so Tailwind utilities and unlayered CSS override them. *Region:* [Brand theme CSS](brand-theme/knowledge.md)

**left out on purpose**  
Words a pattern would mostly misflag (medical, connectionId, principal) are not in the list. *Region:* [Retired product names](retired-terms/knowledge.md)

**lefthook/base.yml**  
Shared pre-commit hooks (typecheck, Biome on staged TS files) a repo's lefthook.yml extends. *Region:* [Shared toolchain presets](toolchain-presets/knowledge.md)

**lib-ci**  
Class tag: the reusable .github/workflows/lib-ci.yml every lib repo calls. *Region:* [BOM, drift check and sync](version-coherence/knowledge.md)

**load order**  
Apps: public, status, own CSS. Marketing: public, domains, marketing, after template's theme.css. *Region:* [Brand theme CSS](brand-theme/knowledge.md)

## M

**Manifest**  
The internal type for versions.json in src/lib.ts, read by loadManifest. *Region:* [BOM, drift check and sync](version-coherence/knowledge.md)

**.marketing**  
Class on the page root that scopes the shared marketing classes. *Region:* [Brand theme CSS](brand-theme/knowledge.md)

## N

**nav, brand, section, card, card-grid, footer, prose**  
The other shared marketing layout classes; .prose is set for the light theme. *Region:* [Brand theme CSS](brand-theme/knowledge.md)

**next free block**  
Where a new project goes; block 4 is currently free. *Region:* [Local dev port registry](port-registry/knowledge.md)

**node()**  
tsup preset for a Node or bun package: src/index.ts to CJS + ESM with dts and sourcemaps. *Region:* [Shared toolchain presets](toolchain-presets/knowledge.md)

**npm alias**  
A dependency like npm:@inixiative/archive@^0.2.1, held to its target's blessed version. *Region:* [BOM, drift check and sync](version-coherence/knowledge.md)

## O

**optional peers**  
Every peer of @inixiative/config is optional and it has no runtime dependencies; a test holds both. *Region:* [Shared toolchain presets](toolchain-presets/knowledge.md)

**options override the base**  
Fields passed to node()/react() replace the preset's defaults. *Region:* [Shared toolchain presets](toolchain-presets/knowledge.md)

**origin remote**  
How scan matches consumer checkouts; directory names never need declaring. *Region:* [BOM, drift check and sync](version-coherence/knowledge.md)

## P

**peer floor**  
The toolchain peer range sync writes: >=<pin major>.<pin minor>.0. *Region:* [BOM, drift check and sync](version-coherence/knowledge.md)

**portConflicts**  
Internal helper in src/ports.ts listing collisions, empty when the registry is sound; not importable. *Region:* [Local dev port registry](port-registry/knowledge.md)

**ports**  
The class covering the local port registry, its block arithmetic and the ports command. *Region:* [Local dev port registry](port-registry/knowledge.md)

**ports.json**  
The registry: blockSize, reserved, services (defaults) and projects (blocks). *Region:* [Local dev port registry](port-registry/knowledge.md)

**portsFor**  
Internal helper in src/ports.ts computing one project's ports; not importable. *Region:* [Local dev port registry](port-registry/knowledge.md)

**prefers-reduced-motion**  
When it is set, marketing.css zeroes the motion tokens. *Region:* [Brand theme CSS](brand-theme/knowledge.md)

**--preset**  
base | node | react for check and sync; sync infers react from a react dependency. *Region:* [BOM, drift check and sync](version-coherence/knowledge.md)

**--preset=base|node|react**  
check/sync flag naming which tsconfig preset the repo must extend. *Region:* [Shared toolchain presets](toolchain-presets/knowledge.md)

**projects / services**  
Internal key lists of ports.json inside src/ports.ts. *Region:* [Local dev port registry](port-registry/knowledge.md)

**promote**  
Move a candidate into its lane's blessed section at run end when nothing holds it. *Region:* [Release train and holds](release-train/knowledge.md)

**public copy**  
Tracked Markdown, MDX, HTML and Astro files plus each package.json description. *Region:* [Retired product names](retired-terms/knowledge.md)

**--push**  
Push committed repos and adoption branches, delete superseded train/* branches; no PRs. *Region:* [Release train and holds](release-train/knowledge.md)

## R

**react()**  
tsup preset like node() that also externalises react, react-dom and react/jsx-runtime. *Region:* [Shared toolchain presets](toolchain-presets/knowledge.md)

**release-train**  
Class tag: the train command's per-lane release cascade. *Region:* [Release train and holds](release-train/knowledge.md)

**Renovate**  
Owns non-toolchain bumps and bumping @inixiative/config itself; fenced off the toolchain. *Region:* [BOM, drift check and sync](version-coherence/knowledge.md)

**required**  
BOM section of toolchain packages every repo must carry (biome, typescript, @types/bun). *Region:* [BOM, drift check and sync](version-coherence/knowledge.md)

**reserved**  
Ports never assigned: 5000 and 7000 (macOS AirPlay Receiver). *Region:* [Local dev port registry](port-registry/knowledge.md)

**retired-terms**  
Class tag and rule name: retired product names kept out of public copy. *Region:* [Retired product names](retired-terms/knowledge.md)

**retired-terms.sh**  
template's own CI rule running bunx inixiative-config terms ., beside doc-freshness.sh. *Region:* [Retired product names](retired-terms/knowledge.md)

**RETIRED_TERMS**  
The list in src/retiredTerms.ts: each term, where it is checked, and its replacement. *Region:* [Retired product names](retired-terms/knowledge.md)

## S

**scanRetiredTerms**  
Internal raw scan of public copy, before the allow list and baseline. *Region:* [Retired product names](retired-terms/knowledge.md)

**service default**  
A service's usual port (web 3000, http 4000, postgres 5432, redis 6379, api 8000…). *Region:* [Local dev port registry](port-registry/knowledge.md)

**shrink-only baseline**  
A use beyond the count fails, and so does a count that dropped without lowering the line. *Region:* [Retired product names](retired-terms/knowledge.md)

**skipped paths**  
Fixtures, changelogs, node_modules, .foundry/regions/, root dist, build, coverage, tmp. *Region:* [Retired product names](retired-terms/knowledge.md)

**stale lock**  
Lock whose process is gone, pid reused or file unparsable; another host's is never stale. *Region:* [Release train and holds](release-train/knowledge.md)

**stale lockfile**  
bun.lock resolving an @inixiative/* package to something other than the blessed version or a candidate. *Region:* [BOM, drift check and sync](version-coherence/knowledge.md)

**--status-***  
problem / attention / working / queued / done / idle / archived tokens in status.css. *Region:* [Brand theme CSS](brand-theme/knowledge.md)

**--success / --warning / --error**  
Status colour tokens in public.css. *Region:* [Brand theme CSS](brand-theme/knowledge.md)

## T

**terms**  
inixiative-config terms [dir] [--write-baseline]: runs only the retired-terms rule. *Region:* [Retired product names](retired-terms/knowledge.md)

**theme**  
The class of brand CSS files under @inixiative/config/theme/ and the rules for loading them. *Region:* [Brand theme CSS](brand-theme/knowledge.md)

**theme/domains.css**  
Four palettes on one slot structure, selected with data-domain on any element; they nest. *Region:* [Brand theme CSS](brand-theme/knowledge.md)

**theme/fonts/***  
The latin variable fonts public.css loads from ./fonts/: Bricolage Grotesque, Instrument Sans, JetBrains Mono. *Region:* [Brand theme CSS](brand-theme/knowledge.md)

**theme/marketing.css**  
The marketing grammar: fluid type, spacing, section rhythm, radius, elevation, motion tokens and the .marketing classes. *Region:* [Brand theme CSS](brand-theme/knowledge.md)

**theme/public.css**  
The brand base: --app-* slots, status, UI and type tokens, and the @font-face rules. *Region:* [Brand theme CSS](brand-theme/knowledge.md)

**theme/status.css**  
Thread/work status tokens (--status-problem … --status-archived) and the badge layer for apps showing agent work. *Region:* [Brand theme CSS](brand-theme/knowledge.md)

**toolchain**  
BOM section of exact pins for @biomejs/biome, typescript, tsup, @types/bun and lefthook. *Region:* [BOM, drift check and sync](version-coherence/knowledge.md)

**toolchain pins**  
Exact versions of biome, typescript, tsup, @types/bun and lefthook, kept in versions.json (version-coherence). *Region:* [Shared toolchain presets](toolchain-presets/knowledge.md)

**toolchain-presets**  
The class of shared tsconfig, Biome, lefthook and tsup presets a repo extends from @inixiative/config. *Region:* [Shared toolchain presets](toolchain-presets/knowledge.md)

**train**  
inixiative-config train [root] [--lane] [--push] [--dry-run] [--adopt-check-timeout=<seconds>]. *Region:* [Release train and holds](release-train/knowledge.md)

**Train-Adopt**  
Commit trailer: `incomplete (<reason>)` or `complete`; later trains read it. *Region:* [Release train and holds](release-train/knowledge.md)

**train.lock**  
~/.inixiative/train.lock: one train per machine; records pid, hostname, process start time. *Region:* [Release train and holds](release-train/knowledge.md)

**train/adopt-<pkg>-<version>**  
The adoption branch; an abandoned one holds its candidates until deleted. *Region:* [Release train and holds](release-train/knowledge.md)

**train:adopt**  
Optional package.json script run during adoption (Foundry re-records cassettes). *Region:* [Release train and holds](release-train/knowledge.md)

**tsconfig/base.json**  
Shared compiler options: ESNext, bundler resolution, strict, noEmit, verbatimModuleSyntax, types ["bun"]. *Region:* [Shared toolchain presets](toolchain-presets/knowledge.md)

**tsconfig/node.json**  
base plus types ["node"]; picked only with --preset=node. *Region:* [Shared toolchain presets](toolchain-presets/knowledge.md)

**tsconfig/react.json**  
base plus the DOM libs and jsx: react-jsx; picked when the repo depends on react. *Region:* [Shared toolchain presets](toolchain-presets/knowledge.md)

**@types/bun**  
Required toolchain package that types ["bun"] resolves to. *Region:* [Shared toolchain presets](toolchain-presets/knowledge.md)

**types: ["bun"]**  
Set in base.json because TS 6.0 no longer auto-includes node_modules/@types. *Region:* [Shared toolchain presets](toolchain-presets/knowledge.md)

## U

**union of lanes**  
check holds every repo to both lanes, so a repo that mixes them answers to both. *Region:* [BOM, drift check and sync](version-coherence/knowledge.md)

**UsageError**  
Internal error for an unknown or misplaced flag; the bin exits 2 before anything runs. *Region:* [BOM, drift check and sync](version-coherence/knowledge.md)

**Use instead**  
The replacement each retired term names, e.g. Kingdom, owner, integration or Signet for Kastle. *Region:* [Retired product names](retired-terms/knowledge.md)

**useExhaustiveDependencies**  
Biome's React hook-dependency rule, a warning in biome/react.json. *Region:* [Shared toolchain presets](toolchain-presets/knowledge.md)

## V

**verbatimModuleSyntax**  
Strict import/export emission set in tsconfig/base.json. *Region:* [Shared toolchain presets](toolchain-presets/knowledge.md)

**versions.json**  
The BOM, shipped as the public export @inixiative/config/versions.json. *Region:* [BOM, drift check and sync](version-coherence/knowledge.md)

## W

**worktree:create**  
A repo's own script for adoption worktrees with slot databases, released by worktree:destroy. *Region:* [Release train and holds](release-train/knowledge.md)

**--write-baseline**  
Writes baseline.txt when none exists, later only to shrink it; refuses to add a use. *Region:* [Retired product names](retired-terms/knowledge.md)
