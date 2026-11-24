import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeContracts } from '../mods/walkthrough/lib/contracts.js';
import { normalize, SCHEMA, overlay } from '../mods/walkthrough/lib/walkthrough.js';
import { reportPages } from '../mods/walkthrough/lib/navigation.js';
import { toMarkdown, contractMarkdown } from '../mods/walkthrough/lib/export.js';
import { buildPrompt } from '../mods/walkthrough/lib/prompt.js';
import { files, ids, contractFixtures } from './fixtures/contracts.js';
const clone = () => structuredClone(contractFixtures);
const norm = (raw) => normalizeContracts(raw, ids, files);
const raw = () => ({ title: 'Orders', summary: 'Changes', contracts: clone(), skipped: [], parts: [{ title: 'Code', blurb: '', steps: [{ title: 'Validation', text: 'Requires an ID.', weight: 'normal', hunks: ['h3'], notes: [] }] }] });

test('all affected kinds get evidence-anchored pages, sorted database/protobuf/API', () => {
  const pages = norm(clone().reverse());
  assert.deepEqual(pages.map((p) => p.kind), ['database','protobuf','api']);
  assert.deepEqual(pages[0].paths, [files[0].path]);
  assert.deepEqual(pages[1].changes[0].hunkIds, ['proto-hunk']);
  assert.equal(pages[0].changes[0].after, clone()[0].changes[0].after);
  assert.ok(SCHEMA.required.includes('contracts'));
});
test('ordinary or legacy reports get no conditional pages', () => {
  assert.deepEqual(norm([]), []); assert.deepEqual(norm(undefined), []);
  const r = raw(); delete r.contracts;
  const w = normalize(r,ids,files), v=overlay(w,[]);
  assert.deepEqual(reportPages(w,v).map((p)=>p.kind), ['recap','step','tail']);
});
test('Recap remains first, contracts precede steps and do not consume their anchors', () => {
  const w=normalize(raw(),ids,files), v=overlay(w,[]), pages=reportPages(w,v);
  assert.deepEqual(pages.map((p)=>p.kind),['recap','contract','contract','contract','step','tail']);
  assert.deepEqual(w.parts[0].steps[0].hunkIds,['api-hunk']);
  assert.deepEqual(pages[4].step.hunkIds,['api-hunk']);
  assert.deepEqual(reportPages(w,null),[]);
});
const kept = (p) => { const omit = { count: 0 }; return { kinds: normalizeContracts(p, ids, files, omit).map((x) => x.kind), omitted: omit.count }; };
test('imaginary anchors, duplicate/unknown kinds and empty assessments are left out and counted', () => {
  for (const [change, kinds, omitted] of [
    [(p)=>{p[0].changes[0].hunks=['h99'];}, ['protobuf','api'], 2], // the change, then its empty page
    [(p)=>{p[0].kind='api';}, ['protobuf','api'], 1],
    [(p)=>{p[0].kind='graphql';}, ['protobuf','api'], 1],
    [(p)=>{p[0].changes=[];}, ['protobuf','api'], 1],
    [(p)=>{p[0].impact='';}, ['protobuf','api'], 1],
  ]) {const p=clone(); change(p); assert.deepEqual(kept(p), { kinds, omitted });}
  // Repairable details are repaired, not refused.
  const p=clone(); p[0].rollout=['', ' Step ']; p[0].compatibility='safe'; p[0].changes[0].hunks=['[h1]'];
  const page=norm(p)[0];
  assert.deepEqual(page.rollout,['Step']); assert.equal(page.compatibility,'unknown'); assert.deepEqual(page.changes[0].hunkIds,['sql-hunk']);
  assert.deepEqual(kept('nope'), { kinds: [], omitted: 1 });
  // One bad change leaves the page's other changes standing.
  const q=clone(); q[0].changes.push({ ...q[0].changes[0], name: 'orders.note', hunks: ['h99'] });
  assert.equal(norm(q)[0].changes.length, 1);
});
test('a state the operation rules out is cleared; a missing state the operation needs drops the change', () => {
  const p=clone().slice(0,1), c=p[0].changes[0];
  c.operation='added'; c.before='(none)'; assert.equal(norm(p)[0].changes[0].before,''); assert.equal(norm(p)[0].changes[0].after,c.after);
  c.operation='removed'; c.before='old'; c.after='(none)'; assert.equal(norm(p)[0].changes[0].after,''); assert.equal(norm(p)[0].changes[0].before,'old');
  c.operation='modified'; c.after=''; assert.deepEqual(kept(p), { kinds: [], omitted: 2 });
  c.after='new'; c.before=''; assert.deepEqual(kept(p), { kinds: [], omitted: 2 });
});
test('Markdown includes comparisons and evidence before code steps with honest unknown rollout', () => {
  const w=normalize(raw(),ids,files),md=toMarkdown(overlay(w,[]),w,{language:"pl"});
  assert.ok(md.indexOf('### Baza danych')<md.indexOf('### Protobuf'));
  assert.ok(md.indexOf('### API')<md.indexOf('### Code'));
  assert.match(md,/\*\*Przed zmianą:\*\*/); assert.match(md,/\*\*Po zmianie:\*\*/);
  assert.match(md,/Kolejność wdrożenia nie została ustalona/);
  assert.match(md,/migrations\/20261101_orders.sql/);
  const p=norm(clone())[0]; p.changes[0].after='```\n# data';
  assert.ok(contractMarkdown(p).includes('````\n```\n# data\n````'));
});
test('prompt requires semantic detection, complete categories and evidence-scoped compatibility', () => {
  const {system}=buildPrompt({digest:'diff',fileCount:3,hunkCount:3,what:'Changes',language:'pl'});
  for (const phrase of ['contracts: []','database, protobuf, api','wire compatibility','field-number reuse','backfills','request and response','contract titles']) assert.ok(system.includes(phrase),phrase);
});
