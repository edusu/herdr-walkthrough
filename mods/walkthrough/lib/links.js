// File mentions in the model's prose ("src/retry.js:40") as links into the
// walkthrough. Only a file of the shown diff is linked, so a version number or
// a URL path never is.

// A run of path characters, then an optional :line or :start-end.
const MENTION = /([\w@.+\/-]+)(?::(\d+)(?:-\d+)?)?/g;

const escape = (s) => s.replace(/[\\`*_[\]<>#~|&]/g, "\\$&");
// What would open a list at the start of a paragraph.
const escapeStart = (s) => s.replace(/^(\s*)([-+]|\d+(?=[.)]))(.)/, (_m, space, mark, next) => (/\d/.test(mark) ? `${space}${mark}\\${next}` : `${space}\\${mark}${next}`));

/** The diff's file a mention names: the path itself, or the one file ending with it. */
function resolve(name, paths) {
  if (!/[.\/]/.test(name)) return null;
  if (paths.includes(name)) return name;
  const ending = paths.filter((p) => p.endsWith(`/${name}`));
  return ending.length === 1 ? ending[0] : null;
}

/**
 * One paragraph of prose as Markdown whose file mentions are links,
 * "walkthrough:<index>" into `links`; null when it mentions no file of the diff.
 * @param {string} text plain prose, without line breaks
 * @param {string[]} paths the diff's files
 * @returns {{ markdown: string, links: { path: string, line: number | null }[] } | null}
 */
export function linkify(text, paths) {
  const links = [];
  let markdown = "", last = 0;
  for (const m of text.matchAll(MENTION)) {
    // A sentence's full stop is not the file's.
    const name = m[1].replace(/[.-]+$/, "");
    const path = resolve(name, paths);
    if (!path) continue;
    const label = m[2] && name === m[1] ? m[0] : name;
    markdown += `${escape(text.slice(last, m.index))}[${escape(label)}](walkthrough:${links.length})`;
    links.push({ path, line: label === name ? null : Number(m[2]) });
    last = m.index + label.length;
  }
  return links.length ? { markdown: escapeStart(markdown + escape(text.slice(last))), links } : null;
}

/**
 * Where a file (and line) is in an `overlay` view: the step whose hunk holds
 * the line, else Not covered when a hunk there does, else the file's first
 * step, else its row under Not covered.
 * @returns {{ step: number } | { file: string } | null} file: "<scope>:<path>", as Not covered names its rows
 */
export function whereIs(view, path, line = null) {
  const holds = (h) => line !== null && line >= h.newStart && line < h.newStart + h.newLines;
  const stepWith = (test) => view.steps.findIndex((s) => s.found.some((f) => f.file.path === path && test(f.hunk)));
  const rowWith = (test) => view.uncovered.find((u) => u.file.path === path && test(u));
  const row = (u) => (u ? { file: `${u.file.scope}:${u.file.path}` } : null);
  const exact = stepWith(holds);
  if (exact >= 0) return { step: exact };
  const first = stepWith(() => true);
  return row(rowWith((u) => u.hunks.some(holds))) ?? (first >= 0 ? { step: first } : row(rowWith(() => true)));
}
