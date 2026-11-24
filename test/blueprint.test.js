import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeComponents, componentEvidence } from '../mods/walkthrough/lib/blueprint.js';
import { buildDigest } from '../mods/walkthrough/lib/digest.js';
import { normalize, PROMPT_VERSION, SCHEMA } from '../mods/walkthrough/lib/walkthrough.js';
import { recapMarkdown } from '../mods/walkthrough/lib/export.js';
import { buildPrompt } from '../mods/walkthrough/lib/prompt.js';

const mermaid = 'flowchart TB\nA["Existing module"]\nB["New module"]\nC["External context"]\nA --> B\nC --> A';
const files = [{ path: 'src/a.js', status: 'modified', aliases: ['h1'] }, { path: 'src/b.js', status: 'added', aliases: ['h2'] }];
const aliases = { h1: 'id1', h2: 'id2' };
const components = () => [
  { id: 'A', status: 'modified', responsibility: 'Delegates work.', change: 'Uses the new module.', paths: ['src/a.js'], hunks: ['h1'] },
  { id: 'B', status: 'added', responsibility: 'Keeps pending work.', change: 'New implementation.', paths: ['src/b.js'], hunks: ['h2'] },
  { id: 'C', status: 'context', responsibility: 'An existing external caller.', change: '', paths: [], hunks: [] },
];
const norm = (raw = components(), f = files, omit) => normalizeComponents(raw, mermaid, aliases, f, omit);

test('component identities, status and exact source evidence survive report normalization', () => {
  const raw = { title: 'Modules', parts: [{ steps: [{ hunks: ['h1'], text: 'Delegates work.' }] }],
    recap: { changes: [{ description: 'Changed modules.', motivation: 'Use a queue.', paths: files.map((f) => f.path) }],
      architecture: { description: 'Caller delegates.', mermaid, components: components() } } };
  const w = normalize(raw, aliases, files);
  assert.deepEqual(w.recap.architecture.components, norm());
  assert.deepEqual(norm()[0].hunkIds, ['id1']);
  assert.equal(norm()[1].status, 'added');
  assert.deepEqual(norm()[2].hunkIds, []);
});

const ids = (c, f) => { const omit = { count: 0 }; const out = norm(c, f, omit); return { ids: out.map((x) => x.id), omitted: omit.count, out }; };

test('invented, duplicate or incomplete components are left out and counted, never failing', () => {
  for (const [mutate, kept] of [
    [(c) => c.pop(), ['A', 'B']], [(c) => { c[0].id = 'Unknown'; }, ['B', 'C']], [(c) => { c[1].id = 'A'; }, ['A', 'C']],
    [(c) => { c[0].status = 'removed'; }, ['B', 'C']], [(c) => { c[0].responsibility = ''; }, ['B', 'C']],
  ]) {
    const c = components(); mutate(c);
    const r = ids(c);
    assert.deepEqual(r.ids, kept);
    assert.equal(r.omitted, components().length === c.length ? 1 : 0);
  }
  const omit = { count: 0 };
  assert.deepEqual(normalizeComponents('nope', mermaid, aliases, files, omit), []);
  assert.equal(omit.count, 1);
});

test('source anchors resolve like steps; paths follow the cited hunks', () => {
  for (const mutate of [(c) => { c[0].hunks = ['h9']; }, (c) => { c[0].hunks = []; }, (c) => { c[0].hunks = ['toString']; }]) {
    const c = components(); mutate(c);
    assert.deepEqual(ids(c), { ...ids(c), ids: ['B', 'C'], omitted: 1 });
  }
  for (const spelling of ['[h1]', ' h1 ', '[ h1 ]']) {
    const c = components(); c[0].hunks = [spelling];
    assert.deepEqual(ids(c).out[0].hunkIds, ['id1']);
  }
  // The model's paths don't decide; the files its hunks are in do.
  const c = components(); c[0].paths = ['invented.js']; c[0].hunks = ['h1', 'h2'];
  assert.deepEqual(ids(c).out[0].paths, ['src/a.js', 'src/b.js']);
  const d = components(); d[0].change = '';
  assert.equal(ids(d).out[0].change, '');
});

test('Added without only added-file evidence becomes Modified; Context claims no changes', () => {
  const c = components(); c[0].status = 'added';
  assert.equal(ids(c).out[0].status, 'modified');
  assert.equal(ids(components(), files.map((f) => ({ ...f, status: 'modified' }))).out[1].status, 'modified');
  const x = components(); x[2].change = 'An unsupported change'; x[2].paths = ['src/a.js']; x[2].hunks = ['h1'];
  assert.deepEqual(ids(x).out[2], { id: 'C', status: 'context', responsibility: 'An existing external caller.', change: '', paths: [], hunkIds: [] });
  // Evidence only in a deleted file shows nothing that remains.
  assert.deepEqual(ids(components(), [{ ...files[0], status: 'deleted' }, files[1]]).ids, ['B', 'C']);
});

test('source resolution distinguishes scopes and detects stale or moved evidence', () => {
  const component = { ...norm()[0], hunkIds: ['id1', 'id-staged'] };
  const live = [
    { path: 'src/a.js', scope: 'working', hunks: [{ id: 'id1' }] },
    { path: 'src/a.js', scope: 'staged', hunks: [{ id: 'id-staged' }] },
  ];
  assert.equal(componentEvidence(component, live).found.length, 2);
  assert.equal(componentEvidence(component, live).missing, 0);
  assert.equal(componentEvidence(component, live.slice(0, 1)).missing, 1);
  assert.equal(componentEvidence(component, [{ ...live[0], path: 'wrong.js' }]).missing, 2);
  assert.deepEqual(componentEvidence(undefined, live), { found: [], missing: 0 });
});

test('digest retains added/modified status for conservative classification', () => {
  const d = buildDigest([{ scope: 'working', patch: 'diff --git a/src/b.js b/src/b.js\nnew file mode 100644\n--- /dev/null\n+++ b/src/b.js\n@@ -0,0 +1 @@\n+export const queue = [];\n' }]);
  assert.equal(d.digestFiles[0].status, 'added');
});

test('new generations require components; legacy diagrams stay unclassified and readable', () => {
  assert.equal(PROMPT_VERSION, 3);
  assert.ok(SCHEMA.properties.recap.properties.architecture.required.includes('components'));
  assert.equal(normalizeComponents(undefined, mermaid, aliases, files), undefined);
  const p = buildPrompt({ digest: 'diff', fileCount: 2, hunkCount: 2, what: 'Changes' });
  assert.match(p.system, /exactly one entry per Mermaid node/);
  assert.match(p.system, /newly added in the digest/);
});

test('Markdown preserves component meaning and files without leaking internal anchors', () => {
  const recap = { changes: [], architecture: { description: 'Flow', mermaid, components: norm() } };
  const md = recapMarkdown(recap);
  assert.match(md, /A · Modified/); assert.match(md, /B · Added/); assert.match(md, /C · Context/);
  assert.match(md, /`src\/a.js`/); assert.match(md, /Uses the new module/);
  assert.doesNotMatch(md, /id1|id2/);
  assert.doesNotMatch(recapMarkdown(recap, { diagram: false, architecture: false }), /#### Components/);
});
