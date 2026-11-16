# Integrations plan

Plan for `edusu/herdr-walkthrough`, a fork of `dmazlum/herdr-walkthrough` (at `2812486`, 0.8.1).
Run it slice by slice with `/implement-plan plans/integrations-plan.md`.

The mod turns a diff into an ordered, explained reading. Today it is reached only with ⌘⇧E
and its own scope tabs, and it knows nothing about the other installed mods. This plan adds a
commit-range scope, questions about a step, a task found from a GitHub issue, a Notion export,
and a way for other mods to open a walkthrough of a given commit, range, pull request or file.

## Orchestrator overrides

These replace the defaults of the `implement-plan` skill for this plan:

- Launch each slice's subagent with `model: "opus"` (Opus 5.5) and `effort: "medium"`, not
  Sonnet at high effort. The user asked for this explicitly.
- The skill's brief template names Rust commands (`cargo`, `make`). They do not apply here;
  use the verification commands under "Rules for every slice".
- Slices B1 and B2 change another repository. Run the skill's preflight and post-checks
  (`git status`, `git log`) in that repository, and tell the subagent its working directory.

## Slices

One slice is one commit. Part A is this repository; run it in order (S2 and S6 build on S1's
source and props handling, S5 on S4). Part B is other repositories and needs S6 committed.

