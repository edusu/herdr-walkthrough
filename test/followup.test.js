import { test } from "node:test";
import assert from "node:assert/strict";
import { FOLLOW_UPS, followPrompt, readFollowUp, withFollowUp, followUpsOf } from "../mods/walkthrough/lib/followup.js";

const STEP = {
  id: "s2", title: "Retry queue for failed uploads", text: "Uploads that fail with a 503 are queued.",
  found: [{
    file: { path: "src/retry.js" },
    hunk: { header: "@@ -10,3 +10,3 @@ function retry", oldStart: 10, newStart: 10, lines: [" keep", "-old", "+new", " keep"] },
  }],
};
const ask = (kind, language) => followPrompt({ kind, step: STEP, title: "Uploads retry", what: "uncommitted changes in app", language });

test("the prompt holds the step and its code, each line with its number", () => {
  const { prompt } = ask("deeper");
  assert.match(prompt, /Retry queue for failed uploads/);
  assert.match(prompt, /Uploads that fail with a 503 are queued\./);
  assert.match(prompt, /=== src\/retry\.js/);
  // The removed line keeps its old number, the added one gets the new file's.
  assert.match(prompt, /^- 11: old$/m);
  assert.match(prompt, /^\+ 11: new$/m);
  assert.match(prompt, /^  12: keep$/m);
});

test("each kind asks for something else, in the reader's language", () => {
  assert.notEqual(ask("deeper").system, ask("technical").system);
  assert.doesNotMatch(ask("deeper", "en").system, /Spanish/);
  assert.match(ask("deeper", "es").system, /Spanish/);
});

test("an answer is its trimmed text, and an empty one is refused", () => {
  assert.equal(readFollowUp({ text: "  It backs off.  " }), "It backs off.");
  assert.throws(() => readFollowUp({ text: " " }));
  assert.throws(() => readFollowUp(null));
});

test("answers are kept per step and kind, without touching the entry given", () => {
  const entry = { key: "k", walkthrough: {} };
  const one = withFollowUp(entry, "s2", "technical", { text: "T", cost: 0.001 });
  const two = withFollowUp(one, "s2", "deeper", { text: "D", cost: null });
  assert.equal(entry.followUps, undefined);
  assert.deepEqual(followUpsOf(one, "s2").map((f) => f.key), ["technical"]);
  // Shown in the buttons' order, whatever order they were asked in.
  assert.deepEqual(followUpsOf(two, "s2").map((f) => [f.name, f.text]), [[FOLLOW_UPS[0].name, "D"], [FOLLOW_UPS[1].name, "T"]]);
  assert.deepEqual(followUpsOf(two, "s1"), []);
});
