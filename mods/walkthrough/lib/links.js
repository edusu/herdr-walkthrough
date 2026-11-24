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
 * Prose as Markdown whose file mentions are links, "walkthrough:<index>" into
 * `links`; null when it mentions no file of the diff.
 * @param {string} text plain prose, one paragraph without line breaks; with `markdown`, Markdown kept as written
 * @param {string[]} paths the diff's files
 * @param {{ markdown?: boolean }} [options] markdown: a code span that is only a mention becomes the link's label; other code is left alone
 * @returns {{ markdown: string, links: { path: string, line: number | null }[] } | null}
 */
export function linkify(text, paths, { markdown = false } = {}) {
  const links = [];
  const link = (label, path, line) => `[${label}](walkthrough:${links.push({ path, line }) - 1})`;
  const mentions = (part, keep) => {
    let out = "", last = 0;
    for (const m of part.matchAll(MENTION)) {
      // A sentence's full stop is not the file's.
      const name = m[1].replace(/[.-]+$/, "");
      const path = resolve(name, paths);
      if (!path) continue;
      const label = m[2] && name === m[1] ? m[0] : name;
      out += `${keep(part.slice(last, m.index))}${link(escape(label), path, label === name ? null : Number(m[2]))}`;
      last = m.index + label.length;
    }
    return out + keep(part.slice(last));
  };
  if (!markdown) {
    const out = mentions(text, escape);
    return links.length ? { markdown: escapeStart(out), links } : null;
  }
  const out = text.replace(/(`+)([^`]+)\1|[^`]+|`+/g, (all, ticks, code) => {
    if (!ticks) return mentions(all, (s) => s);
    const m = new RegExp(`^${MENTION.source}$`).exec(code.trim());
    const path = m && resolve(m[1], paths);
    return path ? link(all, path, m[2] ? Number(m[2]) : null) : all;
  });
  return links.length ? { markdown: out, links } : null;
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
