import assert from "node:assert/strict";
import { test } from "node:test";

import { notionArgs, notionSettings, sendPage } from "../mods/walkthrough/lib/notion.js";

const ID = "1a2b3c4d-0000-4000-8000-0123456789ab";

test("notionArgs keeps any title inside the frontmatter, joined to --content", () => {
  const title = 'He said "hi"\n--- not a fence';
  const args = notionArgs({ title, parent: "page:abc" });
  assert.deepEqual(args.slice(0, 3), ["pages", "create", "--json"]);
  assert.equal(args[3], `--content=---\ntitle: ${JSON.stringify(title)}\n---\n`);
  assert.equal(args[3].split("\n").length, 4);
  assert.deepEqual(args.slice(4), ["--parent", "page:abc"]);
  assert.deepEqual(notionArgs({ title: "---", parent: "" }).slice(4), []);
});

test("notionSettings: this mod's own, else notion-notes', else ntn and no parent", () => {
  assert.deepEqual(notionSettings({ ntn: "/bin/ntn", parent: "page:1" }, { ntn: "other", parents: [{ ref: "page:2" }] }), { ntn: "/bin/ntn", parent: "page:1" });
  assert.deepEqual(notionSettings({ ntn: "", parent: "" }, { ntn: "other", parents: [{ ref: "page:2" }, { ref: "page:3" }] }), { ntn: "other", parent: "page:2" });
  assert.deepEqual(notionSettings(undefined, {}), { ntn: "ntn", parent: "" });
});

/** An exec that answers the create call, then the edit, and records what it was asked. */
function fakeExec(edit = { code: 0, stdout: "", stderr: "" }) {
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push([cmd, args]);
    return cmd === "sh" ? edit : { code: 0, stdout: JSON.stringify({ id: ID, url: "https://www.notion.so/Walk-1a2b" }), stderr: "" };
  };
  return { exec, calls };
}

test("sendPage creates the page, then writes the text into it from a file", async () => {
  const { exec, calls } = fakeExec();
  const files = {};
  const url = await sendPage(exec, async (p, t) => { files[p] = t; }, { title: "T", markdown: "## T\n\nSteps", ntn: "ntn", parent: "page:p", path: "/d/notion.md" });
  assert.equal(url, "https://www.notion.so/Walk-1a2b");
  assert.deepEqual(calls[0], ["ntn", notionArgs({ title: "T", parent: "page:p" })]);
  // The id and the file travel as positional arguments, never inside the script.
  assert.deepEqual(calls[1], ["sh", ["-c", '"$1" pages edit "$2" < "$3"', "sh", "ntn", ID, "/d/notion.md"]]);
  // An empty frontmatter first: pages edit strips a leading one.
  assert.equal(files["/d/notion.md"], "---\n---\n## T\n\nSteps");
});

test("sendPage names the page it created when writing into it fails", async () => {
  const { exec } = fakeExec({ code: 1, stdout: "", stderr: "rate limited\nmore" });
  await assert.rejects(sendPage(exec, async () => {}, { title: "T", markdown: "x", ntn: "ntn", parent: "", path: "/f" }),
    (err) => err.message.includes("https://www.notion.so/Walk-1a2b") && err.message.includes("rate limited") && !err.message.includes("more"));
});

test("sendPage reports ntn failing before any page exists", async () => {
  const exec = async () => ({ code: 1, stdout: "", stderr: "not logged in" });
  await assert.rejects(sendPage(exec, async () => {}, { title: "T", markdown: "x", ntn: "ntn", parent: "", path: "/f" }), /^Error: not logged in$/);
  const missing = async () => { throw new Error("spawn ntn ENOENT"); };
  await assert.rejects(sendPage(missing, async () => {}, { title: "T", markdown: "x", ntn: "ntn", parent: "", path: "/f" }), /Couldn't run ntn/);
});
