import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize, overlay, SCHEMA } from "../mods/walkthrough/lib/walkthrough.js";
import { parseMermaid as validateMermaid } from "../mods/walkthrough/lib/diagram.js";
import { buildPrompt } from "../mods/walkthrough/lib/prompt.js";
import { recapMarkdown, toMarkdown } from "../mods/walkthrough/lib/export.js";

const files = [{ path: "src/a.js", aliases: ["h1"] }, { path: "test/a.js", aliases: ["h2"] }, { path: "lock.json", aliases: [] }];
const recap = () => ({
  changes: [
    { description: "Retries now use a queue.", motivation: "Inferred: preserve failed work.", paths: ["src/a.js", "test/a.js"] },
    { description: "Generated lockfile changed; contents not read.", motivation: "Unknown from supplied material.", paths: ["lock.json"] },
  ],
  architecture: { description: "The caller delegates to a queue.", mermaid: 'flowchart TB\nCaller["Caller"]\nQueue["Retry queue"]\nCaller --> Queue' },
});
const raw = () => ({ title: "Retries", summary: "Failed jobs can retry.", recap: recap(), skipped: [], parts: [{ title: "Queue", blurb: "", steps: [{ title: "Persist", text: "Keep failed jobs.", hunks: ["h1"], weight: "key", notes: [] }] }] });
const norm = (r) => normalize(r, { h1: "id1", h2: "id2" }, files);

