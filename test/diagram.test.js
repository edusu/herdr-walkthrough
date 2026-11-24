import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutDiagram, parseMermaid, wrapLabel } from "../mods/walkthrough/lib/diagram.js";
import { recapMarkdown } from "../mods/walkthrough/lib/export.js";

const source = 'flowchart TB\nA["Panel użytkownika"]\nB["Warstwa zapytań"]\nC["Baza danych"]\nD["Serwer MCP"]\nA --> B\nD --> B\nB --> C\nA --> C';
function checkGeometry(g) {
  for (const n of g.nodes) {
    assert.ok(n.x >= 0 && n.y >= 0 && n.x + n.width <= g.width && n.y + n.height <= g.height);
    for (const other of g.nodes) if (other.id !== n.id) assert.ok(n.x + n.width <= other.x || other.x + other.width <= n.x || n.y + n.height <= other.y || other.y + other.height <= n.y, 'nodes do not overlap');
  }
  for (const e of g.edges) {
    assert.equal(e.arrow.length, 3);
    for (const [x,y] of [...e.points, ...e.arrow]) assert.ok(Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x <= g.width && y <= g.height);
    assert.deepEqual(e.arrow[0], e.points.at(-1));
    const b = g.nodes.find((n) => n.id === e.to), [x,y] = e.points.at(-1);
    assert.ok(x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height, 'arrow terminates on target');
  }
}
test('rendered graph preserves labels, edge direction, branches and long edges', () => {
  const g = layoutDiagram(source);
  assert.equal(g.nodes.length, 4); assert.equal(g.edges.length, 4);
  assert.equal(g.nodes.find((n) => n.id === 'A').label, 'Panel użytkownika');
  assert.ok(g.nodes.find((n) => n.id === 'C').y > g.nodes.find((n) => n.id === 'B').y);
  checkGeometry(g);
  assert.deepEqual(layoutDiagram(source),g);
});
test('LR and TD directions render as requested', () => {
  const g = layoutDiagram(source.replace('TB','LR'));
  assert.ok(g.nodes.find((n) => n.id === 'C').x > g.nodes.find((n) => n.id === 'B').x);
  checkGeometry(g); checkGeometry(layoutDiagram(source.replace('TB','TD')));
});
test('cycles, self-loops and isolated nodes retain all relationships', () => {
  for (const dir of ['TB','LR']) {
    const g = layoutDiagram(`flowchart ${dir}\nA["A"]\nB["B"]\nC["Isolated"]\nD["Next"]\nA --> B\nB --> A\nA --> A\nB --> D`);
    checkGeometry(g); assert.equal(g.nodes.length,4); assert.equal(g.edges.length,4);
  }
  checkGeometry(layoutDiagram('flowchart TB\nA["Docs"]'));
});
test('untrusted Mermaid cannot become executable content or invalid geometry', () => {
  for (const text of ['flowchart TB\nA --> B','flowchart TB\nA["<img>"]','flowchart TB\nA["A"]\nclick A "url"']) assert.throws(() => parseMermaid(text));
});
test('long labels wrap without losing text and fit their box', () => {
  const label = 'A'.repeat(70) + ' etykieta użytkownika';
  assert.equal(wrapLabel(label).join('').replaceAll(' ',''),label.replaceAll(' ',''));
  const g=layoutDiagram(`flowchart LR\nA["${label}"]`);
  assert.ok(g.nodes[0].height >= g.nodes[0].lines.length*17+24); checkGeometry(g);
});
test('native recap can separate diagram from prose without changing Markdown export', () => {
  const recap = { changes: [{ description: 'Change', motivation: 'Why', paths: ['a'] }], architecture: { description: 'Data flow', mermaid: source } };
  assert.doesNotMatch(recapMarkdown(recap,{diagram:false,architecture:false}),/Architecture|mermaid|Data flow/);
  assert.ok(recapMarkdown(recap).includes('```mermaid\n'+source));
});

// A blueprint must keep fan-out/fan-in distinguishable at the component boundary.
test('branches use distinct ports and all connector segments remain orthogonal', () => {
  for (const dir of ['TB', 'LR']) {
    const g = layoutDiagram(`flowchart ${dir}\nA["Entry"]\nB["First"]\nC["Second"]\nD["Storage"]\nA --> B\nA --> C\nB --> D\nC --> D`);
    checkGeometry(g);
    const starts = g.edges.filter((e) => e.from === 'A').map((e) => e.points[0]);
    const ends = g.edges.filter((e) => e.to === 'D').map((e) => e.points.at(-1));
    assert.notDeepEqual(starts[0], starts[1]);
    assert.notDeepEqual(ends[0], ends[1]);
    for (const e of g.edges) for (let i = 1; i < e.points.length; i++) {
      const a = e.points[i - 1], b = e.points[i];
      assert.ok(a[0] === b[0] || a[1] === b[1], 'right-angle routing');
    }
  }
});

test('reserved Mermaid words as ids are renamed consistently, so exports stay renderable', async () => {
  const { canonicalMermaid } = await import('../mods/walkthrough/lib/diagram.js');
  const { normalizeComponents } = await import('../mods/walkthrough/lib/blueprint.js');
  const { normalizeConnections } = await import('../mods/walkthrough/lib/connections.js');
  const src = canonicalMermaid('flowchart TB\nA["Start"]\nend["Finish"]\nA --> end');
  assert.equal(src, 'flowchart TB\nA["Start"]\nend_["Finish"]\nA --> end_');
  assert.doesNotMatch(src, /(^|\s)end(\s|$)/m);
  const files = [{ path: 'a.js', status: 'modified', aliases: ['h1'] }], aliases = { h1: 'id1' };
  const comps = normalizeComponents([{ id: 'end', status: 'modified', responsibility: 'r', change: 'c', paths: [], hunks: ['h1'] }], src, aliases, files);
  assert.equal(comps[0].id, 'end_');
  assert.equal(normalizeConnections([{ from: 'A', to: 'end', label: 'finishes', hunks: ['h1'] }], src, aliases, files)[0].to, 'end_');
});
test('loop detours stay in the gap between layers whatever outer lanes came first', () => {
  for (const dir of ['TB', 'LR']) {
    const d = `flowchart ${dir}\nA["A"]\nB["B"]\nC["C"]\nD["D"]\nE["E"]\nA --> B\nB --> C\nC --> D\nD --> E\nA --> C\nA --> D\nB --> E\nC --> B`;
    const labels = parseMermaid(d).edges.map((e) => ({ ...e, label: 'x' }));
    const g = layoutDiagram(d, labels);
    for (const e of g.edges) for (let i = 1; i < e.points.length; i++) {
      const [a, b] = [e.points[i - 1], e.points[i]];
      const seg = { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]) || 1, height: Math.abs(a[1] - b[1]) || 1 };
      for (const n of g.nodes) {
        if (n.id === e.from || n.id === e.to) continue;
        const hit = seg.x < n.x + n.width && seg.x + seg.width > n.x && seg.y < n.y + n.height && seg.y + seg.height > n.y;
        assert.ok(!hit, `${dir} ${e.from}->${e.to} crosses ${n.id}`);
      }
    }
  }
});
