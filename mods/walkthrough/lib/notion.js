// A walkthrough as a Notion page, through Notion's CLI (`ntn`), made the way the notion-notes
// mod makes its pages. Nothing is imported from that mod: a mod never reaches into another's folder.

const firstLine = (s) => String(s ?? "").trim().split("\n")[0];
const ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/**
 * The `ntn` to run and the parent of the page: this mod's `notion` setting, else the
 * notion-notes mod's own settings (its `ntn` and first parent), else `ntn` and no parent,
 * which makes a private page in the workspace.
 */
export function notionSettings(own, notes) {
  return { ntn: own?.ntn || notes?.ntn || "ntn", parent: own?.parent || notes?.parents?.[0]?.ref || "" };
}

/** The `ntn` arguments that create an empty page titled `title`, under `parent` when there is one. */
export function notionArgs({ title, parent }) {
  // JSON strings are valid YAML, so any title survives the frontmatter. The value is joined
  // with `=`: as a separate argument, ntn takes its leading `---` for an unknown flag.
  const args = ["pages", "create", "--json", `--content=---\ntitle: ${JSON.stringify(title)}\n---\n`];
  if (parent) args.push("--parent", parent);
  return args;
}

/**
 * Creates the page, then writes `markdown` into it from the file at `path` (`write(path, text)`).
 * A failure after the page exists names it, so it can be found and removed.
 * @returns {Promise<string>} the page's URL
 */
export async function sendPage(exec, write, { title, markdown, ntn, parent, path }) {
  const run = async (cmd, args) => {
    let r;
    try { r = await exec(cmd, args, { timeout: 60000 }); } catch (e) { throw new Error(`Couldn't run ${ntn}: ${firstLine(e?.message ?? e)}`); }
    if (r.code !== 0) throw new Error(firstLine(r.stderr || r.stdout) || `${ntn} exited with ${r.code}`);
    return r.stdout;
  };
  const out = await run(ntn, notionArgs({ title, parent }));
  let page = null;
  try { page = JSON.parse(out); } catch { page = null; }
  if (!ID.test(page?.id ?? "")) throw new Error(`Unexpected output from ${ntn}: ${firstLine(out)}`);
  const url = /^https:\/\/[^\s]+$/.test(page.url ?? "") ? page.url : `https://www.notion.so/${page.id.replace(/-/g, "")}`;
  try {
    // `pages edit` strips a leading frontmatter block; an empty one keeps the text's own first lines.
    await write(path, `---\n---\n${markdown}`);
    // exec has no stdin: the shell redirects the file, and the id travels only as a positional argument.
    await run("sh", ["-c", '"$1" pages edit "$2" < "$3"', "sh", ntn, page.id, path]);
  } catch (err) {
    throw Object.assign(new Error(`Created the page ${url}, but couldn't write the walkthrough into it: ${err?.message ?? err}`), { url });
  }
  return url;
}
