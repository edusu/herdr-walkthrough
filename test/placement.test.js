import test from "node:test";
import assert from "node:assert/strict";
import { placementOf } from "../mods/walkthrough/lib/placement.js";

test("a copy's Placement: a dialog over its tab, a pane beside the agent, or a tab of its own", () => {
  const panes = [{ pane: "p1", tab: "t1" }, { pane: "p2", tab: "t1" }, { pane: "p3", tab: "t2" }];
  assert.equal(placementOf({ overlay: "o1" }, panes, "t1"), "dialog");
  assert.equal(placementOf({ pane: "p2" }, panes, "t1"), "pane");
  assert.equal(placementOf({ pane: "p3" }, panes, "t1"), "tab");
  // Opened as a tab by another mod, without an Origin tab: alone in its tab.
  assert.equal(placementOf({ pane: "p3" }, panes, "t2"), "tab");
  // A pane Herdr doesn't list (yet): beside something.
  assert.equal(placementOf({ pane: "p9" }, panes, "t1"), "pane");
});