| Slice | Goal | Done when | Status |
| --- | --- | --- | --- |
| S1 | Commit-range source | A `range` source reads `git diff <from> <to>`, has its own key, description and task (the range's commit messages), all covered by tests | Done |
| S2 | Range in the Commit tab | The Commit tab has a "from" picker; choosing an older commit walks through everything after it up to the picked commit | Done |
| S3 | Ask about a step | A question typed on a step reaches the chosen agent with the step's title, text and files | Done |
| S4 | Task from a GitHub issue | A pull request's closing issues, or the issue a branch name points at, can be the task; "Matched against" offers it | Done |
| S5 | Send to Notion | **Send to Notion** creates a page holding the walkthrough's Markdown and shows its link | Done |
| S6 | Open from other mods | Props `{scope, commit, since, pr, path}` open the walkthrough on that commit, range, pull request or file's step; documented as the contract | Pending |
| B1 | Branch PR opens it | In `herdr-mods/branch-pr`, a PR's header has **Walkthrough**, shown only when the mod is installed | Pending |
| B2 | Git Graph opens it | In `herdr-git-graph`, a commit's right-click menu has "Walkthrough of this commit" and "Walkthrough from this commit to HEAD" | Pending |

## Repository facts

- Runtime: `mods/walkthrough/`. `view.js` (1370 lines) is the whole UI and state; `engine.js`
  is everything that touches the machine (git, cache, jobs, clipboard, gh); `lib/*.js` are
  pure functions that take `exec` as an argument, so `node --test` loads them without Herdr.
- A source is `{ kind, ... }`. Every kind is handled in four places in `lib/sources.js`
  (`SCOPES`, `sourceKey`, `describe`, `loadSections`), in `resolveTask` (`lib/task.js`), and in
  `Walkthrough.source()` and `taskFor()` in `view.js`.
- The task is resolved in `view.js: taskFor` and shaped by `lib/task.js: resolveTask`, which
  returns `{ from, label, short, about, text, context }`. `taskCacheKey` feeds the cache key.
- Other mods are opened with props: `init` reads `props()` (`folder`, `scope`, `tab`, `from`,
  `overlay`, `pane`). `openAs` (view.js, near line 770) shows the two commands in use:
  `run("tab.new", { name, space, mod, props })` and `run("pane.split", { direction, mod, props })`.
- `RECIPE.md` describes every screen and behaviour; `README.md` has the user-facing tables
  (tabs, keys, Limits, Privacy and cost, what's stored). Each slice updates the lines it
  changes in both, in the same commit.
- `mod.schema.json` describes every setting; `test/version.test.js` checks `mod.json` against
  `package.json`. A new setting goes in the schema, with its default, in the same commit.
- The Herdr API types are in `~/.config/herdr-app/herdr.d.ts` and `gpui-kit.d.ts`; the app's
  mod guide is `~/.config/herdr-app/AGENTS.md`. Read them before using an API this mod does
  not already use.
- Branch: `development`. Remote `origin` is the fork. `npm test` passes (98 tests) at the start.

## Rules for every slice

- All text in code is English. Comment only the non-obvious why, below the density of the
  surrounding file. `view.js` uses dense single-line style; match it. JSDoc for doc comments.
- Least new code. Reuse what the mod has (`git`, `must`, `gh`, `ghError`, `picker`, `button`,
  `chip`, `flash`, `copyText`'s write-to-a-file pattern, `clip`) before adding helpers. No new
  dependency, no build step.
- External programs get argument arrays. Never interpolate a commit subject, issue text, a
  title or a path into a shell string. Text that must reach a program's stdin goes through a
  file, as `copyText` and `postComment` do (`exec` takes no input).
- Issue text, pull request text and commit messages are untrusted. They reach the model only
  through `taskBlock` in `lib/prompt.js`, clipped to `MAX_TASK_CHARS`.
- Nothing is sent to a model, to GitHub or to Notion without a click, except what the README's
  "Privacy and cost" already lists. A slice that adds a network call on opening says so there.
- New non-trivial logic gets one small test in `test/`, written against the pure function,
  with a fake `exec` or a real temporary repository as the neighbouring tests do.
- Verification for every slice: `npm test`, then
  `cp -R mods/walkthrough ~/.config/herdr-app/mods/ && herdr-app check ~/.config/herdr-app/mods/walkthrough`
  (Herdr must be running; copy, never symlink). State in the report which "Done when" checks
  were not run by hand; UI behaviour cannot be exercised headlessly.
- Do not bump the version, do not push, and do not touch other mods' folders from Part A.

## S1. Commit-range source

**Problem.** The Commit scope reads one commit against its first parent, and Branch reads
everything since the base. "The last three commits" or "what came in since yesterday's
commit" cannot be read.

**Change** (`lib/sources.js`, `lib/task.js`, their tests; no UI).
- A new source `{ kind: "range", from, to, fromSubject?, toSubject? }`, both full hashes.
  It means the changes after `from` up to and including `to`: `git diff <DIFF> from to`,
  one section with scope `"range"`. It is not a new tab, so `SCOPES` is unchanged.
- `sourceKey`: `range:<from>..<to>`. `describe`: `Commits <from12>..<to12> (N commits), from
  "<subject>" to "<subject>".` N comes from the caller when known; leave it out otherwise.
- `loadSections` refuses a range whose `from` is not an ancestor of `to`
  (`git merge-base --is-ancestor`), with a sentence the empty state can show.
- `rangeMessages(exec, top, from, to)`: the messages of `from..to`, oldest first, at most
  `MAX_MESSAGES`, each through `cleanCommitMessage`; merges' generated subjects drop out as
  they do for one commit.
- `resolveTask` gets `case "range"`: `from: "commits"`, label `The messages of N commits`,
  short `N commit messages`, text built with `joinMessages` (each numbered, clipped as prompts
  are). `posted` behaviour is unchanged: only a `pr` task is posted.

**Keep.** The single `commit` source, its key and its cache entries are untouched.

**Test.** Against a real temporary repository (as `test/sources.test.js` does): a three-commit
range reads the two later commits' changes and not the first's; a non-ancestor `from` is
refused; `resolveTask` for a range numbers the messages and skips a merge subject.

## S2. Range in the Commit tab

**Change** (`view.js`, `RECIPE.md`, `README.md`).
- State `this.since = null` (a commit of `this.commits`, or null for "its parent").
- In the toolbar's second row, when the scope is `commit`: after the commit picker, a `from`
  label and a second picker listing "its parent" (the default) and the commits older than
  the picked one. `source()` returns the `range` source when `since` is set, else today's
  `commit` source. Picking a newer commit than `since` clears `since`.
- `taskFor`: `case "range"` reads `rangeMessages`, memoized in `commitTexts` under the range's
  key, with the same "null means ask again" rule as a commit.
- A range is not re-read on file changes, like a commit: extend the check near line 349
  (it tests the scope, which stays `commit`, so confirm it already holds).
- `recentCommits` lists 40 commits; that is the reach of both pickers. Say so in Limits.

**Keep.** With "its parent" chosen, every key, label and cached walkthrough is as before.

**Done when, by hand.** Pick a commit, then an older "from": the header says the range, the
diff holds every commit in between, "Matched against" says "N commit messages", Generate works,
and going back to "its parent" shows the single commit's cached walkthrough again.

## S3. Ask about a step

**Problem.** A reader who does not follow a step can only comment on a line. There is no way
to ask "why this way?" about the step as a whole.

**Change** (`lib/comments.js`, `view.js`, tests, docs).
- `formatQuestion(step, what, question)` in `lib/comments.js`, pure: one message naming the
  source (`what`), the step's position and title, its explanation, the files it covers with
  their line ranges (from the step's `found` hunks; no code, the agent has the files), then
  the question. Clipped so a long step cannot crowd the question out.
- On a step's page, an **Ask** ghost button beside "Mark read" (key `a`) opens a one-line input
  under the step's text, like the comment box. Enter sends it with `hc(["send", agent.address, ...])`
  to `this.agent()`, the same agent picker the footer shows for comments; the picker is shown
  beside the input while it is open. `flash` reports "Sent the question to <agent>." or the error.
- `this.typing` gains `"question"` so step keys do not fire while typing; Esc closes the input.
- Command `walkthrough.ask` for `keys.json`, beside the existing ones.

**Keep.** Nothing goes to the walkthrough's own model: the question is answered by the agent
in its terminal, which has the conversation and the files. No answer is shown in the dialog.

**Test.** `formatQuestion` for a step with two files, for an outdated step (say so in the
message), and for a question holding backticks and newlines.

## S4. Task from a GitHub issue

**Problem.** The task is found from prompts, a pull request's description or a commit message.
The issue the work was opened for, usually the best statement of what was asked, is not read.

**Change** (`lib/task.js`, `lib/sources.js`, `engine.js` or `view.js: taskFor`, tests, docs).
- `issueNumber(branch)` in `lib/task.js`, pure and conservative: a number at the start of the
  branch's last path segment (`123-fix-login`, `feat/123-fix-login`, `issue-123`, `gh-123`).
  Anything else is null; a bare year-like or version-like name (`2026-plan`, `v2`) is null.
- `issuesFor(exec, top, source, branch)` in `lib/sources.js`, through the existing `gh` helper:
  for a `pr` source, `gh pr view <n> --json closingIssuesReferences`, then
  `gh issue view <n> --json number,title,body` for each (at most 3); for local and branch
  sources, `gh issue view` of `issueNumber(branch)`. A failure of any kind is "no issue",
  never an error on screen. Results are memoized per source key for the session.
- `TASK_MODES` gains `{ key: "issue", name: "Issue", about: "The GitHub issue this change was made for" }`.
  `resolveTask` with `mode: "issue"` returns `from: "issue"`, label `Issue #55` (or
  `Issues #55, #60`), short `issue #55`, text `title\n\nbody` per issue through `cleanDescription`.
- `mode: "auto"` changes in one place only: when it would find nothing (no prompts, an empty
  pull request description), and an issue is found, the issue is the task. Otherwise auto
  returns what it returns today, so existing walkthroughs keep their cache keys.
- "Matched against" menu: the Issue row appears only when one was found, with the issue's
  title as its hint. The stored choice per source already handles a new mode (`taskChoice`
  validates against `TASK_MODES`).
- `markdown({ forPost })` keeps its rule: only a `pr` task is posted to a pull request.
- README "Privacy and cost": opening a Branch or local source whose branch name carries an
  issue number asks `gh` for that issue once. Nothing is sent to the model until Generate.

**Open point for the subagent.** `closingIssuesReferences` may not exist in the installed
`gh`; check `gh pr view --help`. If it is missing, parse `Fixes|Closes|Resolves #N` from the
description (pure, tested) and note the choice in the report.

**Test.** `issueNumber` for the accepted and refused shapes; `resolveTask` in `issue` mode and
auto's fallback; `issuesFor` with a faked `gh` (as `test/sources.test.js` fakes it for pull
requests), including `gh` missing and an issue number that does not exist.

## S5. Send to Notion

**Problem.** A walkthrough can be copied or posted to a pull request, but not kept with the
project's notes. The `notion-notes` mod is installed and already talks to Notion through `ntn`.

**Change** (`engine.js`, `view.js`, `mod.json`, `mod.schema.json`, tests, docs).
- Setting `notion` in `mod.json`: `{ "ntn": "", "parent": "" }`, both in the schema. Empty
  values fall back to the `notion-notes` mod's own settings
  (`readTextFile(\`${appHome()}/mods/notion-notes/mod.json\`)`: `settings.ntn`, and the `ref` of
  `settings.parents[0]`), then to `"ntn"` and no parent (a private workspace page).
- `sendToNotion({ title, markdown, ntn, parent })` in `engine.js`: create the page as
  `notion-notes/notion.js: create` does (`ntn pages create --json --content=---\ntitle: <JSON string>\n---\n`,
  `--parent <ref>` when set), then write the Markdown to `~/.herdr/walkthrough/notion.md` and
  upload it with `sh -c '"$1" pages edit "$2" < "$3"'`. Read `../notion-herdr/mods/notion-notes/notion.js`
  (`client`, `PREFIX`, `upload`) for the exact calls and their pitfalls before writing; do not
  import from it (a mod never reaches into another mod's folder). Returns the page's URL.
- The page title: `<walkthrough title> · <repo> · <branch or source>`. The body is
  `this.markdown()` without the `<!-- walkthrough -->` marks.
- Footer: a **Send to Notion** ghost button beside "Copy as Markdown", shown only when
  `ntn --version` runs (checked once, like `claudeVersion`). It asks first, in the footer, the
  way Post does ("Create a Notion page with this walkthrough?"), since the task text (the
  reader's prompts) goes with it. After it, `flash` shows "Sent to Notion." and a click on it
  opens the page.
- README: a line under "Share it, or send it back", the stored file in the table, and the
  setting in the menus-and-commands table.

**Keep.** No Notion call happens on opening. Nothing reads or changes `notion-notes`' files.

**Test.** A pure `notionArgs({ title, parent })` returning the `create` argument array, for a
title with quotes, a leading `---` and a newline; `sendToNotion` against a fake `exec`,
including `ntn` failing after the page was created (the error names the created page).

## S6. Open from other mods

**Problem.** `props` carry `folder` and `scope`, so another mod can open the Commit tab but not
a given commit, and the Pull request tab but not a given pull request.

**Change** (`view.js`, `RECIPE.md`, `README.md`).
- `init` reads four more props, each optional and validated before use:
  - `commit`: a hash. With `scope: "commit"`, the commit shown. Resolved with
    `git rev-parse --verify <hash>^{commit}` and `git log -1` for its subject, since it may not
    be among the 40 recent ones; it is added to `this.commits` when missing.
  - `since`: a hash; with `commit`, the `range` source of S1. It is not called `from`:
    that prop already names the terminal the walkthrough was opened over.
  - `pr`: a number. With `scope: "pr"`, the pull request picked once the list is read; when it
    is not among the open ones, the empty state says so.
  - `path`: a repository-relative path. Once a walkthrough is shown, the first step whose
    hunks touch that file is opened instead of the first unread one.
- A prop that does not resolve is ignored with a `flash`, and the tab opens as it would have.
- The copy made by "Open as pane / tab" (`openAs`) passes the same props on, so it keeps the
  commit, range or pull request it was showing.
- `RECIPE.md` and `README.md` get a short "Opening it from another mod" section: the props,
  and the three ways to open (`openOverlay({ mod: "walkthrough", kind: "dialog", modal: true, width: 0.74, height: 0.8, props })`,
  `pane.split`, `tab.new`), with one `herdr-app do` example for a commit. This is the contract
  B1 and B2 code against; keep the names stable.

**Check first.** Confirm in `herdr.d.ts` (`OverlaySpec`, near line 395) that `openOverlay`
takes another mod's name and `props`. If it does not, document `tab.new` as the way in.

**Test.** The prop validation as a pure function (`openRequest(props)` returning
`{ scope, commit, since, pr, path }` or nulls): hashes that are not hex, a negative `pr`, an
absolute or `..` path are dropped.

## B1. Branch PR opens it

Repository: `~/ai/herdr/custom-mods/herdr-mods` (fork `edusu/herdr-mods`, branch `development`),
folder `branch-pr/`. Read that folder's `README.md`, `RECIPE.md` and tests first; it has its
own conventions (`views/ui.js` components, a settings schema test).

**Change.** In `views/detail.js`, beside the PR header's Actions menu, a **Walkthrough** button
that opens the walkthrough with `{ folder, scope: "pr", pr: pr.number }` (S6's contract), in
the PR's worktree folder when it has one. It is shown only when the mod is installed, found
the way `main.js` (near line 105) finds Better Changes:
`readTextFile(\`${appHome()}/mods/walkthrough/mod.json\`)`. A merged or closed PR shows no
button: the walkthrough lists open pull requests only.

**Test.** Whatever pure piece results (the props built for a PR with and without a worktree),
in that mod's `tests/`, run with its own command.

## B2. Git Graph opens it

Repository: `~/ai/herdr/mods/herdr-git-graph`. Its `origin` is upstream
(`rabeeh-ta/herdr-git-graph`), not a fork. **Before this slice the user must fork it or
confirm a local-only patch**; stop and ask if neither has been done.

**Change.** In `mods/git-graph/git.js: menuFor`, the commit branch gets a section with
"Walkthrough of this commit" (`{ type: "walkthrough", hash }`) and, when the commit is an
ancestor of HEAD and not HEAD, "Walkthrough from here to HEAD" (`{ type: "walkthrough", since: hash, hash: ctx.head }`).
`menu.js: choose` handles `walkthrough` like `showChanges`: close the popup, then open with
`{ folder, scope: "commit", commit, since }`. The items appear only when the walkthrough mod
is installed (read once in `graph.js` and passed in `ctx`). `menuHeight` follows from the items.

**Test.** `menuFor` with and without the mod installed, in `tests/graph.test.mjs`.

## Not in this plan

- Jumping from a step's hunk to gitview's diff or nvim, and a "walkthrough of this file"
  entry in gitview. S6's `path` prop is the hook for the second.
- Auto with the dialog closed, persistent comments, Codex as a runner (the upstream roadmap).
- Proposing any slice upstream. S1 to S3 and S6 hold no fork-only assumptions and could be;
  S4 and S5 assume `gh` and `ntn`.
