// Comments made on diff lines, gathered into one message for an agent. The
// line's code goes with each one, so the agent can find it even after the
// numbers have moved.

import { clip } from "./task.js";

/**
 * @param {{ scope?: string, path: string, line: number, kind: string, code: string, text: string }[]} comments
 * @param {string} what the source they were made on
 * @param {{ mixed?: boolean }} options mixed: the diff holds staged and unstaged copies of files, so say which
 */
export function formatComments(comments, what, { mixed = false } = {}) {
  const items = comments.map((c) => {
    const notes = [c.kind === "-" ? "removed line" : "", mixed && c.scope === "staged" ? "staged version" : mixed && c.scope === "working" ? "unstaged version" : ""].filter(Boolean);
    const where = `${c.path}:${c.line}${notes.length ? ` (${notes.join(", ")})` : ""}`;
    const code = c.code.trim() ? ` \`${c.code.trim().slice(0, 160)}\`` : "";
    return `- ${where}${code}: ${c.text.trim()}`;
  });
  return `Comments from reading the walkthrough of ${what}\n${items.join("\n")}`;
}

/** One line of one diff: its source, its scope (staged or unstaged copy), path, number and side. */
export const sameSpot = (a, b) => a.sk === b.sk && a.scope === b.scope && a.path === b.path && a.line === b.line && a.kind === b.kind;

/** The same line is commented once; a new comment replaces the old one. */
export function addComment(comments, comment) {
  return [...comments.filter((c) => !sameSpot(c, comment)), comment];
}

/**
 * A question about one step, for the agent in its terminal: the step's place,
 * title and explanation, and the lines it covers per file (no code: the agent
 * has the files). The step is clipped, the question never.
 * @param {{ position: number, title: string, text: string, outdated?: boolean, missing?: number, found: { file: { path: string }, hunk: { oldStart: number, oldLines: number, newStart: number, newLines: number } }[] }} step
 * @param {string} what the source the walkthrough is of
 * @param {string} question
 */
export function formatQuestion(step, what, question) {
  const files = new Map();
  for (const { file, hunk } of step.found) {
    // A hunk that only removes lines has nothing left in the new file: where it was in the old one.
    const [start, count] = hunk.newLines === 0 ? [hunk.oldStart, hunk.oldLines] : [hunk.newStart, hunk.newLines];
    files.set(file.path, [...(files.get(file.path) ?? []), `${count > 1 ? `${start}-${start + count - 1}` : start}${hunk.newLines === 0 ? " removed" : ""}`]);
  }
  const listed = [...files].slice(0, 20).map(([path, spans]) => `${path} (line${spans.length > 1 || /^\d+-/.test(spans[0]) ? "s" : ""} ${spans.join(", ")})`);
  if (files.size > listed.length) listed.push(`and ${files.size - listed.length} more`);
  return [
    `Question about step ${step.position}, "${clip(step.title, 200)}", of the walkthrough of ${what}`,
    `The step says: ${clip(step.text, 1500)}`,
    listed.length ? `Files: ${listed.join(", ")}` : "",
    step.outdated ? `Note: the step is outdated: ${step.missing ? `${step.missing} of its hunks has` : "its code has"} changed or is gone since it was written.` : "",
    `Question: ${question.trim()}`,
  ].filter(Boolean).join("\n");
}