test("new reports require a structured recap and normalization preserves complete recap", () => {
  assert.ok(SCHEMA.required.includes("recap"));
  assert.deepEqual(norm(raw()).recap, recap());
  const w = norm(raw());
  const md = toMarkdown(overlay(w, []), w);
  assert.match(md, /### Recap/);
  assert.ok(md.indexOf("### Recap") < md.indexOf("### Queue"), "Recap precedes reading steps in export");
  assert.match(md, /\*\*Motivation:\*\* Inferred:/);
  assert.match(md, /`lock.json`/);
  assert.ok(md.includes('```mermaid\n' + recap().architecture.mermaid + '\n```'));
});

test("files no recap change names are listed under Other changes, never failing the report", () => {
  const r = raw(); r.recap.changes.pop();
  const w = norm(r);
  assert.deepEqual(w.recap.other, ["lock.json"]);
  assert.match(recapMarkdown(w.recap), /\*\*Other changes:\*\* `lock.json`/);
  assert.equal(w.omitted, undefined, "an uncovered file is listed, not a left-out detail");
});

test("a recap change without rationale or real files is left out and counted; a bad diagram drops only the blueprint", () => {
  for (const [mutate, check] of [
    [(r) => { r.recap.changes[0].motivation = ""; }, (w) => { assert.equal(w.recap.changes.length, 1); assert.deepEqual(w.recap.other, ["src/a.js", "test/a.js"]); assert.deepEqual(w.omitted, { recap: 1, contracts: 0 }); }],
    [(r) => { r.recap.changes[0].paths = ["invented.js"]; }, (w) => { assert.equal(w.recap.changes.length, 1); assert.deepEqual(w.omitted, { recap: 1, contracts: 0 }); }],
    [(r) => { r.recap.architecture.description = ""; }, (w) => { assert.equal(w.recap.architecture.description, ""); assert.doesNotMatch(recapMarkdown(w.recap), /#### Architecture/); assert.equal(w.omitted, undefined); }],
    [(r) => { r.recap.architecture.mermaid = ""; }, (w) => { assert.equal(w.recap.architecture.mermaid, ""); assert.doesNotMatch(recapMarkdown(w.recap), /```mermaid/); assert.deepEqual(w.omitted, { recap: 1, contracts: 0 }); }],
  ]) { const r = raw(); mutate(r); const w = norm(r); check(w); assert.equal(w.parts.length, 1, "steps survive"); }
});

test("realistic model slips degrade the blueprint or contracts, never the whole report", () => {
  const files = [{ path: "src/a.js", status: "modified", aliases: ["h1"] }, { path: "src/b.js", status: "added", aliases: ["h2"] }];
  const aliases = { h1: "id1", h2: "id2" };
  const good = () => ({
    title: "T", summary: "S", skipped: [],
    parts: [{ title: "P", blurb: "", steps: [{ title: "S", text: "x", hunks: ["h1", "h2"], weight: "key", notes: [] }] }],
    recap: { changes: [{ description: "d", motivation: "m", paths: ["src/a.js", "src/b.js"] }], architecture: {
      description: "Caller uses queue.", mermaid: 'flowchart TD\nA["Caller"]\nB["Queue"]\nA --> B',
      components: [
        { id: "A", status: "modified", responsibility: "Calls.", change: "Uses B.", paths: ["src/a.js"], hunks: ["h1"] },
        { id: "B", status: "added", responsibility: "Queues.", change: "New.", paths: ["src/b.js"], hunks: ["h2"] },
      ],
      connections: [{ from: "A", to: "B", label: "enqueues", hunks: ["h1"] }],
      groups: [{ id: "Core", title: "Core", nodes: ["A", "B"], reason: "One module.", hunks: ["h1", "h2"] }],
    } },
    contracts: [{ kind: "api", title: "t", summary: "s", compatibility: "additive", impact: "i", rollout: [],
      changes: [{ name: "GET /q", operation: "modified", before: "a", after: "b", detail: "d", hunks: ["h1"] }] }],
  });
  const n = (r) => normalize(r, aliases, files);
  const clean = n(good());
  assert.equal(clean.omitted, undefined);
  for (const [name, mutate, expect] of [
    ["flowchart TD; (trailing semicolon)", (r) => { r.recap.architecture.mermaid = r.recap.architecture.mermaid.replace("TD", "TD;"); }, { same: true }],
    ["unquoted node label A[A]", (r) => { r.recap.architecture.mermaid = r.recap.architecture.mermaid.replace('A["Caller"]', "A[Caller]"); }, { same: true }],
    ["A-->B without spaces", (r) => { r.recap.architecture.mermaid = r.recap.architecture.mermaid.replace("A --> B", "A-->B"); }, { same: true }],
    ["recap changes miss one file", (r) => { r.recap.changes[0].paths = ["src/a.js"]; }, { other: ["src/b.js"] }],
    ["component hunk written as [h1]", (r) => { r.recap.architecture.components[0].hunks = ["[h1]"]; }, { same: true }],
    ["a group member without matching evidence", (r) => { r.recap.architecture.groups[0].hunks = ["h1"]; }, { omitted: 1 }],
    ["contract added with before (none)", (r) => { Object.assign(r.contracts[0].changes[0], { operation: "added", before: "(none)" }); }, { contracts: 1 }],
  ]) {
    const r = good(); mutate(r);
    const w = n(r);
    assert.equal(w.parts.length, 1, name);
    if (expect.same) assert.deepEqual(w.recap, clean.recap, name);
    if (expect.other) assert.deepEqual(w.recap.other, expect.other, name);
    if (expect.omitted) assert.equal(w.omitted.recap, expect.omitted, name);
    if (expect.contracts) assert.equal(w.contracts.length, expect.contracts, name);
  }
});

test("legacy saved reports remain readable and recap page offers regeneration", () => {
  const r = raw(); delete r.recap;
  assert.equal(norm(r).recap, null);
  assert.match(recapMarkdown(null), /Regenerate/);
});

test("generation asks for all changes, evidence-based motivations and localized Mermaid labels", () => {
  const p = buildPrompt({ digest: "diff", fileCount: 3, hunkCount: 2, what: "Changes", language: "pl" });
  assert.match(p.system, /ALL changes/);
  assert.match(p.system, /label inferred motivation as inferred/);
  assert.match(p.system, /architecture description and diagram labels/);
  assert.match(p.system, /No HTML, backticks, links/);
});

test("prose is asked for as plain sentences with code in backticks, since it is drawn as Markdown", () => {
  const p = buildPrompt({ digest: "diff", fileCount: 1, hunkCount: 1, what: "Changes" });
  assert.match(p.system, /shown as Markdown/);
  assert.match(p.system, /single backticks/);
  assert.doesNotMatch(p.system, /no markdown/);
});
