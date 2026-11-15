"""Regenerate the doc-units parity fixture from the region builder itself.

The region builder (outside the repos, ~/.foundry/evals/setup-practice/pipeline) cuts a doc into the
units a region copies. src/docUnits.ts ports that cut. This script runs the builder's own functions
(units.py: strip_do_not_copy, doc_units) over test/fixtures/doc-units-parity/docs and writes
expected.json; test/docUnits.test.ts checks the port reproduces it. Run it when the builder changes:

  python3 -I scripts/doc-units-parity/regenerate.py [<pipeline dir>]
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(HERE, '..', '..', 'test', 'fixtures', 'doc-units-parity')
pipeline = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/.foundry/evals/setup-practice/pipeline')
source = open(os.path.join(pipeline, 'units.py')).read()
# units.py runs a build when imported; take only its cut (constants and functions), as written.
cut = source[source.index('SPLIT_H3 = '):source.index('def repo_files')]
cut = re.sub(r"^SKIP_DIRS = .*$", '', cut, flags=re.M)
ns = {'re': re}
exec(cut, ns)

expected = {}
for name in sorted(os.listdir(os.path.join(FIXTURE, 'docs'))):
    path = f'docs/{name}'
    text = open(os.path.join(FIXTURE, path), errors='replace').read()  # the builder's own read
    stripped, _ = ns['strip_do_not_copy'](text)
    expected[path] = {
        'units': [{k: u[k] for k in ('id', 'path', 'h1', 'heading', 'text')} for u in ns['doc_units'](stripped, path)],
        'unstripped': [{k: u[k] for k in ('id', 'path', 'h1', 'heading', 'text')} for u in ns['doc_units'](text, path)],
    }
with open(os.path.join(FIXTURE, 'expected.json'), 'w') as f:
    json.dump(expected, f, indent=1, ensure_ascii=False)
    f.write('\n')
print(f"{sum(len(v['units']) for v in expected.values())} units from {len(expected)} docs → {os.path.relpath(os.path.join(FIXTURE, 'expected.json'))}")
