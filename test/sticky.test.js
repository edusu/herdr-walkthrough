import { test } from "node:test";
import assert from "node:assert/strict";
import { stuckHeader } from "../mods/walkthrough/lib/sticky.js";

test("a file's header stays pinned while its rows pass the top, and the next header pushes it out", () => {
  // The card's first file starts 100px down the page: a 200px file, then a 300px one, 36px headers.
  const at = (offset) => stuckHeader(offset, 100, [200, 300], 36);
  assert.equal(at(50), null, "the card hasn't reached the top");
  assert.equal(at(100), null, "the header is at the top on its own");
  assert.deepEqual(at(150), { index: 0, shift: 0 });
  assert.deepEqual(at(280), { index: 0, shift: -16 }, "20px of the first file left: the next header pushes it up");
  assert.deepEqual(at(301), { index: 1, shift: 0 });
  assert.equal(at(700), null, "past the card");
  assert.equal(stuckHeader(150, 100, [200, undefined], 36), null, "not measured yet: nothing is pinned");
});
