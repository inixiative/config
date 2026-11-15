"""Regenerate the doc-units parity fixture from the region builder itself.

The region builder (outside the repos, ~/.foundry/evals/setup-practice/pipeline) cuts a doc into the
units a region copies, and assemble.py lays them out in part 4a of knowledge.md. src/docUnits.ts ports
both. This script runs the builder's own code over test/fixtures/doc-units-parity/docs:
  - units.py's cut (strip_do_not_copy, doc_units), with and without the strip;
  - assemble.py's demote and its part-4a block (the lines that write part 4a, taken from assemble.py
    as written), which gives each unit's shown text and source line and a knowledge.md part 4a;
and writes expected.json; test/docUnits.test.ts checks the port reproduces all of it. Run it when the
builder changes:

  python3 -I scripts/doc-units-parity/regenerate.py [<pipeline dir>]
"""
import json, os, re, sys, textwrap

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(HERE, '..', '..', 'test', 'fixtures', 'doc-units-parity')
pipeline = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/.foundry/evals/setup-practice/pipeline')

# units.py runs a build when imported; take only its cut (constants and functions), as written.
units_src = open(os.path.join(pipeline, 'units.py')).read()
cut = units_src[units_src.index('SPLIT_H3 = '):units_src.index('def repo_files')]
ns = {'re': re}
exec(re.sub(r"^SKIP_DIRS = .*$", '', cut, flags=re.M), ns)

# assemble.py likewise: its demote, and the block that writes part 4a for a region's units `ru`.
assemble_src = open(os.path.join(pipeline, 'assemble.py')).read()
exec(assemble_src[assemble_src.index('def demote(text):'):assemble_src.index('anchor = lambda')], ns)
start = assemble_src.index('    H.append("## 4. The specifics, in full\\n")')
end = assemble_src.index('\n', assemble_src.index('    H.append("### 4b. Code entries\\n")', start))
part4 = textwrap.dedent(assemble_src[start:end])

FIELDS = ('id', 'path', 'h1', 'heading', 'text')
expected = {'docs': {}, 'knowledge': None}
every = []
for name in sorted(os.listdir(os.path.join(FIXTURE, 'docs'))):
    path = f'docs/{name}'
    text = open(os.path.join(FIXTURE, path), errors='replace').read()  # the builder's own read
    stripped, _ = ns['strip_do_not_copy'](text)
    units = ns['doc_units'](stripped, path)
    every += units
    expected['docs'][path] = {
        'units': [{k: u[k] for k in FIELDS} for u in units],
        'unstripped': [{k: u[k] for k in FIELDS} for u in ns['doc_units'](text, path)],
        'shown': [ns['demote'](u['text']) for u in units],
    }
H = []
exec(part4, {**ns, 'H': H, 'ru': every})
expected['knowledge'] = '\n'.join(H) + '\n'
with open(os.path.join(FIXTURE, 'expected.json'), 'w') as f:
    json.dump(expected, f, indent=1, ensure_ascii=False)
    f.write('\n')
print(f"{len(every)} units from {len(expected['docs'])} docs → {os.path.relpath(os.path.join(FIXTURE, 'expected.json'))}")
