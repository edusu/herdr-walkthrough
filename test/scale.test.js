import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TEXT, DEFAULTS, BOUNDS, px, grow, setSizes } from "../mods/walkthrough/lib/scale.js";

test("the defaults draw at the old sizes", () => {
  setSizes({});
  assert.equal(TEXT.base, 13);
  assert.equal(TEXT.caret, 9);
  assert.equal(grow(28), 28);
  assert.equal(px(44), 44);
});

test("font_size moves the text and the rows holding it, not the icons", () => {
  setSizes({ font_size: 16.5 });
  assert.equal(TEXT.base, 16.5);
  assert.equal(TEXT.page / TEXT.base, 18 / 13);
  assert.equal(grow(28), 36);
  assert.equal(px(44), 44);
});

test("scale moves icons and heights, not the text; heights are whole px", () => {
  setSizes({ scale: 1.25 });
  assert.equal(TEXT.base, 13);
  assert.equal(px(44), 55);
  assert.ok(Number.isInteger(grow(15)));
  assert.equal(grow(15), 19);
  setSizes({ scale: 9, font_size: "big" });
  assert.equal(px(10), 16);
  assert.equal(TEXT.base, 13);
  setSizes({});
});

test("mod.schema.json describes the same defaults and bounds", () => {
  const schema = JSON.parse(readFileSync(new URL("../mods/walkthrough/mod.schema.json", import.meta.url), "utf8"));
  for (const key of ["font_size", "scale"]) {
    const spec = schema.properties.settings.properties[key];
    assert.deepEqual([spec.default, spec.minimum, spec.maximum], [DEFAULTS[key], ...BOUNDS[key]], key);
  }
});
