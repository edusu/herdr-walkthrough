import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The installed copy's mod.json is how someone tells which release they have, and the
// update check compares the latest release with VERSION: all three must agree, or a
// release would keep offering itself as an update.
const root = new URL("../", import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));

test("mod.json and the update check carry the package version", async () => {
  const { version } = read("package.json");
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(read("mods/walkthrough/mod.json").version, version);
  const { VERSION } = await import(new URL("mods/walkthrough/lib/update.js", root));
  assert.equal(VERSION, version);
});
