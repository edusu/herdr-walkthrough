import { test } from "node:test";
import assert from "node:assert/strict";
import { linkify, whereIs, isWebLink } from "../mods/walkthrough/lib/links.js";

const PATHS = ["src/app/main.js", "src/lib/retry.js", "test/main.js", "README.md"];

test("a path with a line becomes a link", () => {
  const out = linkify("The queue in src/lib/retry.js:40 backs off.", PATHS);
  assert.equal(out.markdown, "The queue in [src/lib/retry.js:40](walkthrough:0) backs off.");
  assert.deepEqual(out.links, [{ path: "src/lib/retry.js", line: 40 }]);
});

test("a range links to its first line, and a bare path has no line", () => {
  const out = linkify("See retry.js:12-18 and README.md.", PATHS);
  assert.equal(out.markdown, "See [retry.js:12-18](walkthrough:0) and [README.md](walkthrough:1).");
  assert.deepEqual(out.links, [{ path: "src/lib/retry.js", line: 12 }, { path: "README.md", line: null }]);
});

test("a name two files end with is left as text", () => {
  assert.equal(linkify("Both main.js files change.", PATHS), null);
});

test("text without a file of the diff has no links", () => {
  assert.equal(linkify("Retries wait 2.5 seconds, e.g. after a 503 from api/v2.", PATHS), null);
});

test("markdown in the prose around a link is escaped", () => {
  const out = linkify("Sets *max_tries* in README.md", PATHS);
  assert.equal(out.markdown, "Sets \\*max\\_tries\\* in [README.md](walkthrough:0)");
});

test("prose that starts like a list or a heading stays a sentence", () => {
  assert.equal(linkify("- keeps README.md", PATHS).markdown, "\\- keeps [README.md](walkthrough:0)");
  assert.equal(linkify("# of tries, in README.md", PATHS).markdown, "\\# of tries, in [README.md](walkthrough:0)");
  assert.equal(linkify("3. README.md changes", PATHS).markdown, "3\\. [README.md](walkthrough:0) changes");
});

test("in Markdown, a code span that names a file becomes the link and the rest is kept as written", () => {
  const out = linkify("Retries in `retry.js:40` and README.md use `max_tries`, not `src/lib/retry.js x`.", PATHS, { markdown: true });
  assert.equal(out.markdown, "Retries in [`retry.js:40`](walkthrough:0) and [README.md](walkthrough:1) use `max_tries`, not `src/lib/retry.js x`.");
  assert.deepEqual(out.links, [{ path: "src/lib/retry.js", line: 40 }, { path: "README.md", line: null }]);
  assert.equal(linkify("Only `max_tries` here.", PATHS, { markdown: true }), null);
});

const hunk = (id, newStart, newLines) => ({ id, newStart, newLines });
const VIEW = {
  steps: [
    { found: [{ file: { path: "a.js", scope: "working" }, hunk: hunk("h1", 10, 5) }] },
    { found: [{ file: { path: "a.js", scope: "working" }, hunk: hunk("h2", 80, 3) }, { file: { path: "b.js", scope: "working" }, hunk: hunk("h3", 1, 4) }] },
  ],
  uncovered: [
    { file: { path: "a.js", scope: "working" }, hunks: [hunk("h4", 200, 2)] },
    { file: { path: "c.lock", scope: "working" }, hunks: [] },
  ],
};

test("a line goes to the step whose hunk holds it", () => {
  assert.deepEqual(whereIs(VIEW, "a.js", 81), { step: 1 });
});

test("a line only Not covered holds goes to that file there", () => {
  assert.deepEqual(whereIs(VIEW, "a.js", 201), { file: "working:a.js" });
});

test("a path alone, or a line no hunk holds, goes to the file's first step", () => {
  assert.deepEqual(whereIs(VIEW, "a.js"), { step: 0 });
  assert.deepEqual(whereIs(VIEW, "a.js", 5000), { step: 0 });
});

test("a file no step touches goes to Not covered, and an unknown one nowhere", () => {
  assert.deepEqual(whereIs(VIEW, "c.lock"), { file: "working:c.lock" });
  assert.equal(whereIs(VIEW, "nope.js", 3), null);
});

test("only web links in the model's prose open", () => {
  assert.ok(isWebLink("https://example.com/a") && isWebLink("HTTP://example.com"));
  for (const url of ["file:///etc/passwd", "javascript:alert(1)", "vscode://file/x", "walkthrough:0", "/usr/bin/open", ""]) assert.equal(isWebLink(url), false);
});
