import { contractStrings } from "./lib/contract-language.js";
import { contractChangeEvidence, contractChangeTargets } from "./lib/contract-evidence.js";
import { contractPage } from "./contracts-view.js";
import { reportPages, blueprintFileTargets } from "./lib/navigation.js";
// The walkthrough: a change read in the order it makes sense, one step at a
// time, with the code each step talks about under it.

import { mermaidWithConnections } from "./lib/diagram.js";
import { blueprintView } from "./blueprint-view.js";
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, VirtualListScrollHandle, ScrollHandle, TextView } from "gpui-base";
import { spaces, panes, focused, agents, theme, props, openOverlay, closeOverlay, hc, exec, nextCommand, settings, shared, setShared, watchFolder, notify, run } from "herdr";
import * as herdr from "herdr";
import { updater, VERSION, PROMPT, RELEASES } from "./lib/update.js";
import { SCOPES, repoAt, currentHead, defaultBase, baseChoices, recentCommits, olderCommits, rangeFrom, commitAt, openRequest, pullRequests, issuesFor, sourceKey, commitMessage, rangeMessages, taskSince } from "./lib/sources.js";
import { overlay, fileTotals, overlayAsks, asksOf } from "./lib/walkthrough.js";
import { TASK_MODES, taskChoice, resolveTask, taskKey, taskCacheKey, clip, MAX_TASK_CHARS } from "./lib/task.js";
import { numberLines, hunkLabel, numberDigits } from "./lib/hunks.js";
import { tokenize } from "./lib/highlight.js";
import { LANGUAGES, languageOf, fromLocale } from "./lib/languages.js";
import { BACKENDS, DEFAULT_BACKEND, backendOf, modelsOf, modelFor, modelOf } from "./lib/job.js";
import { estimateTokens, codeKey, placeKey, MAX_PROMPT_CHARS } from "./lib/cache.js";
import { formatComments, formatQuestion, addComment, sameSpot, agentOrder } from "./lib/comments.js";
import { toMarkdown, recapMarkdown } from "./lib/export.js";
import { recapStrings } from "./lib/recap-language.js";
import { linkify, whereIs, isWebLink } from "./lib/links.js";
import { FOLLOW_UPS, followUpsOf } from "./lib/followup.js";
import { readKey, hunkRead, isRead, markStep, unmarkStep, mergeRead, changedSince } from "./lib/read.js";
import { readDiff, readPreferences, matters, keyFor, findShown, preparePrompt, fits, promptChars, jobOf, startJob, alive, finished, cancelJob, finishJob, copyText, postComment, sendToNotion, notionSetup, settingsOf, askFollowUp, backendVersion, systemLocale, ensureDirs, loadRead, saveRead, transcriptMessages } from "./engine.js";
import { button, chip, menu, picker, logo, kbd, tag, eyebrow, upper, meter, callout, pageFrame, PAGE_PADDING, PAGE_BOTTOM, formatElapsed, formatTokens } from "./ui.js";
import { stuckHeader } from "./lib/sticky.js";
import { TEXT, px, grow, setSizes } from "./lib/scale.js";
import { turnSource, isOpen, firstLine, newerTurn } from "./lib/turns.js";
import { PLACEMENTS, placementOf } from "./lib/placement.js";
import { AUTO, DEFAULT_AUTO, autoOf, startTurns, loadTurns, turnLabel, turnItems, chooseTurn, tabTerminals, turnTick, autoGenerate, announce, hookHelp, startRecorder, stopRecorder } from "./turnview.js";

const PREFS = "walkthrough.prefs";
// Lines drawn on one page; a step past this says how many it leaves out.
const MAX_PAGE_LINES = 2500;
// The walkthrough's summary is cut past this until "Show more".
const SUMMARY_CHARS = 150;
/** Sets a key in a session cache, emptied first once it holds 200. */
const capped = (map, key, value) => { if (map.size >= 200) map.clear(); map.set(key, value); };
const NOTE_LABEL = { choice: "Decision", upkeep: "Upkeep", gap: "Limitation", divergence: "Divergence", untested: "Untested" };
const NOTE_ABOUT = {
  choice: "A product or design call made here that could have gone another way",
  upkeep: "Something the project maintains from now on",
  gap: "Something users still can't do, or will see fail",
  divergence: "Two paths of the same thing that behave differently",
  untested: "The change's main promise has no test",
};

/** Where the shown space is now: its focused pane's folder, else where it was made. */
function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  return { space, folder: pane?.cwd || f?.cwd || space?.folder || null, terminal: f?.terminal ?? null };
}

/** A token's colour, from the theme's own palette so it follows light and dark. */
function syntaxColor(t, kind) {
  switch (kind) {
    case "keyword": return t.ansi5;
    case "string": return t.ansi2;
    case "number": case "constant": return t.ansi3;
    case "function": return t.ansi4;
    case "type": return t.ansi6;
    case "comment": return t.dim;
    default: return t.foreground;
  }
}

const scopeName = (scope) => (scope === "staged" ? "staged" : scope === "working" ? "unstaged" : scope);

const prefs = () => /** @type {any} */ (shared(PREFS)) ?? {};
const savePrefs = (change) => setShared(PREFS, { ...prefs(), ...change });
// Task choices are kept per repository and source; past this many the oldest go.
const MAX_TASK_CHOICES = 100;
const FOLLOW_KEY = { d: "deeper", m: "technical" };
const openWebLink = (url, cx) => { if (isWebLink(url)) cx.open_url(url); };

/** Under `herdr-app check` the mod is drawn once and runs nothing: no GitHub request. */
const checking = () => {
  try { return typeof herdr.checking === "function" && herdr.checking() === true; }
  catch { return false; }
};

/** Each kind of note in its own colour: a decision is not a warning. */
const noteColor = (t, kind) => ({ choice: t.accent, upkeep: t.ansi6 ?? t.accent, gap: t.ansi3, divergence: t.ansi5 ?? t.ansi3, untested: t.blocked }[kind] ?? t.muted);

/** Contract pages in the contents: a table, a message, an endpoint. */
const CONTRACT_ICON = { database: "▤", protobuf: "{}", api: "⇄" };
const COVERAGE_MARK = { seen: "✓", partly: "◐", absent: "○" };
const COVERAGE_ABOUT = {
  seen: "The diff carries this request out",
  partly: "The diff carries out part of this request",
  absent: "Nothing in this diff carries this request out",
};

export class Walkthrough {
  init(cx) {
    const p = props() ?? {};
    this.want = openRequest(p); // another mod's commit, since, pr and path: each used once, then null
    const here = location();
    this.folder = p.folder ?? here.folder;
    this.space = here.space;
    this.remote = Boolean(here.space?.machine);
    this.from = p.from ?? here.terminal; // the terminal it was opened over: comments go to its agent first
    this.inDialog = Boolean(p.overlay);
    // props() can be another copy's in a callback. A mod pane gets no props().pane: it is the walkthrough pane focused as it opens (tab.new and pane.split focus it).
    const opened = !p.overlay ? panes().find((x) => x.pane === (p.pane ?? focused()?.pane) && x.mod === "walkthrough") : null;
    this.own = { overlay: p.overlay ?? null, pane: opened?.pane ?? null };
    // A copy opened as its own tab gets the tab it came from: that tab has the agents to watch.
    this.tab = p.tab || (p.pane && panes().find((x) => x.pane === p.pane)?.tab) || focused()?.tab || null; // a pane watches this tab's agents
    const saved = prefs();
    this.scope = this.want.scope ?? (SCOPES.some((s) => s.key === saved.scope) ? saved.scope : "uncommitted");
    this.backend = BACKENDS.some((b) => b.key === saved.backend) ? saved.backend : DEFAULT_BACKEND;
    // A model saved for another backend (or no longer offered) gives way to this backend's default, as the model picker shows.
    this.model = modelFor(this.backend, saved.model);
    this.language = saved.language ?? null; // null until the system's is read
    this.repo = undefined; // undefined: looking, null: not in git
    this.base = null;
    this.bases = [];
    this.commit = null;
    this.commits = [];
    this.since = null; // the Commit tab's "from": a commit of this.commits older than this.commit, or null for its parent
    this.first = null; // the Range tab's first commit: this.commit or one older, itself part of the range
    this.pr = null;
    this.prs = null; // null until listed
    this.prError = null;
    this.prMissing = null; // the pull request another mod asked for, when it isn't open
    this.turn = null; // Last turn: the one shown (lib/turns.js), picked by hand when turnPinned
    this.turns = [];
    this.turnPinned = false;
    if (this.want.turn) this.turn = { id: this.want.turn }; // kept by loadTurns while it is listed
    this.summaryOpen = false; // the sidebar's summary, shown whole
    this.sidebar = saved.sidebar !== false; // the contents column, until collapsed
    this.record = saved.recordTurns === true; // record the turns of agents with no hooks while open (turnview.js)
    this.treeChangedAt = 0; // when the working tree last changed, for the recorder
    this.auto = AUTO.some((a) => a.key === saved.autoGenerate) ? saved.autoGenerate : DEFAULT_AUTO;
    this.autoTried = new Set(); // turns already considered for a walkthrough without a click
    this.autoWanted = null;
    this.statuses = new Map(); // this tab's agents' last status
    this.background = []; // walkthroughs written without a click, followed to their end: { job }
    this.confirm = null; // the footer asks before sending: "post" | "notion"
    this.posting = false;
    this.notion = null; // { ntn, parent } once ntn --version has run: Send to Notion is offered
    this.cli = undefined; // the backend's version: undefined while looking, null when it can't be started
    this.diff = null;
    this.cacheKey = null;
    this.shown = null; // { entry, exact }
    this.view = null;
    this.task = null; // the task the shown source is matched against (lib/task.js), or null
    this.taskView = null; // the shown walkthrough's requests over the diff (overlayAsks), null when it has none
    this.commitTexts = new Map(); // commit messages read, by hash (a range's, by its source key)
    this.issueTexts = new Map(); // GitHub issues found for a source (issueKey), [] for none: gh is asked once per session
    this.promptMemo = null; // { since, at, list }: prompts read from transcripts, briefly kept
    this.editingTask = false;
    this.showTaskText = false;
    this.job = null;
    this.jobSeq = 0; // bumped whenever this view starts, ends or drops a job
    this.starting = false;
    this.polls = 0;
    this.deadSince = null;
    this.loading = false;
    this.error = null;
    this.genError = null;
    this.diagramZoom = 1;
    this.diagramSource = false;
    this.diagramSelected = null;
    this.navigationFile = null;
    this.step = 0; // index into reportPages: Recap always first
    this.visitedPages = new Set(["recap"]);
    this.read = {}; // the repository's read hunks, { "<path>:<digest>": ms }
    this.readChanged = new Set(); // keys marked or unmarked here and not yet written
    this.unreadOnly = false; // the contents and ← → skip read steps
    this.wrap = false; // long code lines wrap instead of scrolling sideways; starts from settings.lines in mod.json
    settingsOf("walkthrough").then((own) => { setSizes(own); this.wrap = own.lines === "wrap"; cx.notify(); return notionSetup(own.notion); }).then((n) => { this.notion = n; cx.notify(); });
    this.openFiles = new Set();
    this.openContracts = new Set();
    this.openContractChanges = new Set();
    this.comments = [];
    this.target = null; // { sk, scope, path, line, kind, code }: the line a comment is being written on
    this.agentTo = null;
    this.picking = null; // "base" | "commit" | "since" | "first" | "pr" | "model" | "language" | "agent"
    this.menuIndex = 0; // the highlighted row of the open picker, moved by ↑ ↓ and chosen by Enter
    this.menuScroll = VirtualListScrollHandle.new();
    this.pageScroll = ScrollHandle.new(); // a step page's position, for the file header pinned over its code
    this.sizes = new Map(); // measured heights of code cards and their files, by element id
    this.stuck = null; // the pinned file header (lib/sticky.js), or null
    this.sent = null;
    this.sentUrl = null; // a page the note opens when clicked
    this.seq = 0;
    this.dirty = false;
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.input = InputState.new({ placeholder: "Comment on this line, then Enter" });
    this.typing = false; // false, or the input typed in: "comment", "question" or "task"
    this.input.on("focus", (_e, cx) => { this.typing = "comment"; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.input.on("submit", (_e, cx) => { this.saveComment(); cx.notify(); });
    this.following = null; // { step, kind }: a closer look at a step being asked for
    this.asking = false; // the question box under the step's text is open
    this.question = InputState.new({ placeholder: "Ask the agent about this step, then Enter" });
    this.question.on("focus", (_e, cx) => { this.typing = "question"; cx.notify(); });
    this.question.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.question.on("submit", (_e, cx) => cx.spawn(async (cx) => this.ask(cx)));
    this.taskText = TextareaState.new({ placeholder: "What should this change do? One request per line works best.", rows: 4 });
    this.taskText.set_auto_grow(3, 10);
    this.taskText.on("focus", (_e, cx) => { this.typing = "task"; cx.notify(); });
    this.taskText.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.taskText.on("change", (_e, cx) => cx.notify());
    this.taskText.on("submit", (_e, cx) => this.saveTaskText(cx));

    cx.spawn(async (cx) => {
      if (!this.folder || this.remote) { this.repo = null; cx.notify(); return; }
      const [repo, cli, locale] = await Promise.all([repoAt(exec, this.folder).catch(() => null), backendVersion(this.backend), this.language ? null : systemLocale()]);
      this.repo = repo;
      this.cli = cli;
      if (!this.language) this.language = fromLocale(locale);
      if (!repo) { cx.notify(); return; }
      await ensureDirs();
      this.read = await loadRead(repo.top);
      const [base, bases, commits] = await Promise.all([
        defaultBase(exec, repo.top, repo.branch), baseChoices(exec, repo.top, repo.branch), recentCommits(exec, repo.top)]);
      const remembered = prefs().bases?.[repo.top];
      this.base = remembered && bases.includes(remembered) ? remembered : base;
      this.bases = bases;
      this.commits = commits;
      this.commit = commits[0] ?? null;
      if ((this.scope === "commit" || this.scope === "range") && this.want.commit) await this.openCommit();
      if (this.scope === "pr") await this.loadPullRequests(); else this.want.pr = null;
      await startTurns(this, cx);
      if (this.want.turn && this.turn?.id === this.want.turn) chooseTurn(this, this.turn);
      this.want.turn = null;
      startRecorder(this, cx);
      await this.reload(cx);
      this.want.step = null; // for the walkthrough this first read shows, not a later one
      this.watch(cx);
      await autoGenerate(this, cx, this.turn); // the turn the tab shows: this terminal's newest, else the newest
    });
    cx.timer.every(1000, (cx) => this.tick(cx));
    // A newer release, at most once a day (lib/update.js); not under `herdr-app check`, which runs nothing.
    this.update = updater({ shared, setShared, fetch: (url, options) => fetch(url, options), wait: (ms) => new Promise((done) => cx.timer.after(ms, () => done())) });
    if (!checking()) cx.spawn(async (cx) => { await this.update.check(); cx.notify(); });
    // Commands for keys.json: walkthrough.generate, .cancel, .next, .prev, .copy, .unread, .wrap, .task (write your own), .recap, .ask, .deeper, .technical, .dialog, .pane, .tab.
    cx.spawn(async (cx) => {
      for (;;) {
        const name = String(await nextCommand()).replace(/^walkthrough\./, "").split(":")[0];
        if (name === "generate") await this.generate(cx);
        else if (name === "cancel") await this.cancel(cx);
        else if (name === "next") this.move(1);
        else if (name === "prev") this.move(-1);
        else if (name === "copy") await this.copy(cx);
        else if (name === "recap" && this.view) this.go(0);
        else if (name === "unread") this.unreadOnly = !this.unreadOnly;
        else if (name === "wrap") this.wrap = !this.wrap;
        else if (name === "task") this.chooseTask("own", cx);
        else if (name === "ask") { if (this.inDialog || this.ownPane()?.focused) this.openAsk(); }
        // Only the focused copy asks: each one would pay for its own answer. Not awaited: it takes seconds, and other commands go on meanwhile.
        else if (FOLLOW_UPS.some((f) => f.key === name)) { if (this.inDialog || this.ownPane()?.focused) this.followUp(name, cx); }
        // Every copy hears a command: a pane or a tab moves only when it is the focused pane.
        else if (PLACEMENTS.some((pl) => pl.key === name) && (this.inDialog || this.ownPane()?.focused)) this.moveTo(name);
        cx.notify();
      }
    });
  }

  /** The source the toolbar describes, or null while one still has to be picked. */
  source() {
    if (this.scope === "branch") return this.base ? { kind: "branch", base: this.base, head: this.head ?? this.repo?.branch ?? "HEAD" } : null;
    if (this.scope === "commit" && this.commit && this.since) return { kind: "range", from: this.since.hash, to: this.commit.hash, fromSubject: this.since.subject, toSubject: this.commit.subject };
    if (this.scope === "range") return this.commit && this.first ? { kind: "range", from: rangeFrom(this.first), to: this.commit.hash, fromSubject: this.first.subject, toSubject: this.commit.subject } : null;
    if (this.scope === "commit") return this.commit ? { kind: "commit", hash: this.commit.hash, subject: this.commit.subject } : null;
    if (this.scope === "pr") return this.pr ? { kind: "pr", number: this.pr.number, title: this.pr.title, head: this.pr.head, base: this.pr.base } : null;
    if (this.scope === "turn") return this.turn ? turnSource(this.turn) : null;
    return { kind: this.scope };
  }

  /** The task choice made for a source (by its key): found, the reader's own, or off. */
  taskChoiceFor(sk) {
    return taskChoice(this.repo && sk ? prefs().tasks?.[placeKey(this.repo.top, sk)] : null);
  }

  saveTaskChoice(sk, choice) {
    const place = placeKey(this.repo.top, sk);
    const tasks = { ...(prefs().tasks ?? {}) };
    delete tasks[place];
    // Your own words are kept while Found or Off is tried; only an empty text leaves nothing to keep.
    if (choice.mode !== "auto" || choice.text) tasks[place] = choice;
    const keys = Object.keys(tasks);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_TASK_CHOICES))) delete tasks[k];
    savePrefs({ tasks });
  }

  issueKey(source, branch = source.head ?? this.repo?.branch) {
    return `${this.repo?.top}\0${sourceKey(source)}\0${branch ?? ""}`;
  }

  /** One gh lookup per source serves every caller: the map holds it in flight, then its settled list. */
  issuesOf(source) {
    const branch = source.head ?? this.repo.branch, id = this.issueKey(source, branch);
    if (!this.issueTexts.has(id)) capped(this.issueTexts, id, issuesFor(exec, this.repo.top, source, branch).then((issues) => { this.issueTexts.set(id, issues); return issues; }));
    return Promise.resolve(this.issueTexts.get(id));
  }

  /**
   * The task a source is matched against, or null. Reading it never fails the
   * walkthrough: a task that can't be read is no task, and the walkthrough is
   * written as it always was.
   */
  async taskFor(source) {
    const repo = this.repo;
    if (!repo || !source) return null;
    const choice = this.taskChoiceFor(sourceKey(source));
    try {
      // gh is asked in every mode, for the task menu; only Issue, and Found when nothing else is found, wait for it.
      const issues = this.issuesOf(source);
      issues.catch(() => {});
      if (choice.mode !== "auto") return resolveTask({ mode: choice.mode, own: choice.text, source, issues: choice.mode === "issue" ? await issues : null });
      switch (source.kind) {
        case "turn": return resolveTask({ source, turn: this.turns.find((t) => t.id === source.id) ?? null, turns: this.turns });
        case "pr": {
          // Until the list comes, its description isn't known to be empty: the issue mustn't stand in for it.
          const pr = (this.prs ?? []).find((p) => p.number === source.number) ?? null;
          return resolveTask({ source, pr }) ?? (pr && resolveTask({ source, pr, issues: await issues }));
        }
        case "commit": case "range": {
          const id = sourceKey(source);
          const [read, field] = source.kind === "commit" ? [() => commitMessage(exec, repo.top, source.hash), "commit"] : [() => rangeMessages(exec, repo.top, source.from, source.to), "messages"];
          if (!this.commitTexts.has(id)) {
            // null: git couldn't read it this time; it is asked again on the next read, not remembered as no message.
            const message = await read();
            if (message === null) return null;
            capped(this.commitTexts, id, message);
          }
          return resolveTask({ source, [field]: this.commitTexts.get(id) });
        }
        default: {
          const { since, label } = await taskSince(exec, repo.top, source);
          const found = { source, prompts: await this.promptsSince(since), since: label };
          return resolveTask(found) ?? resolveTask({ ...found, issues: await issues });
        }
      }
    } catch {
      return null;
    }
  }

  /**
   * What people typed into agents in this repository since `since`: Claude
   * Code's transcripts and pi, codex and opencode sessions, else the turns
   * recorded. A save re-reads the diff, so the transcripts are read at most every few seconds.
   */
  async promptsSince(since) {
    const m = this.promptMemo;
    if (m && m.since === since && Date.now() - m.at < 5000) return m.list;
    let list = await transcriptMessages(this.repo.top, since);
    if (!list.length) list = this.turns.filter((t) => t.started >= since).map((t) => ({ at: t.started, text: t.prompt })).sort((a, b) => a.at - b.at);
    this.promptMemo = { since, at: Date.now(), list };
    return list;
  }

  /** Re-reads the diff and what to show for it. A newer reload wins over an older one still running. */
  async reload(cx) {
    const repo = this.repo;
    if (!repo) return;
    const seq = ++this.seq, jobSeq = this.jobSeq;
    this.loading = true;
    this.dirty = false;
    cx.notify();
    try {
      // The terminal may have checked out another branch since the last read.
      const head = await currentHead(exec, repo.top);
      const detached = head === "HEAD" || head.startsWith("HEAD@");
      if (this.head !== undefined && head !== this.head) await this.rebase(repo, detached ? null : head);
      this.head = head;
      repo.branch = detached ? null : head;
      const source = this.source();
      if (!source) {
        this.diff = null; this.shown = null; this.view = null; this.task = null; this.taskView = null;
        if (jobSeq === this.jobSeq) this.job = null;
      } else {
        // The task is read beside the diff, not after it: a save re-reads both.
        const [diff, preferences, task] = await Promise.all([readDiff(repo, source), readPreferences(), this.taskFor(source)]);
        const key = keyFor(repo, diff, this.model, this.language, preferences, task);
        const [shown, job, read] = await Promise.all([findShown(repo, diff, key), jobOf(repo, diff.sk), loadRead(repo.top)]);
        if (seq !== this.seq) return;
        // Another window on this repository may have marked hunks; marks made here and not yet written stay.
        this.read = mergeRead(read, this.read, this.readChanged);
        // The size of exactly the prompt Generate would send, so the intro and the check agree.
        this.promptSize = promptChars(preparePrompt(diff, { language: this.language, previous: this.previousFor(shown), preferences, task }));
        this.task = task;
        const before = this.shown?.entry?.key + String(this.shown?.entry?.generatedAt);
        // A comment box belongs to a line of the diff it was opened on.
        // So does the task editor: what it holds is another source's task.
        if (this.diff?.sk !== diff.sk) { this.target = null; if (this.editingTask) this.closeTaskEditor(); }
        this.diff = diff;
        this.cacheKey = key;
        this.shown = shown;
        // A job this view started or ended while reading is newer than what the read found.
        if (jobSeq === this.jobSeq && !this.starting) this.job = job;
        // With nothing changed there is nothing to walk through: the last walkthrough shown here isn't offered (nor its footer, nor Copy).
        this.view = shown && diff.files.length ? overlay(shown.entry.walkthrough, diff.files) : null;
        this.taskView = this.view ? overlayAsks(shown.entry.walkthrough.asks, this.view) : null;
        // Another report is another reading path; persistent hunk marks survive it.
        if (before !== shown?.entry?.key + String(shown?.entry?.generatedAt)) {
          this.step = this.openingPage();
          this.resetScroll();
          this.sizes.clear();
          this.diagramZoom = 1;
          this.diagramSource = false;
          this.diagramSelected = null;
          this.navigationFile = null;
          this.visitedPages = new Set(["recap"]);
          this.showTaskText = false;
          this.openFiles = new Set();
          this.openContracts = new Set();
          this.openContractChanges = new Set();
          if (this.view && this.want.path) {
            const at = this.view.steps.find((st) => st.found.some((f) => f.file.path === this.want.path));
            if (!at) this.flash(`No step touches ${this.want.path}.`); else this.step = this.pageIndex("step", at.id);
            this.want.path = null;
          }
          if (this.view && this.want.step !== null) {
            // The prop counts steps (-1 the task page), not pages: Recap, the task and contract pages come before them here.
            const n = this.want.step, steps = this.view.steps;
            this.step = Math.max(0, n < 0 ? this.pageIndex("task") : n >= steps.length ? this.pageIndex("tail") : this.pageIndex("step", steps[n].id));
            this.want.step = null;
          }
        }
        if (this.view) this.step = Math.min(this.step, this.pages().length - 1);
      }
      this.error = null;
    } catch (e) {
      if (seq === this.seq) this.error = String(e?.message ?? e);
    }
    if (seq === this.seq) this.loading = false;
    cx.notify();
  }

  /**
   * After a checkout, the bases on offer are those of the new branch: never the
   * branch itself, and the remembered or detected one when it still fits.
   */
  async rebase(repo, branch) {
    const [base, bases] = await Promise.all([defaultBase(exec, repo.top, branch), baseChoices(exec, repo.top, branch)]);
    const remembered = prefs().bases?.[repo.top];
    this.bases = bases;
    if (!this.base || !bases.includes(this.base)) this.base = remembered && bases.includes(remembered) ? remembered : base;
  }

  /** Edits in the repository mark the diff dirty; the next tick re-reads it. */
  watch(cx) {
    const { top, gitDir } = this.repo ?? {};
    if (!top) return;
    const loop = (folder) => cx.spawn(async (cx) => {
      for (;;) {
        const changed = await watchFolder(folder);
        // A commit, a pull request or a finished turn doesn't change with the working tree.
        const wanted = this.scope !== "commit" && this.scope !== "range" && this.scope !== "pr" && !(this.scope === "turn" && !(this.turn && isOpen(this.turn))) && !this.dirty;
        // The recorder ends a turn once the working tree has been still a while, whatever is shown.
        if ((wanted || this.record) && await matters(top, changed, gitDir)) {
          this.treeChangedAt = Date.now();
          if (wanted) this.dirty = true;
        }
      }
    });
    loop(top);
    // A linked worktree's index and HEAD live outside it.
    if (gitDir && !gitDir.startsWith(`${top}/`)) loop(gitDir);
  }

  async tick(cx) {
    // A note on what Copy, Send or Post did fades: soon when it worked, later when it didn't.
    if (this.sent && Date.now() - this.sentAt >= (!this.sentUrl && /^(✓ )?(Sent|Copied|Posted)\b/.test(this.sent) ? 1000 : 10_000)) { this.sent = null; cx.notify(); }
    if (this.ticking || !this.repo) return;
    this.ticking = true;
    try {
      // Marks are written at most once a second, together.
      await this.flushRead();
      // Every second only the answer is looked for; whether the run is alive, every fifth.
      const check = this.job && !this.job.done && (++this.polls % 5 === 0 || this.deadSince);
      const done = this.job && !this.job.done ? await finished(this.job) : null;
      if (done) this.job = done;
      else if (check) {
        const job = await jobOf(this.repo, this.job.meta.sk);
        if (job) job.pid = this.job.pid;
        if (!job) this.setJob(null);
        else if (job.done) this.job = job;
        else if (Date.now() > job.meta.deadline + 10_000) { // run.sh stops it at the deadline; this is for a run.sh that died
          this.setJob(null);
          await cancelJob(job);
          this.genError = "The model took too long and was stopped. Try a narrower scope, or another model.";
          await this.reload(cx);
        } else if (await alive(job)) {
          this.job.pid = job.pid;
          this.deadSince = null;
        } else if (!this.deadSince) {
          // The run has just exited and run.sh is about to write its code: give it a moment.
          this.deadSince = Date.now();
        } else if (Date.now() - this.deadSince > 3000) {
          this.deadSince = null;
          const again = await jobOf(this.repo, job.meta.sk);
          if (again?.done) this.job = again;
          else {
            this.setJob(null);
            if (again) await cancelJob(again);
            this.genError = "The generation stopped without an answer (the computer may have slept or restarted). Try again.";
            await this.reload(cx);
          }
        }
      }
      if (this.job && !this.job.done) cx.notify(); // the elapsed time
      if (this.job?.done) {
        const job = this.job;
        this.setJob(null);
        let lost = false;
        try {
          // null: another window took the answer; it is stored in a moment, and a later read finds it.
          lost = (await finishJob(job)) === null;
          if (!lost && job.meta.auto) announce(job.meta.source);
          this.genError = null;
        } catch (e) { this.genError = String(e?.message ?? e); }
        await this.reload(cx);
        if (lost) this.dirty = true;
      } else if (this.dirty && !this.loading) {
        await this.reload(cx);
      }
      await turnTick(this, cx);
    } finally {
      this.ticking = false;
    }
  }

  async flushRead() {
    if (!this.readChanged.size) return;
    const keys = [...this.readChanged];
    this.readChanged = new Set();
    try {
      const written = await saveRead(this.repo.top, this.read, keys);
      // Marks made while it was written are laid over what was written.
      this.read = mergeRead(written, this.read, this.readChanged);
    } catch {
      for (const k of keys) this.readChanged.add(k);
    }
  }

  setJob(job) {
    this.job = job;
    this.jobSeq++;
  }

  async generate(cx) {
    const repo = this.repo, diff = this.diff, source = this.source();
    // Keys and buttons alike: never on a diff still being read, with nothing to read, or twice.
    if (!this.canGenerate() || this.starting || !source) return;
    this.starting = true;
    try { await this.start(cx, repo, diff, source); } finally { this.starting = false; }
    cx.notify();
  }

  /**
   * The walkthrough handed on for revision: only one of older code, by the same
   * model in the same language. Another model or language writes its own reading.
   */
  previousFor(shown) {
    const e = shown?.entry;
    return shown && !shown.exact && e.model === this.model && e.language === this.language ? e.walkthrough : null;
  }

  async start(cx, repo, diff, source) {
    this.genError = null;
    const previous = this.previousFor(this.shown);
    const model = this.model, language = this.language;
    // The task the last read found, beside the diff it found it with.
    const task = this.task;
    const preferences = await readPreferences();
    const prompt = preparePrompt(diff, { language, previous, preferences, task });
    if (!fits(prompt)) {
      this.genError = `This diff is too large to send whole (≈ ${formatTokens(estimateTokens(promptChars(prompt)))} tokens; the limit is ≈ ${formatTokens(estimateTokens(MAX_PROMPT_CHARS))}). Pick a narrower scope.`;
      return;
    }
    try {
      // The key of exactly what is sent, not of whatever the last read saw.
      const key = keyFor(repo, diff, model, language, preferences, task);
      // The hunks of what is shown now: whatever of them was read and is gone has changed since.
      const before = (this.shown?.entry.walkthrough.parts ?? []).flatMap((p) => p.steps.flatMap((st) => st.hunkIds));
      this.setJob(await startJob(repo, diff, { key, model, language, prompt, source, before, task }));
    } catch (err) {
      this.genError = `Couldn't start ${backendOf(this.backend).program}: ${String(err?.message ?? err)}`;
    }
  }

  async cancel(cx) {
    if (!this.job) return;
    const job = this.job;
    this.setJob(null);
    await cancelJob(job);
    cx.notify();
  }

  /** Where a report opens: Recap while none of it is read yet, else where the reader left off, its first step not read. */
  openingPage() {
    if (!this.view?.steps.some((st) => isRead(st, this.read))) return 0;
    return Math.max(0, this.pages().findIndex((p) => p.kind === "step" && !isRead(p.step, this.read)));
  }

  /** Contract labels are in the report's language, not the picker's: switching it doesn't rewrite a report already written. */
  contractLanguage() { return this.shown?.entry?.language ?? "en"; }

  /**
   * The report's pages in reading order. Built once per report, view, language
   * and task, not on every call: a render asks for it once per contents row.
   */
  pages() { return this.pageList().pages; }

  pageList() {
    const walkthrough = this.shown?.entry?.walkthrough, view = this.view, language = this.contractLanguage(), task = Boolean(this.taskView);
    const m = this.pagesMemo;
    if (m && m.walkthrough === walkthrough && m.view === view && m.language === language && m.task === task) return m;
    const pages = reportPages(walkthrough, view, language, { task });
    const index = new Map();
    pages.forEach((p, i) => { const key = p.kind === "step" ? `step:${p.step.id}` : p.kind; if (!index.has(key)) index.set(key, i); });
    return (this.pagesMemo = { walkthrough, view, language, task, pages, index });
  }

  pageIndex(kind, stepId = null) {
    return this.pageList().index.get(kind === "step" && stepId ? `step:${stepId}` : kind) ?? -1;
  }

  go(index) {
    const pages = this.pages(), before = this.step;
    this.step = Math.max(0, Math.min(Math.max(0, pages.length - 1), index));
    const page = pages[this.step];
    if (page?.kind === "recap") this.visitedPages.add("recap");
    else if (page?.kind === "task") this.visitedPages.add("task");
    else if (page?.kind === "contract") this.visitedPages.add(`contract-${page.contract.kind}`);
    this.target = null;
    this.asking = false;
    this.navigationFile = null;
    if (this.step !== before) this.resetScroll();
  }

  /**
   * A page opens at its top: one handle on every page would carry the last one's position over. The old
   * handle isn't released, since the frame on screen may still hold it until the next render.
   */
  resetScroll() {
    this.pageScroll = ScrollHandle.new();
    this.stuck = null;
  }

  /** Pins the header of the file at the top of the step's code (lib/sticky.js), redrawing only when that changes. */
  followScroll(cx, again = true) {
    const code = this.codeGroups, scroll = this.pageScroll;
    if (!code?.card || !scroll) return;
    // The code card is the page's last child: its first file starts below the card's top border.
    const top = scroll.content_size().height - PAGE_BOTTOM - this.sizes.get(code.card) + 1;
    const next = Number.isFinite(top) ? stuckHeader(scroll.offset().y, top, code.groups.map((g) => this.sizes.get(g.id)), grow(36)) : null;
    if (next?.index !== this.stuck?.index || next?.shift !== this.stuck?.shift) { this.stuck = next; cx.notify(); }
    // The offset may be read before this wheel event has moved it: look once more after it has.
    if (again && !this.scrollAgain) this.scrollAgain = cx.timer.after(60, (cx) => { this.scrollAgain = null; this.followScroll(cx, false); });
  }

  /** Keeps an element's height for followScroll, in the px the scroll handle uses. */
  measure(id) {
    return (size) => this.sizes.set(id, size.height / (Number(settings().zoom) || 1));
  }

  blueprintTargets(path) {
    const w = this.shown?.entry?.walkthrough;
    const component = w?.recap?.architecture?.components?.find((c) => c.id === this.diagramSelected);
    return blueprintFileTargets(w, this.view, this.diff?.files ?? [], component, path, this.contractLanguage());
  }

  goToBlueprintFile(path, cx) {
    const destination = this.blueprintTargets(path)[0];
    if (!destination) return;
    this.go(destination.index);
    this.navigationFile = path;
    if (destination.kind === "tail") {
      for (const u of this.view.uncovered) if (u.file.path === path) this.openFiles.add(`${u.file.scope}:${path}`);
    } else if (destination.kind === "contract") {
      this.openContracts.add(this.pages()[destination.index].contract.kind);
    }
    cx.notify();
  }

  toggleContractChange(kind, index, cx) {
    const key = `${kind}:${index}`;
    this.openContractChanges.has(key) ? this.openContractChanges.delete(key) : this.openContractChanges.add(key);
    cx.notify();
  }

  goToContractStep(kind, changeIndex, destinationIndex, cx) {
    const page = this.pages()[this.step];
    if (page?.kind !== "contract" || page.contract.kind !== kind) return;
    const change = page.contract.changes[changeIndex];
    const target = contractChangeTargets(this.pages(), change).find((t) => t.index === destinationIndex);
    if (!target) return;
    this.go(target.index);
    cx.notify();
  }

  /** The width a report page's content has: the panel less the contents column (when shown) and the page's padding. */
  contentWidth() {
    const width = this.width ?? 1000;
    return Math.max(260, width - (this.sidebar && this.wide() ? grow(248) : 0) - 2 * PAGE_PADDING);
  }

  reportPage(t) {
    const page = this.pages()[this.step];
    if (page?.kind === "contract") {
      const contract = page.contract;
      const { found, missing } = contractChangeEvidence({ hunkIds: contract.changes.flatMap((c) => c.hunkIds) }, this.diff.files);
      const changeEvidence = contract.changes.map((change) => ({
        ...contractChangeEvidence(change, this.diff.files), targets: contractChangeTargets(this.pages(), change),
      }));
      return contractPage(contract, t, {
        changeEvidence,
        openChanges: new Set(contract.changes.flatMap((_c, i) => this.openContractChanges?.has(`${contract.kind}:${i}`) ? [i] : [])),
        onToggleChange: (i, cx) => this.toggleContractChange(contract.kind, i, cx),
        renderChangeSource: (i) => changeEvidence[i].found.length ? this.code(t, changeEvidence[i].found) : null,
        onGoToStep: (i, index, cx) => this.goToContractStep(contract.kind, i, index, cx),
        language: this.contractLanguage(),
        width: this.contentWidth(),
        sourceOpen: this.openContracts.has(contract.kind),
        onToggleSource: (cx) => { this.openContracts.has(contract.kind) ? this.openContracts.delete(contract.kind) : this.openContracts.add(contract.kind); cx.notify(); },
        source: this.openContracts.has(contract.kind) ? this.code(t, found) : null,
        missing,
      });
    }
    return page?.kind === "recap" ? this.recap(t) : page?.kind === "task" ? this.taskPage(t) : page?.kind === "step" ? this.page(t, page.step) : this.tail(t);
  }

  /**
   * One step on or back. Moving on from a step marks it read; with unread only
   * on, read steps are passed over (on past the last is Not covered, back
   * through the task/contracts to Recap).
   */
  move(dir) {
    const pages = this.pages();
    const here = pages[this.step]?.kind === "step" ? pages[this.step].step : null;
    // Only the code still there: an outdated step's missing hunks were never on screen.
    if (dir > 0 && here) this.setRead({ hunkIds: here.found.map((f) => f.hunk.id) }, true);
    let i = this.step + dir;
    if (this.unreadOnly) while (pages[i]?.kind === "step" && isRead(pages[i].step, this.read)) i += dir;
    if (i >= 0) this.go(i);
  }

  /** Marks a step's hunks (or any `{ hunkIds }`) read or unread, to be written on the next tick. */
  setRead(step, on) {
    this.read = on ? markStep(step, this.read) : unmarkStep(step, this.read);
    for (const id of step.hunkIds) this.readChanged.add(readKey(id));
  }

  /** The step on screen, or null on Recap, the task, a contract or Not covered. */
  shownStep() {
    const page = this.pages()[this.step];
    return page?.kind === "step" ? page.step : null;
  }

  /** x: the shown step read or unread again. An outdated step can't be read until it is regenerated. */
  toggleRead() {
    const s = this.shownStep();
    if (!s || s.outdated) return;
    this.setRead(s, !isRead(s, this.read));
  }

  /** The steps read before whose code has changed since. */
  changedSteps() {
    if (!this.view || !this.diff) return [];
    return changedSince(this.view.steps, this.read, {
      before: this.shown?.entry.before ?? [],
      current: this.diff.files.flatMap((f) => f.hunks.map((h) => h.id)),
    });
  }

  pickScope(key, cx) {
    if (this.scope === key) return;
    this.scope = key;
    this.picking = null;
    this.genError = null;
    this.loading = true; // until the read the change starts has finished
    this.confirm = null;
    savePrefs({ scope: key });
    cx.spawn(async (cx) => {
      // Listed again each time the tab is picked: pull requests open, close and move on GitHub.
      if (key === "pr") { cx.notify(); await this.loadPullRequests(); }
      if (key === "turn") await loadTurns(this);
      await this.reload(cx);
    });
  }

  /**
   * The commit and "from" another mod asked for, looked up past the listed ones too
   * (added after them). One git doesn't know is dropped with a note; a "from" that
   * isn't an ancestor is refused by the read.
   */
  async openCommit() {
    const { commit: hash, since: from, first: start } = this.want;
    const [commit, since, first] = await Promise.all([hash, from, start].map((h) => (h ? commitAt(exec, this.repo.top, h) : null)));
    const listed = (c) => this.commits.find((x) => x.hash === c.hash) ?? (this.commits.push(c), c);
    if (!commit) this.flash(`Couldn't find commit ${hash}.`);
    else {
      this.commit = listed(commit);
      const missing = from && !since ? from : start && !first ? start : null;
      if (missing) this.flash(`Couldn't find commit ${missing}.`);
      if (since) this.since = listed(since);
      if (first) this.first = listed(first);
    }
    this.want.commit = this.want.since = this.want.first = null;
  }

  /** The open pull requests; the one picked stays picked, else the current branch's is. */
  async loadPullRequests() {
    if (!this.repo) return;
    try {
      this.prs = await pullRequests(exec, this.repo.top, this.repo.branch);
      this.prError = null;
    } catch (e) {
      this.prs = [];
      this.prError = String(e?.message ?? e);
    }
    const wanted = this.want.pr;
    this.want.pr = this.prMissing = null;
    if (wanted) { this.pr = this.prs.find((p) => p.number === wanted) ?? null; if (!this.pr) this.prMissing = wanted; return; }
    const kept = this.pr && this.prs.find((p) => p.number === this.pr.number);
    this.pr = kept ?? this.prs.find((p) => p.current) ?? null;
  }

  /** The task picker: found or off applies at once; your own opens the editor, filled with what is there now. */
  chooseTask(mode, cx) {
    const sk = this.diff?.sk ?? (this.source() ? sourceKey(this.source()) : null);
    if (!this.repo || !sk) return;
    if (mode === "own") {
      const choice = this.taskChoiceFor(sk);
      this.taskText.set_value(choice.text || this.task?.text || "");
      this.editingTask = true;
      this.taskText.focus();
      cx.notify();
      return;
    }
    this.editingTask = false;
    this.saveTaskChoice(sk, { mode, text: this.taskChoiceFor(sk).text });
    this.loading = true;
    cx.spawn(async (cx) => this.reload(cx));
  }

  /** The editor's text becomes the task; an empty one goes back to the task found. */
  saveTaskText(cx) {
    const sk = this.diff?.sk;
    if (!this.repo || !sk) return;
    const text = this.taskText.value().trim().slice(0, MAX_TASK_CHARS);
    this.saveTaskChoice(sk, text ? { mode: "own", text } : { mode: "auto", text: "" });
    this.closeTaskEditor();
    this.loading = true;
    cx.spawn(async (cx) => this.reload(cx));
  }

  closeTaskEditor() {
    this.editingTask = false;
    this.typing = false;
    this.handle.focus();
  }

  /** The task picker's face. */
  taskFace() {
    const mode = this.taskChoiceFor(this.diff?.sk).mode;
    // The toolbar shows it without a label beside it, so each face says it is about the task.
    if (mode === "off") return "No task (off)";
    if (!this.task) return "No task found";
    return `◎ ${this.task.short}`;
  }

  choose(kind, value, cx) {
    this.picking = null;
    if (kind === "task") { this.chooseTask(value, cx); return; }
    if (kind === "auto") { this.auto = value; savePrefs({ autoGenerate: value }); cx.notify(); return; }
    if (kind === "record") {
      this.record = value;
      savePrefs({ recordTurns: value });
      if (!value) cx.spawn(async () => stopRecorder(this));
      cx.notify();
      return;
    }
    if (kind === "backend") {
      this.backend = value;
      this.model = modelFor(value, this.model);
      this.cli = undefined;
      savePrefs({ backend: value, model: this.model });
      cx.spawn(async (cx) => { this.cli = await backendVersion(value); cx.notify(); });
    }
    if (kind !== "agent") { this.genError = null; this.loading = true; }
    if (kind === "model") { this.model = value; savePrefs({ model: value }); }
    if (kind === "language") { this.language = value; savePrefs({ language: value }); }
    if (kind === "base") { this.base = value; savePrefs({ bases: { ...(prefs().bases ?? {}), [this.repo.top]: value } }); }
    // A "from" that is no longer older than the picked commit would make no range: back to its parent.
    if (kind === "commit") {
      const older = olderCommits(this.commits, value);
      this.commit = value;
      if (this.since && !older.some((c) => c.hash === this.since.hash)) this.since = null;
      if (this.first && this.first.hash !== value.hash && !older.some((c) => c.hash === this.first.hash)) this.first = null;
    }
    if (kind === "since") this.since = value;
    if (kind === "first") this.first = value;
    if (kind === "pr") { this.pr = value; if (this.confirm === "post") this.confirm = null; }
    if (kind === "turn") chooseTurn(this, value);
    if (kind === "agent") { this.agentTo = value; cx.notify(); return; }
    cx.spawn(async (cx) => this.reload(cx));
  }

  /** The agents a comment can go to (lib/comments.js: agentOrder). */
  agentChoices() {
    return agentOrder(agents(), { space: this.space?.id ?? null, tab: this.tab, from: this.from });
  }

  /** Comments belong to the source they were made on; another scope or commit keeps its own. */
  ownComments() {
    return this.comments.filter((c) => c.sk === this.diff?.sk);
  }

  /** The spot a diff line is: comments and the comment box are matched to it. */
  spot(file, number, side) {
    return { sk: this.diff?.sk, scope: file.scope, path: file.path, line: number, kind: side };
  }

  agent() {
    const list = this.agentChoices();
    return list.find((a) => a.address === this.agentTo) ?? list[0] ?? null;
  }

  saveComment() {
    const text = this.input.value().trim();
    if (!this.target || !text) return;
    this.comments = addComment(this.comments, { ...this.target, text });
    this.input.set_value("");
    this.target = null;
    this.handle.focus();
  }

  async send(cx) {
    const agent = this.agent();
    const mine = this.ownComments();
    if (!agent || !mine.length) return;
    const mixed = new Set(this.diff?.files.map((f) => f.scope)).size > 1;
    if (await this.sendToAgent(agent, formatComments(mine, this.diff?.what ?? "a change", { mixed }), `Sent ${mine.length} comment${mine.length === 1 ? "" : "s"} to ${agent.program?.name ?? agent.address}.`)) this.comments = this.comments.filter((c) => !mine.includes(c));
    cx.notify();
  }

  /** Pastes text into the agent and presses Enter, then says how it went; whether it worked. */
  async sendToAgent(agent, text, okNote) {
    if (this.sendingToAgent) return false;
    this.sendingToAgent = true; // Enter twice, or Enter and Send, is one send
    const r = await hc(["send", agent.address, text]).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) }));
    this.sendingToAgent = false;
    this.flash(r.code === 0 ? okNote : `Couldn't send: ${(r.stderr || r.stdout || "hc send failed").trim()}`);
    return r.code === 0;
  }

  /** Opens the question box on a step's page; the other pages have none. */
  openAsk() {
    if (!this.shownStep()) return;
    this.asking = true;
    this.question.focus();
  }

  closeAsk() {
    this.asking = false;
    this.typing = false;
    this.handle.focus();
  }

  /** The question goes to the agent, which answers in its terminal: the walkthrough's own model is not asked. */
  async ask(cx) {
    const agent = this.agent(), s = this.shownStep(), text = this.question.value().trim();
    if (!agent || !s || !text) return;
    if (await this.sendToAgent(agent, formatQuestion(s, this.diff?.what ?? "a change", text), `Sent the question to ${agent.program?.name ?? agent.address}.`)) {
      this.question.set_value("");
      this.closeAsk();
    }
    cx.notify();
  }

  /** A closer look at the shown step, from the model that wrote the walkthrough: asked once, then kept with it. */
  async followUp(kind, cx) {
    const s = this.shownStep(), asked = this.shown?.entry;
    if (!s || s.outdated || this.following || !this.cli || asked.followUps?.[s.id]?.[kind]) return;
    this.following = { step: s.id, kind };
    cx.notify();
    try {
      const entry = await askFollowUp(asked, s, kind, this.diff?.what ?? "a change");
      // A reload while it was asked read the entry before the answer was in it.
      if (this.shown?.entry.key === entry.key && this.shown.entry.generatedAt === entry.generatedAt) this.shown = { ...this.shown, entry };
    } catch (err) {
      this.flash(`Couldn't get an answer: ${String(err?.message ?? err)}`);
    }
    this.following = null;
    cx.notify();
  }

  /** A file the prose mentions: to the step, or the Not covered row, that holds it. */
  openLink({ path, line }) {
    const at = whereIs(this.view, path, line);
    if (!at) return;
    if ("file" in at) { this.go(this.pageIndex("tail")); this.openFiles.add(at.file); return; }
    const page = this.pageIndex("step", this.view.steps[at.step].id);
    if (page === this.step) this.flash("That code is in this step, below.");
    else this.go(page);
  }

  /**
   * Prose with its mentions of the diff's files as links (lib/links.js). `markdown`: the text is
   * Markdown already, drawn whole; else plain, one paragraph per line, as text when it mentions none.
   */
  prose(id, text, paths, { markdown = false } = {}) {
    const view = (key, source, linked) => {
      return TextView.markdown(key, linked?.markdown ?? source).on_link_click((url, cx) => {
        const at = /^walkthrough:(\d+)$/.exec(url), link = at ? linked?.links[Number(at[1])] : null;
        if (link) { this.openLink(link); cx.notify(); } else openWebLink(url, cx);
      });
    };
    if (markdown) return view(id, text, linkify(text, paths, { markdown: true })).selectable(true);
    const paragraphs = text.split(/\n+/).map((p, i) => {
      const linked = linkify(p, paths);
      return linked ? view(`${id}-${i}`, p, linked) : p;
    });
    return paragraphs.length > 1 ? v_flex().gap(6).children(paragraphs.map((p) => div().child(p))) : paragraphs[0];
  }

  /** The walkthrough shown, as Markdown on the clipboard: for a pull request, a review or a chat. */
  async copy(cx) {
    const text = this.markdown();
    if (!text) return;
    try {
      await copyText(text);
      this.flash("Copied the walkthrough as Markdown.");
    } catch (err) {
      this.flash(`Couldn't copy: ${String(err?.message ?? err)}`);
    }
    cx.notify();
  }

  /** Shows a note in the footer until tick clears it; one with a `url` opens it when clicked. */
  flash(text, { url } = {}) {
    this.sent = text;
    this.sentUrl = url ?? null;
    this.sentAt = Date.now();
  }

  /**
   * The walkthrough shown, as Markdown; null when there is none. Posted to a
   * pull request, its task is left out unless it was that pull request's own
   * description: a prompt to an agent or the reader's own words stay theirs.
   */
  markdown({ forPost = false, bounds = true } = {}) {
    const e = this.shown?.entry;
    if (!e || !this.view || !this.diff?.files.length) return null;
    const task = this.taskView && (!forPost || e.task?.from === "pr") ? this.taskView : null;
    return toMarkdown(this.view, e.walkthrough, { what: this.diff?.what, model: modelOf(e.model).name, language: languageOf(e.language).name, cost: e.cost, bounds }, task, e.task?.label ?? "");
  }

  /** The walkthrough as a comment on the pull request it is of. Asked first: everyone on the pull request sees it. */
  async post(cx) {
    const text = this.markdown({ forPost: true }), pr = this.pr;
    if (!text || !pr || this.scope !== "pr" || this.posting) return;
    this.posting = true;
    cx.notify();
    try {
      await postComment(this.repo.top, pr.number, text);
      this.flash(`Posted the walkthrough to #${pr.number}.`);
    } catch (err) {
      this.flash(`Couldn't post: ${String(err?.message ?? err)}`);
    }
    this.posting = false;
    this.confirm = null;
    cx.notify();
  }

  /** The walkthrough as a new Notion page. Asked first: the task, often the reader's own prompts, goes with it. */
  async sendNotion(cx) {
    const text = this.markdown({ bounds: false }), s = this.source();
    if (!text || !this.notion || this.posting) return;
    this.posting = true;
    cx.notify();
    const where = s?.kind === "pr" ? `#${s.number}` : s?.kind === "commit" ? s.hash.slice(0, 12) : s?.kind === "range" ? `${s.from.slice(0, 12)}..${s.to.slice(0, 12)}` : s?.head ?? this.repo.branch ?? "HEAD";
    try {
      this.flash("Sent to Notion.", { url: await sendToNotion({ ...this.notion, title: [this.shown.entry.walkthrough.title || "Walkthrough", this.repo.name, where].join(" · "), markdown: text }) });
    } catch (err) {
      // A page made and left empty: the note opens it.
      this.flash(`Couldn't send to Notion: ${String(err?.message ?? err)}`, { url: err?.url });
    }
    this.posting = false;
    this.confirm = null;
    cx.notify();
  }

  onKey(e, cx) {
    // While typing, keys are the text's; only Esc in the task editor or the question box leaves it (a comment box keeps its own).
    if (this.typing) {
      if (e.key === "escape" && this.typing === "task" && this.editingTask) { this.closeTaskEditor(); cx.notify(); }
      else if (e.key === "escape" && this.typing === "question") { this.closeAsk(); cx.notify(); }
      return;
    }
    const k = e.key;
    if (this.picking && this.menuKey(k, cx)) { cx.notify(); return; }
    if (k === "escape") {
      if (this.picking) this.picking = null;
      else if (this.editingTask) this.closeTaskEditor();
      else if (this.target) this.target = null;
      else if (this.asking) this.closeAsk();
      else if (this.confirm && !this.posting) this.confirm = null;
      else if (this.inDialog) closeOverlay(this.own.overlay);
    } else if (this.view && (k === "right" || k === "j" || k === "n")) this.move(1);
    else if (this.view && (k === "left" || k === "k" || k === "p")) this.move(-1);
    else if (this.view && k === "x") this.toggleRead();
    else if (this.view && k === "u") this.unreadOnly = !this.unreadOnly;
    else if (this.view && k === "w") this.wrap = !this.wrap;
    else if (this.shownStep() && k === "a") this.openAsk();
    else if (this.shownStep() && FOLLOW_KEY[k]) cx.spawn(async (cx) => this.followUp(FOLLOW_KEY[k], cx));
    else if (this.taskView && k === "t") this.go(this.pageIndex("task"));
    else if (this.view && k === "r") this.go(0);
    else return;
    cx.notify();
  }

  // ——— drawing ———

  render() {
    const t = theme();
    const inDialog = this.inDialog;
    return v_flex().id("walkthrough").track_focus(this.handle).on_key_down((e, cx) => this.onKey(e, cx))
      .on_size_change((size, cx) => { if (Math.abs((this.width ?? 0) - size.width) > 1) { this.width = size.width; cx.notify(); } })
      .size_full().bg(inDialog ? t.popover : t.background).text_color(t.foreground).text_size(TEXT.base)
      .child(this.header(t, inDialog))
      .when(Boolean(this.update?.available()), (el) => el.child(this.updateStrip(t, this.update.available())))
      .child(this.toolbar(t))
      .when(this.editingTask, (el) => el.child(this.taskEditor(t)))
      .child(div().flex_1().min_h(0).relative()
        .child(this.body(t))
        .when(Boolean(this.picking), (el) => el
          // While a picker is open the page under it holds still: a click beside it closes it, the wheel does nothing.
          .child(div().id("backdrop").absolute().inset_0().on_click((_e, cx) => { this.picking = null; cx.notify(); })
            .on_scroll_wheel((_e, cx) => cx.stop_propagation()))
          .child(this.popup(t))))
      .when(Boolean(this.view), (el) => el.child(this.footer(t)));
  }

  /** The title row: the mod, which repository and branch, the one action, and Esc in a dialog. */
  header(t, inDialog) {
    const r = this.repo;
    const busy = Boolean(this.job);
    const action = busy
      ? button(t, "cancel", "Cancel", (_e, cx) => cx.spawn(async (cx) => this.cancel(cx)), { small: true })
      : button(t, "generate", this.shown?.exact ? "Regenerate" : "✦ Generate", (_e, cx) => cx.spawn(async (cx) => this.generate(cx)),
        { kind: this.shown?.exact ? "outline" : "solid", small: true, disabled: !this.canGenerate(), tooltip: this.cli === null ? `${backendOf(this.backend).program} isn't installed` : null });
    return h_flex().h(grow(48)).flex_none().px(14).gap(10).items_center().border_b(1).border_color(t.border)
      .child(logo(t, px(22)))
      .child(div().flex_none().font_semibold().text_size(TEXT.heading).child("Walkthrough"))
      .when(Boolean(r || this.folder), (el) => el.child(h_flex().min_w(0).flex_shrink(1).h(grow(22)).px(8).gap(6).items_center().rounded_full().bg(t.raised).text_size(TEXT.note).text_color(t.muted)
        .child(div().min_w(0).truncate().child(r ? r.name : this.folder))
        .when(Boolean(r), (e) => e.child(div().flex_none().text_color(t.dim).child("⎇")).child(div().min_w(0).truncate().child(r.branch || "detached")))))
      .child(div().flex_1())
      .when(this.loading, (el) => el.child(div().text_size(TEXT.small).text_color(t.dim).frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90)))
      .child(this.placementSwitch(t))
      .child(action)
      .when(inDialog, (el) => el.child(button(t, "close", "Esc", () => closeOverlay(this.own.overlay), { kind: "ghost", small: true })));
  }

  /**
   * This copy's pane, null in a dialog. Known from init, else the only walkthrough pane; `clicked`: the focused one,
   * since a click on this copy focuses its pane.
   */
  ownPane(clicked = false) {
    if (this.inDialog) return null;
    const mods = panes().filter((x) => x.mod === "walkthrough");
    const mine = mods.find((x) => x.pane === this.own.pane) ?? (clicked ? mods.find((x) => x.focused) : null) ?? (mods.length === 1 ? mods[0] : null);
    if (mine) this.own.pane = mine.pane;
    return mine ?? null;
  }

  placementSwitch(t) {
    const here = placementOf({ overlay: this.own.overlay, pane: this.ownPane()?.pane }, panes(), this.tab);
    return h_flex().flex_none().p(3).gap(2).rounded(9).bg(t.raised).children(PLACEMENTS.map((pl) =>
      div().id(`as-${pl.key}`).px(8).h(grow(22)).flex().items_center().rounded(6).text_size(TEXT.body).tooltip(pl.about)
        .when(pl.key === here, (e) => e.bg(t.popover).text_color(t.foreground).font_semibold().shadow_xs())
        .when(pl.key !== here, (e) => e.cursor_pointer().text_color(t.muted).hover((st) => st.text_color(t.foreground)).on_click(() => this.moveTo(pl.key, true)))
        .child(pl.label)));
  }

  /** Moves the walkthrough to another Placement: a copy opens there on the same step, then this one closes. */
  /** The shown page as the `step` prop counts it; none for Recap or a contract page, which the prop can't name. */
  stepProp() {
    const page = this.view ? this.pageList().pages[this.step] : null;
    const step = page?.kind === "step" ? this.view.steps.indexOf(page.step) : page?.kind === "task" ? -1 : page?.kind === "tail" ? this.view.steps.length : null;
    return step === null ? {} : { step };
  }

  moveTo(where, clicked = false) {
    const all = panes(), mine = this.ownPane(clicked);
    const here = placementOf({ overlay: this.own.overlay, pane: mine?.pane }, all, this.tab);
    // Without its own pane it couldn't close itself: two would stay open.
    if (where === here || (here !== "dialog" && !mine)) return;
    const p = { folder: this.folder, scope: this.scope, tab: this.tab, from: this.from, commit: this.commit?.hash, since: this.since?.hash, first: this.first?.hash, pr: this.pr?.number,
      ...(this.scope === "turn" && this.turn ? { turn: this.turn.id } : {}), ...this.stepProp() };
    const origin = spaces().some((s) => s.tabs.some((x) => x.id === this.tab)) && this.tab !== mine?.tab ? this.tab : null;
    if (where === "tab") run("tab.new", { name: "Walkthrough", space: this.space?.id, mod: "walkthrough", props: p });
    else {
      // A pane and a dialog belong over the Origin tab; when it's gone, over the one shown.
      if (here === "tab" && origin) run("tab.select", { id: origin });
      if (where === "pane") run("pane.split", { direction: "right", mod: "walkthrough", props: p });
      else openOverlay({ mod: "walkthrough", kind: "dialog", modal: true, width: 0.74, height: 0.8, props: p });
    }
    // The whole tab only when this is all it holds and the copy went elsewhere: other panes there may be agents.
    if (here === "dialog") closeOverlay(this.own.overlay);
    else if (where !== "tab" && origin && all.filter((x) => x.tab === mine.tab).length === 1) run("tab.close", { id: mine.tab });
    else run("pane.close", { pane: mine.pane });
  }

  /**
   * A newer release, when there is one: the prompt to hand the agent, since an
   * added mod can't update itself (see lib/update.js).
   */
  updateStrip(t, latest) {
    const link = (id, label, onClick, color = t.muted) => div().id(id).flex_none().text_size(TEXT.note).text_color(color).cursor_pointer()
      .hover((s) => s.text_color(t.foreground)).on_click(onClick).child(label);
    return h_flex().id("update-strip").flex_none().mx(14).mt(10).px(12).py(8).gap(10).items_center().flex_wrap().rounded(10)
      .border_1().border_color(t.accent + "40").bg(t.accent + "12")
      .child(div().flex_none().size(grow(20)).rounded_full().bg(t.accent + "29").flex().items_center().justify_center().text_size(TEXT.small).text_color(t.accent).child("↑"))
      .child(div().flex_none().text_size(TEXT.ui).font_semibold().child(`Walkthrough ${latest.tag} is out`))
      .child(div().flex_none().text_size(TEXT.note).text_color(t.dim).child(`you have ${VERSION}`))
      .child(div().flex_1().min_w(0).truncate().text_size(TEXT.note).text_color(t.muted).child("Paste the prompt to your agent to update."))
      .child(button(t, "update-copy", "Copy prompt", (_e, cx) => {
        cx.write_to_clipboard(PROMPT);
        notify({ title: "Copied", body: PROMPT, level: "success", timeout: 2500 });
      }, { kind: "solid", small: true, tooltip: PROMPT }))
      .child(link("update-notes", "What changed", (_e, cx) => cx.open_url(latest.url ?? RELEASES), t.accent))
      .child(link("update-later", "Later", (_e, cx) => { this.update.dismiss(latest.tag); cx.notify(); }))
      .child(link("update-stop", "Stop checking", (_e, cx) => { this.update.stop(); cx.notify(); }));
  }

  /** What to read (the scope, and which one of it) on the left; how it is written on the right. Wraps when narrow. */
  toolbar(t) {
    const tabs = h_flex().flex_none().p(3).gap(2).rounded(9).bg(t.raised).children(SCOPES.map((s) =>
      div().id(`scope-${s.key}`).px(10).h(grow(24)).flex().items_center().rounded(6).text_size(TEXT.body).cursor_pointer()
        .when(this.scope === s.key, (e) => e.bg(t.popover).text_color(t.foreground).font_semibold().shadow_xs())
        .when(this.scope !== s.key, (e) => e.text_color(t.muted).hover((st) => st.text_color(t.foreground)))
        .tooltip(s.about)
        .on_click((_e, cx) => this.pickScope(s.key, cx))
        .child(s.label)));
    const open = (what) => (_e, cx) => { this.togglePicker(what); cx.notify(); };
    const label = (text) => div().flex_none().text_size(TEXT.small).text_color(t.dim).child(text);
    const auto = this.auto !== "off";
    const narrow = (this.width ?? 1000) < grow(1100); // the row's text grows with font_size, so its breakpoint does too
    const which = h_flex().min_w(0).gap(8).items_center().flex_wrap()
      .when(Boolean(this.view) && this.wide(), (el) => el.child(button(t, "toggle-sidebar", this.sidebar ? "«" : "»",
        (_e, cx) => { this.sidebar = !this.sidebar; savePrefs({ sidebar: this.sidebar }); cx.notify(); },
        { kind: "ghost", small: true, tooltip: this.sidebar ? "Hide the contents" : "Show the contents" })))
      .child(tabs)
      .when(this.scope === "branch", (el) => el.child(label("vs")).child(picker(t, "pick-base", this.base ?? "Pick a base", open("base"))))
      .when(this.scope === "commit", (el) => el.child(picker(t, "pick-commit", this.commit ? `${this.commit.short} ${this.commit.subject}` : "Pick a commit", open("commit"))))
      .when(this.scope === "commit" && Boolean(this.commit), (el) => el.child(label("from")).child(picker(t, "pick-since", this.since ? `${this.since.short} ${this.since.subject}` : "its parent", open("since"))))
      .when(this.scope === "range", (el) => el.child(label("from")).child(picker(t, "pick-first", this.first ? `${this.first.short} ${this.first.subject}` : "Pick the first commit", open("first")))
        .child(label("to")).child(picker(t, "pick-commit", this.commit ? `${this.commit.short} ${this.commit.subject}` : "Pick the last commit", open("commit"))))
      .when(this.scope === "pr" && Boolean(this.prs?.length), (el) => el.child(picker(t, "pick-pr", this.pr ? `#${this.pr.number} ${this.pr.title}` : "Pick a pull request", open("pr"))))
      .when(this.scope === "turn" && this.turns.length > 0, (el) => el.child(picker(t, "pick-turn", turnLabel(this), open("turn")))
        .child(button(t, "toggle-auto", auto ? "⚡ Auto" : "Auto: off", (_e, cx) => { this.choose("auto", auto ? "off" : "on-open", cx); }, {
          kind: auto ? "soft" : "ghost", small: true,
          tooltip: auto ? `${autoOf(this.auto).about}. Click to turn it off.` : "Only when you press Generate. Click to write the last turn's walkthrough without a click.",
        }))
        .child(button(t, "toggle-record", this.record ? "● Recording" : "Record: off", (_e, cx) => this.choose("record", !this.record, cx), {
          kind: this.record ? "soft" : "ghost", small: true,
          tooltip: this.record
            ? "Recording the turns of pi, codex and opencode in this repository while the walkthrough is open (Claude Code's are left to its hooks). Click to stop."
            : "For agents with no hooks (pi, codex, opencode): record their turns while the walkthrough is open. Click to start.",
        })));
    const how = h_flex().flex_none().gap(8).items_center().flex_wrap()
      .when(Boolean(this.diff), (el) => el.child(picker(t, "pick-task", this.taskFace(), open("task"),
        { tooltip: this.task ? `Matched against ${this.task.label.charAt(0).toLowerCase()}${this.task.label.slice(1)}` : "What the change is matched against", kind: this.task ? "soft" : "outline" })))
      .child(h_flex().flex_none().items_center().rounded(8).border_1().border_color(t.border)
        .child(picker(t, "pick-backend", backendOf(this.backend).name, open("backend"), { tooltip: "Who writes the walkthrough", kind: "ghost" }))
        .child(div().w(1).h(px(14)).bg(t.border))
        .child(picker(t, "pick-model", modelOf(this.model).name, open("model"), { tooltip: "Model", kind: "ghost" }))
        .child(div().w(1).h(px(14)).bg(t.border))
        .child(picker(t, "pick-language", languageOf(this.language).name, open("language"), { tooltip: "Language of the explanations", kind: "ghost" })));
    return (narrow ? v_flex().items_start() : h_flex().items_center()).id("toolbar-options").flex_none().px(14).py(8).gap(8).border_b(1).border_color(t.border)
      .child(which.when(!narrow, (e) => e.flex_1()))
      .child(how);
  }

  /** Whether the pane has room for the contents column beside the page. */
  wide() {
    // The contents column grows with the text; the page keeps its 472px beside it.
    return (this.width ?? 1000) >= grow(248) + 472;
  }

  canGenerate() {
    return Boolean(this.cli && this.repo && this.diff && this.diff.hunkCount > 0 && !this.job && !this.loading);
  }

  /** The open picker's rows and where it sits: { items, width, side }. */
  menuOf(kind) {
    const commitRow = (c, selected) => ({ label: `${c.short}  ${c.subject}`, hint: `${c.author} · ${c.when}`, value: c, selected });
    switch (kind) {
      case "base": return { side: "left", width: 280, items: this.bases.map((b) => ({ label: b, value: b, selected: b === this.base })) };
      case "commit": return { side: "left", width: 460, items: this.commits.map((c) => commitRow(c, c.hash === this.commit?.hash)) };
      case "since": return { side: "left", width: 460, items: [{ label: "its parent", hint: "The picked commit alone", value: null, selected: !this.since },
        ...olderCommits(this.commits, this.commit).map((c) => commitRow(c, c.hash === this.since?.hash))] };
      case "first": return { side: "left", width: 460, items: (this.commit ? [this.commit, ...olderCommits(this.commits, this.commit)] : []).map((c) => commitRow(c, c.hash === this.first?.hash)) };
      case "pr": return { side: "left", width: 480, items: (this.prs ?? []).map((p) => ({
        label: `#${p.number}  ${p.title}`, hint: `${p.author} · ${p.head} → ${p.base}${p.draft ? " · draft" : ""}${p.current ? " · this branch" : ""}`, value: p, selected: p.number === this.pr?.number })) };
      case "turn": return { side: "left", width: 480, items: turnItems(this) };
      case "task": {
        const choice = this.taskChoiceFor(this.diff?.sk), source = this.source();
        const found = source && this.issueTexts.get(this.issueKey(source)), issues = Array.isArray(found) ? found : []; // a lookup in flight is no issue yet
        const hint = (m) => {
          if (m.key === "issue") return firstLine(issues.map((i) => `#${i.number} ${i.title}`).join(" · "), 60);
          if (m.key === "auto" && choice.mode === "auto") return this.task ? this.task.label : "Nothing found for this change";
          if (m.key === "own" && choice.text) return firstLine(choice.text, 60);
          return m.about;
        };
        return { side: "right", width: 360, items: TASK_MODES.filter((m) => m.key !== "issue" || issues.length).map((m) => ({ label: m.key === "own" ? "Your own…" : m.name, hint: hint(m), value: m.key, selected: m.key === choice.mode })) };
      }
      case "backend": return { side: "right", width: 300, items: BACKENDS.map((b) => ({ label: b.name, hint: b.about, value: b.key, selected: b.key === this.backend })) };
      case "model": return { side: "right", width: 280, items: modelsOf(this.backend).map((m) => ({ label: m.name, hint: m.about, value: m.key, selected: m.key === this.model })) };
      case "language": return { side: "right", width: 220, items: LANGUAGES.map((l) => ({ label: l.name, right: l.english === l.name ? "" : l.english, value: l.tag, selected: l.tag === this.language })) };
      case "agent": {
        const current = this.agent();
        return { side: "footer", width: 320, items: this.agentChoices().map((a) => ({
          label: `${a.program?.name ?? "Agent"} · ${a.tab_name || `tab ${a.tab_index + 1}`}`, right: a.address, value: a.address, selected: a === current,
        })) };
      }
      default: return { side: "left", width: 280, items: [] };
    }
  }

  /** Opens a picker (or closes it, when it is the open one) with its chosen row highlighted and in view. */
  togglePicker(kind) {
    if (this.picking === kind) { this.picking = null; return; }
    this.picking = kind;
    this.menuIndex = Math.max(0, this.menuOf(kind).items.findIndex((i) => i.selected));
    this.menuScroll.scroll_to_item(this.menuIndex, "center");
    this.handle.focus();
  }

  /** ↑ ↓ move the highlight, Enter chooses it. Returns false for keys a picker doesn't use. */
  menuKey(key, cx) {
    const { items } = this.menuOf(this.picking);
    if (key === "down" || key === "up") {
      if (!items.length) return true;
      this.menuIndex = (this.menuIndex + (key === "down" ? 1 : -1) + items.length) % items.length;
      this.menuScroll.scroll_to_item(this.menuIndex);
      return true;
    }
    if (key === "enter") {
      const item = items[this.menuIndex];
      if (item) this.choose(this.picking, item.value, cx);
      return true;
    }
    return false;
  }

  popup(t) {
    const kind = this.picking;
    const { items, width, side } = this.menuOf(kind);
    const el = menu(t, `menu-${kind}`, items, (item, cx) => this.choose(kind, item.value, cx), { width, active: this.menuIndex, scroll: this.menuScroll });
    if (side === "footer") return div().absolute().bottom(4).right(14).child(el);
    return div().absolute().top(4).when(side === "left", (e) => e.left(14)).when(side === "right", (e) => e.right(14)).child(el);
  }

  body(t) {
    // An empty state: an icon (none while something is only being read), what is going on, why, and what to do instead.
    const center = (title, text = "", { icon = null, color = null, actions = [] } = {}) => v_flex().size_full().items_center().justify_center().gap(8).p(24)
      .when(Boolean(icon), (e) => e.child(div().mb(6).size(px(44)).rounded(px(12)).border_1().border_color(t.border).bg(t.raised).flex().items_center().justify_center()
        .text_size(px(19)).text_color(color ?? t.muted).child(icon)))
      .child(div().max_w(560).text_center().text_size(TEXT.heading).text_color(icon ? t.foreground : t.muted).child(title))
      .when(Boolean(text), (e) => e.child(div().max_w(560).text_center().text_size(TEXT.ui).line_height(1.5).text_color(t.dim).child(text)))
      .when(actions.length > 0, (e) => e.child(h_flex().mt(8).gap(8).items_center().children(actions)));
    const goTo = (key, label) => button(t, `go-${key}`, label, (_e, cx) => this.pickScope(key, cx), { kind: "ghost", small: true });
    if (this.remote) return center("This space is on another machine", "Walkthroughs read git and run the model on this computer only.", { icon: "⇄" });
    if (this.repo === undefined) return center("Reading…");
    if (this.repo === null) return center("Not a git repository", this.folder ? `Nothing to walk through in ${this.folder}.` : "Focus a terminal in a repository, then open the walkthrough again.", { icon: "⎇" });
    if (this.error) return center("Couldn't read the diff", this.error, { icon: "!", color: t.ansi1 });
    if (this.scope === "pr" && this.prError) return center("Couldn't list the pull requests", this.prError, { icon: "!", color: t.ansi1, actions: [goTo("branch", "Read it as a Branch")] });
    if (this.scope === "pr" && this.prs === null) return center("Reading the pull requests…");
    if (this.scope === "pr" && !this.prs.length) return center("No open pull requests", "This repository has none open on GitHub.", { icon: "#", actions: [goTo("branch", "Branch"), goTo("uncommitted", "Uncommitted")] });
    if (this.scope === "turn" && !this.turns.length) return hookHelp(this, t);
    if (!this.source()) return center(this.scope === "branch" ? "Pick the branch to compare with" : this.scope === "pr" ? "Pick a pull request" : this.scope === "range" ? "Pick the first commit" : "Pick a commit", this.scope === "pr" && this.prMissing ? `#${this.prMissing} isn't among the open pull requests.` : "Nothing is read or generated until you do.", { icon: "◇" });
    if (!this.diff) return center("Reading the diff…");
    if (!this.diff.files.length) {
      if (this.scope === "turn") {
        const open = this.turn && isOpen(this.turn);
        return center(open ? "Nothing to walk through yet" : "This turn changed no files", open ? "This turn hasn't changed any files. It's read up to now while the agent works." : "The working tree is the same at its end as at its start.", {
          icon: "↺",
          actions: [
            ...(this.turns.length > 1 ? [picker(t, "empty-turns", "Other turns", (_e, cx) => { this.togglePicker("turn"); cx.notify(); })] : []),
            goTo("uncommitted", "Uncommitted"),
          ],
        });
      }
      return center("Nothing to walk through", `No ${SCOPES.find((s) => s.key === this.scope)?.label.toLowerCase()} changes${this.scope === "branch" ? ` against ${this.base}` : ""}.`, {
        icon: "✓", color: t.ansi2,
        actions: this.scope === "uncommitted" ? [goTo("branch", "Branch"), ...(this.turns.length ? [goTo("turn", "Last turn")] : [])] : [goTo("uncommitted", "Uncommitted")],
      });
    }
    if (!this.view) return this.job ? this.progress(t) : this.intro(t);
    // A narrow pane gives the page the room; the footer still moves between steps.
    return h_flex().size_full().items_start()
      .when(this.sidebar && this.wide(), (e) => e.child(this.contents(t)))
      .child(v_flex().flex_1().min_w(0).h_full()
        .children(this.banners(t))
        .child(this.reportPage(t)));
  }

  /** The reader's own task, written under the toolbar. */
  taskEditor(t) {
    const length = this.taskText.value().length;
    return v_flex().id("task-editor").flex_none().px(14).py(10).gap(8).border_b(1).border_color(t.border).bg(t.raised)
      .child(div().text_size(TEXT.body).text_color(t.muted).child("What should this change do? Each request in it is matched to the steps that carry it out. It stays on this computer, and is left out of what is posted to a pull request."))
      .child(div().w_full().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Textarea.new(this.taskText).w_full()))
      .child(h_flex().gap(8).items_center()
        .child(button(t, "task-save", "Use this task", (_e, cx) => this.saveTaskText(cx), { kind: "solid", small: true, disabled: length > MAX_TASK_CHARS }))
        .child(button(t, "task-cancel", "Cancel", (_e, cx) => { this.closeTaskEditor(); cx.notify(); }, { kind: "ghost", small: true }))
        .child(div().flex_1())
        .child(div().text_size(TEXT.small).text_color(length > MAX_TASK_CHARS ? t.ansi1 : t.dim).child(`${length.toLocaleString("en")} / ${MAX_TASK_CHARS.toLocaleString("en")}`)));
  }

  /**
   * The task's page: each request, where in the walkthrough it is carried out
   * or that this diff doesn't show it, then the steps no request points at.
   */
  taskPage(t) {
    const tv = this.taskView, e = this.shown.entry, task = e.task;
    const toStep = (s, id) => div().id(id).flex_none().px(8).h(grow(22)).flex().items_center().rounded_full().border_1().border_color(t.border).bg(t.raised)
      .text_size(TEXT.note).cursor_pointer().hover((st) => st.bg(t.hover)).tooltip(s.title)
      .on_click((_e, cx) => { this.go(this.pageIndex("step", s.id)); cx.notify(); })
      .child(`${s.position}. ${clip(s.title, 42)}`);
    const color = (c) => (c === "seen" ? t.ansi2 : c === "partly" ? t.ansi3 : t.dim);
    const row = (a) => h_flex().id(`ask-${a.id}`).w_full().max_w(820).gap(12).items_start().p(12).rounded(12).border_1().border_color(t.border).bg(t.surface ?? t.raised)
      .child(div().flex_none().size(grow(24)).rounded_full().bg(color(a.coverage) + "24").flex().items_center().justify_center().text_size(TEXT.body).text_color(color(a.coverage)).tooltip(COVERAGE_ABOUT[a.coverage]).child(COVERAGE_MARK[a.coverage]))
      .child(v_flex().flex_1().min_w(0).gap(5)
        .child(div().text_size(TEXT.strong).line_height(1.5).when(a.coverage === "absent", (el) => el.text_color(t.muted)).child(a.text))
        .child(h_flex().gap(6).flex_wrap().items_center()
          .when(a.coverage === "partly", (el) => el.child(chip(t, "Partly", t.ansi3)))
          .when(a.coverage === "absent", (el) => el.child(div().text_size(TEXT.note).text_color(t.dim).child("Not in this diff")))
          .children(a.steps.map((s) => toStep(s, `task-${a.id}-${s.id}`)))
          .when(a.tail > 0, (el) => el.child(div().id(`task-${a.id}-tail`).text_size(TEXT.note).text_color(t.dim).cursor_pointer().hover((st) => st.text_color(t.foreground))
            .on_click((_e, cx) => { this.go(this.pageIndex("tail")); cx.notify(); })
            .child(a.steps.length ? `and ${a.tail} hunk${a.tail === 1 ? "" : "s"} under Not covered` : `${a.tail} hunk${a.tail === 1 ? "" : "s"} under Not covered`)))
          .when(a.outdated, (el) => el.child(chip(t, "Outdated", t.blocked, t.blocked + "14").tooltip("Code this request was tied to has changed or is gone")))));
    const text = task?.text ?? "";
    return pageFrame(`task-${e.generatedAt}`)
      .child(h_flex().gap(8).items_center()
        .child(eyebrow(t, `Task${task?.label ? `  ·  ${task.label}` : ""}`).flex_1())
        .when(Boolean(text), (el) => el.child(button(t, "task-text", this.showTaskText ? "Hide the task" : "Show the task", (_e, cx) => { this.showTaskText = !this.showTaskText; cx.notify(); }, { kind: "ghost", small: true }))))
      .child(div().text_size(TEXT.display).line_height(1.3).font_semibold().child("What the task asks for"))
      .child(div().max_w(820).text_size(TEXT.ui).line_height(1.5).text_color(t.muted).child("Each request in the task, and the steps that carry it out. It says where a request shows up in this diff, not whether it is done well; a request not in this diff may be done elsewhere."))
      // A walkthrough of the prompts stays shown as more are sent; it says so rather than going stale.
      .when(task?.from === "prompts" && this.task?.from === "prompts" && taskKey(task) !== taskKey(this.task), (el) => el.child(
        div().max_w(820).text_size(TEXT.body).text_color(t.dim).child(`Matched against the prompts as they were when it was written; ${this.task.label.replace(/ since .*$/, "")} now. Regenerate to match against them too.`)))
      .when(this.showTaskText && Boolean(text), (el) => el.child(v_flex().w_full().max_w(820).p(10).gap(2).rounded(8).border_1().border_color(t.border).bg(t.raised).text_size(TEXT.body).text_color(t.muted)
        .children(text.split("\n").slice(0, 200).map((l) => div().child(l || " ")))
        .when(Boolean(task?.context), (c) => c.child(div().pt(8).text_size(TEXT.small).text_color(t.dim).child("Earlier prompts of the same session were given to make it clear.")))))
      .when(!tv.asks.length, (el) => el.child(this.notice(t, t.muted, "The task names nothing concrete to match against the change: no request in it would show up as a change to files.")))
      .when(tv.asks.length > 0, (el) => el.child(v_flex().w_full().gap(8).children(tv.asks.map(row))))
      .when(tv.outside.length > 0, (el) => el
        .child(div().pt(10).text_size(TEXT.heading).font_semibold().child("Not tied to any request"))
        .child(div().max_w(820).text_size(TEXT.ui).text_color(t.muted).child("Steps no request in the task points at: supporting work the model didn't tie to one, or work the task doesn't mention."))
        .child(h_flex().gap(6).flex_wrap().children(tv.outside.map((s) => toStep(s, `task-out-${s.id}`)))));
  }

  /** Before the first walkthrough: what would be read, and what it would cost. */
  intro(t) {
    const d = this.diff;
    const size = this.promptSize ?? d.text.length;
    const tokens = estimateTokens(size);
    const tooBig = size > MAX_PROMPT_CHARS;
    const totals = d.files.map((f) => ({ f, added: f.hunks.reduce((n, h) => n + h.added, 0), deleted: f.hunks.reduce((n, h) => n + h.deleted, 0) }));
    return v_flex().id("intro").size_full().overflow_y_scrollbar().items_center().p(28).gap(14)
      .child(v_flex().w_full().max_w(620).gap(14)
        .child(div().text_size(TEXT.hero).line_height(1.25).font_semibold().child("Read this change in the order it makes sense"))
        .child(div().text_size(TEXT.strong).line_height(1.6).text_color(t.muted).child(`${backendOf(this.backend).writer} groups related edits into steps, orders them so each builds on the last, and explains what each one changes. It explains; it doesn't judge the code. Every edit it leaves out is still listed at the end.`))
        .child(h_flex().gap(8).items_center().flex_wrap()
          .child(chip(t, `${d.fileCount} file${d.fileCount === 1 ? "" : "s"}`))
          .child(chip(t, `${d.hunkCount} hunk${d.hunkCount === 1 ? "" : "s"}`))
          .child(chip(t, `≈ ${formatTokens(tokens)} tokens`, tooBig ? t.ansi1 : undefined))
          .when(d.generatedPaths.length > 0, (e) => e.child(chip(t, `${d.generatedPaths.length} generated, not sent`)))
          .when(d.unread.length > 0, (e) => e.child(chip(t, `${d.unread.length} not read`)))
          .when(Boolean(this.task), (e) => e.child(chip(t, `Task: ${this.task.short}`, t.accent).tooltip(`${this.task.label}: each request in it is matched to the steps that carry it out. The task menu changes or turns it off.`))))
        .when(this.cli === null, (e) => e.child(this.notice(t, t.ansi1, `${backendOf(this.backend).name}'s \`${backendOf(this.backend).program}\` isn't installed, or isn't on the PATH Herdr starts programs with. Walkthroughs are written by \`${backendOf(this.backend).program} -p\`; the backend menu in the toolbar picks another.`)))
        .when(tooBig, (e) => e.child(this.notice(t, t.ansi1, "This diff is too large to send whole, and a walkthrough of part of it would read as complete. Pick a narrower scope.")))
        .when(d.hunkCount === 0 && d.files.length > 0, (e) => e.child(this.notice(t, t.muted, d.generatedPaths.length ? "Only generated files changed; they aren't sent to the model." : "No changed lines to read: binary files, renames or mode changes only.")))
        .when(Boolean(this.genError), (e) => e.child(this.notice(t, t.ansi1, this.genError)))
        .child(h_flex().gap(10).items_center()
          .child(button(t, "start", `Generate walkthrough with ${modelOf(this.model).name}`, (_e, cx) => cx.spawn(async (cx) => this.generate(cx)), { kind: "solid", disabled: !this.canGenerate() || tooBig }))
          .child(div().text_size(TEXT.note).text_color(t.dim).child(`in ${languageOf(this.language).name}`)))
        .child(v_flex().mt(6).rounded(12).overflow_hidden().border_1().border_color(t.border).bg(t.surface ?? t.raised).children(totals.map(({ f, added, deleted }, i) =>
          h_flex().h(grow(32)).px(12).gap(8).items_center().when(i > 0, (e) => e.border_t(1).border_color(t.border)).text_size(TEXT.body)
            .child(div().flex_1().min_w(0).truncate().text_color(f.generated || f.unread ? t.dim : t.foreground).child(f.path))
            .when(f.generated, (e) => e.child(chip(t, "generated")))
            .when(Boolean(f.unread), (e) => e.child(div().text_size(TEXT.small).text_color(t.dim).child(f.unread)))
            .when(f.status !== "modified" && !f.unread, (e) => e.child(div().text_size(TEXT.small).text_color(t.dim).child(f.status)))
            .child(div().text_size(TEXT.note).text_color(t.ansi2).child(added ? `+${added}` : ""))
            .child(div().text_size(TEXT.note).text_color(t.ansi1).child(deleted ? `−${deleted}` : ""))))));
  }

  /** A message in a tinted box with a coloured edge; `t.muted` makes it a quiet, grey one. */
  notice(t, color, text) {
    const quiet = color === t.muted;
    return div().w_full().px(12).py(8).rounded(10).border_1().border_color(quiet ? t.border : color + "40").bg(quiet ? t.raised : color + "12")
      .text_size(TEXT.body).line_height(1.5).text_color(quiet ? t.muted : t.foreground).child(text);
  }

  /** A generation running with nothing to show yet. */
  progress(t) {
    const j = this.job.meta;
    const row = (state, label, extra = "") => h_flex().gap(10).items_center()
      .child(state === "run" ? div().w(grow(14)).text_color(t.accent).frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90) : div().w(grow(14)).text_color(state === "done" ? t.ansi2 : t.dim).child(state === "done" ? "✓" : "○"))
      .child(div().text_size(TEXT.base).text_color(state === "wait" ? t.dim : t.foreground).child(label))
      .child(div().text_size(TEXT.body).text_color(t.dim).child(extra));
    return v_flex().size_full().items_center().justify_center().gap(12)
      .child(v_flex().gap(10)
        .child(row("done", "Read the diff", `${j.hunkCount} hunk${j.hunkCount === 1 ? "" : "s"}`))
        .child(row(this.job.done ? "done" : "run", modelOf(j.model).backend === "pi" ? `Asking pi (${modelOf(j.model).name})` : `Asking Claude ${modelOf(j.model).name}`, formatElapsed(Date.now() - j.started)))
        .child(row(this.job.done ? "run" : "wait", "Putting the steps together")))
      .child(div().mt(8).max_w(480).text_center().text_size(TEXT.note).text_color(t.dim).child("It runs in the background: close this and come back, the walkthrough will be waiting."))
      .child(button(t, "cancel-run", "Cancel", (_e, cx) => cx.spawn(async (cx) => this.cancel(cx)), { small: true }));
  }

  banners(t) {
    const out = [];
    // One shape for every banner: a coloured edge and tint, an icon, what happened, then (dimmer) the detail.
    // `color` null: a quiet, grey one.
    const bar = (id, color, icon, text, action, detail = "") => h_flex().id(id).flex_none().mx(20).mt(12).pl(10).pr(8).py(7).gap(10).items_center().rounded(10)
      .border_1().border_color(color ? color + "40" : t.border).bg(color ? color + "12" : t.raised)
      .child(div().flex_none().size(grow(20)).rounded_full().flex().items_center().justify_center().text_size(TEXT.label).font_semibold()
        .bg(color ? color + "29" : t.hover).text_color(color ?? t.muted).child(icon))
      .child(div().flex_1().min_w(0).text_size(TEXT.body).line_height(1.5)
        .child(text).when(Boolean(detail), (e) => e.child(div().text_size(TEXT.note).text_color(t.muted).child(detail))))
      .when(Boolean(action), (e) => e.child(action));
    const regen = (label) => button(t, `banner-${label}`, label, (_e, cx) => cx.spawn(async (cx) => this.generate(cx)), { small: true, disabled: !this.canGenerate() });
    if (this.job) {
      out.push(bar("b-job", t.accent, "…", `Writing a new walkthrough with ${modelOf(this.job.meta.model).name}… ${formatElapsed(Date.now() - this.job.meta.started)}`,
        button(t, "b-cancel", "Cancel", (_e, cx) => cx.spawn(async (cx) => this.cancel(cx)), { small: true })));
    }
    if (this.genError) out.push(bar("b-error", t.ansi1, "!", this.genError, null));
    const newer = this.scope === "turn" ? newerTurn(this.turns, this.turn, this.turnPinned, this.from, tabTerminals(this)) : null;
    if (newer) {
      out.push(bar("b-newer", t.accent, "↑", "There's a newer turn.",
        button(t, "b-newer-go", "Show", (_e, cx) => this.choose("turn", newer, cx), { small: true }), firstLine(newer.prompt, 80)));
    }
    const changed = this.changedSteps();
    if (changed.length) {
      const n = changed.length;
      out.push(bar("b-changed", t.accent, "↻", `${n === 1 ? "1 step" : `${n} steps`} changed since you last read ${n === 1 ? "it" : "them"}.`,
        button(t, "b-changed-go", "Go →", (_e, cx) => {
          // Each press goes on to the next one, then round to the first.
          this.go(this.pageIndex("step", (changed.find((st) => this.pageIndex("step", st.id) > this.step) ?? changed[0]).id));
          cx.notify();
        }, { small: true })));
    }
    const e = this.shown?.entry;
    if (e && !this.shown.exact && !this.job) {
      const otherModel = e.model !== this.model, otherLanguage = e.language !== this.language;
      if (otherModel || otherLanguage) {
        out.push(bar("b-other", null, "i", `Showing the ${languageOf(e.language).name} walkthrough by ${modelOf(e.model).name}. There's none in ${languageOf(this.language).name} by ${modelOf(this.model).name} for this code yet.`, regen("Generate")));
      } else {
        const n = this.view.outdated, fresh = this.view.uncovered.reduce((s, u) => s + u.hunks.length, 0);
        // Same code, other key: it was written for another task, under other preferences, or by an older version of this mod.
        // Prompts to agents count as one kind of task: a walkthrough of them stays exact as more are sent.
        const taskChanged = taskCacheKey(e.task) !== taskCacheKey(this.task);
        const why = !taskChanged ? "This code hasn't changed, but your preferences or this mod's prompt have since this walkthrough was written."
          : !e.task ? "This walkthrough was written without a task. Regenerate to match the change against it."
          : !this.task ? "This walkthrough was matched against a task that is now off or gone."
          : "The task has changed since this walkthrough was matched against it.";
        if (e.code && e.code === codeKey(this.diff.files)) out.push(bar("b-prefs", null, "i", why, regen("Regenerate")));
        else out.push(bar("b-stale", t.blocked, "!", "The code moved on since this walkthrough was written.", regen("Regenerate"), n
          ? `${n === 1 ? "1 step describes" : `${n} steps describe`} code that has changed or is gone.`
          : `${fresh} new hunk${fresh === 1 ? " is" : "s are"} listed under Not covered.`));
      }
    }
    return out;
  }

  /** The table of contents: every step by part (or only those not read), read ones ticked, outdated and changed ones flagged. */
  contents(t) {
    const v = this.view, w = this.shown.entry.walkthrough;
    const uncovered = v.uncovered.length;
    const pages = this.pages(), tailIndex = pages.length - 1;
    // Part titles are the model's, contract labels translated: both upper-cased in the report's language.
    const lang = this.contractLanguage();
    const groupTitle = (title, right = null, locale = "en") => eyebrow(t, title, right, locale).px(8).pt(14).pb(4);
    const fresh = v.uncovered.reduce((n, u) => n + u.hunks.filter((h) => !hunkRead(h.id, this.read)).length, 0);
    const changed = new Set(this.changedSteps().map((s) => s.id));
    // The step on screen stays listed, read or not, so the list never loses its place.
    const listed = (s) => !this.unreadOnly || this.pageIndex("step", s.id) === this.step || !isRead(s, this.read);
    const parts = v.parts.map((part) => ({ part, steps: part.steps.filter(listed) })).filter((p) => p.steps.length);
    // One row shape for every page: a round badge (its number, ✓ once read, ! when outdated), its title, then any tag.
    const row = (id, i) => h_flex().id(id).w_full().px(8).h(grow(32)).gap(9).items_center().rounded(8).cursor_pointer()
      .when(i === this.step, (e) => e.bg(t.accent + "1f"))
      .when(i !== this.step, (e) => e.hover((st) => st.bg(t.hover)))
      .on_click((_e, cx) => { this.go(i); cx.notify(); });
    const badge = () => div().flex_none().size(grow(20)).rounded_full().flex().items_center().justify_center().text_size(TEXT.tiny).font_semibold();
    const stepRow = (s, i, read = s.hunkIds ? isRead(s, this.read) : this.visitedPages.has(s.id)) => row(`toc-${s.id}`, i)
      .child(badge().when(i === this.step && !s.outdated, (e) => e.bg(t.accent).text_color(t.solid_foreground ?? "#ffffff"))
        .when(s.outdated, (e) => e.bg(t.blocked + "29").text_color(t.blocked).child("!"))
        .when(!s.outdated && read && i !== this.step, (e) => e.bg(t.ansi2 + "24").text_color(t.ansi2).child("✓"))
        .when(!s.outdated && (!read || i === this.step), (e) => e.when(i !== this.step, (x) => x.bg(changed.has(s.id) ? t.accent + "29" : t.raised)
          .text_color(changed.has(s.id) ? t.accent : t.muted)).child(String(s.position))))
      .when(changed.has(s.id), (e) => e.tooltip("Changed since you last read it"))
      // A step read and left behind fades; one to skim is quieter than one to read.
      .child(div().flex_1().min_w(0).truncate().text_size(TEXT.ui)
        .when(i === this.step, (e) => e.font_medium())
        .when(read && i !== this.step, (e) => e.text_color(t.dim))
        .when(!(read && i !== this.step) && s.weight === "skim", (e) => e.text_color(t.muted)).child(s.title))
      .when(s.weight === "key", (e) => e.child(tag(t, "KEY", t.accent, t.accent + "24", TEXT.badge).tooltip("Key change: the rest depends on it")));
    const total = v.steps.length, done = v.steps.filter((s) => isRead(s, this.read)).length;
    // The summary is cut to its first few lines until asked for; the steps stay in view.
    const long = (w.summary ?? "").length > SUMMARY_CHARS;
    return v_flex().id("contents").w(grow(248)).flex_none().h_full().overflow_y_scrollbar().border_r(1).border_color(t.border).bg(t.surface ?? t.popover).px(10).py(14).gap(2)
      .child(div().px(8).text_size(TEXT.lead).line_height(1.35).font_semibold().child(w.title))
      .when(Boolean(w.summary), (e) => e.child(div().px(8).pt(6).text_size(TEXT.body).line_height(1.55).text_color(t.muted)
        .child(long && !this.summaryOpen ? clip(w.summary, SUMMARY_CHARS) : w.summary)))
      .when(long, (e) => e.child(div().id("summary-more").px(8).pt(2).text_size(TEXT.note).text_color(t.accent).cursor_pointer()
        .on_click((_e, cx) => { this.summaryOpen = !this.summaryOpen; cx.notify(); }).child(this.summaryOpen ? "Show less" : "Show more")))
      .child(h_flex().mt(12).mx(8).gap(8).items_center()
        .child(meter(t, 104, total ? done / total : 0, done === total && total ? t.ansi2 : t.accent))
        .child(div().flex_1().min_w(0).truncate().text_size(TEXT.small).text_color(t.dim).child(`${done} of ${total} read`)))
      .when(this.unreadOnly, (e) => e.child(h_flex().px(8).pt(8).gap(6).items_center().text_size(TEXT.small).text_color(t.accent)
        .child(div().child("Unread only")).child(div().text_color(t.dim).child("· u shows all"))))
      .child(groupTitle("Overview"))
      .child(stepRow({ id: "recap", title: recapStrings(this.contractLanguage()).recap, position: "≡" }, 0))
      .when(Boolean(this.taskView), (e) => {
        const tv = this.taskView;
        return e.child(row("toc-task", this.pageIndex("task"))
          .tooltip(tv.total ? `${tv.met} of ${tv.total} request${tv.total === 1 ? "" : "s"} show up in this diff (t)` : "The task names nothing concrete (t)")
          .child(badge().bg(t.accent + "24").text_color(t.accent).child("◎"))
          .child(div().flex_1().text_size(TEXT.ui).child("Task"))
          .child(tv.met < tv.total ? tag(t, `${tv.met} / ${tv.total}`, t.ansi3, t.ansi3 + "24") : tag(t, tv.total ? `${tv.met} / ${tv.total}` : "—")));
      })
      .when(pages.some((p) => p.kind === "contract"), (e) => e.child(groupTitle(contractStrings(lang).contracts, null, lang)))
      .children(pages.flatMap((page, index) => page.kind === "contract" ? [
        stepRow({ id: `contract-${page.contract.kind}`, title: page.title, position: CONTRACT_ICON[page.contract.kind] ?? "◇" }, index),
      ] : []))
      .children(parts.flatMap(({ part, steps }) => [
        groupTitle(part.title, `${part.steps.filter((s) => isRead(s, this.read)).length} / ${part.steps.length}`, lang),
        ...steps.map((s) => stepRow(s, this.pageIndex("step", s.id))),
      ]))
      .when(this.unreadOnly && !parts.length, (e) => e.child(div().px(8).pt(12).text_size(TEXT.body).text_color(t.muted).child("Every step is read.")))
      .child(div().mt(10).mb(4).mx(8).h(1).bg(t.border))
      .child(row("toc-tail", tailIndex)
        .child(badge().bg(t.raised).text_color(t.dim).child("…"))
        .child(div().flex_1().text_size(TEXT.ui).text_color(t.muted).child("Not covered"))
        .child(fresh ? tag(t, String(uncovered), t.accent, t.accent + "24") : tag(t, String(uncovered)))
        .when(fresh > 0, (e) => e.tooltip(`${fresh} hunk${fresh === 1 ? "" : "s"} not read`)))
      .child(div().px(8).pt(14).text_size(TEXT.label).line_height(1.5).text_color(t.dim).child(this.meta()));
  }

  meta() {
    const e = this.shown.entry;
    const when = new Date(e.generatedAt);
    const parts = [`${modelOf(e.model).name} · ${languageOf(e.language).name}`, `${when.toLocaleDateString()} ${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`];
    if (typeof e.cost === "number") parts.push(`$${e.cost.toFixed(e.cost < 0.1 ? 3 : 2)}`);
    return parts.join(" · ");
  }

  page(t, s) {
    const part = this.view.parts[s.part];
    const total = this.view.steps.length;
    const read = isRead(s, this.read);
    const entry = this.shown.entry, at = `${s.id}-${entry.generatedAt}`;
    // A file both staged and unstaged is one path to link to.
    const paths = [...new Set(this.diff.files.map((f) => f.path))];
    const answers = followUpsOf(entry, s.id);
    const shown = { card: null, groups: [] }; // filled by code(), for followScroll
    const frame = pageFrame(`page-${s.id}-${entry.generatedAt}`).track_scroll(this.pageScroll)
      // No event says the page scrolled: the wheel says so, and the pointer while it drags the scrollbar.
      .on_scroll_wheel((_e, cx) => this.followScroll(cx)).on_mouse_move((_e, cx) => this.followScroll(cx, false))
      .child(h_flex().gap(8).items_center()
        // The part title in the report's language, the rest in English: each upper-cased by its own rules.
        .child(eyebrow(t, `${upper(part.title, this.contractLanguage())}  ·  ${upper(`Step ${s.position} of ${total}`)}`).flex_1())
        .child(button(t, "ask", "Ask", (_e, cx) => { this.asking ? this.closeAsk() : this.openAsk(); cx.notify(); }, { kind: "ghost", small: true, tooltip: "Ask the agent about this step: it answers in its terminal (a)" }))
        .children(FOLLOW_UPS.map((f) => button(t, `follow-${f.key}`, f.name, (_e, cx) => cx.spawn(async (cx) => this.followUp(f.key, cx)), {
          kind: "ghost", small: true, disabled: s.outdated || Boolean(this.following) || !this.cli || answers.some((a) => a.key === f.key),
          tooltip: s.outdated ? "Its code has changed: regenerate to ask about it as it is now" : `${f.about}, from ${modelOf(entry.model).name}, shown under the explanation (${Object.keys(FOLLOW_KEY).find((k) => FOLLOW_KEY[k] === f.key)})`,
        })))
        .child(button(t, "read-toggle", read ? "✓ Read" : "Mark read", (_e, cx) => { this.toggleRead(); cx.notify(); }, {
          kind: read ? "soft" : "outline", small: true, disabled: s.outdated,
          tooltip: s.outdated ? "Its code has changed: regenerate to read it as it is now" : read ? "Mark unread (x)" : "Mark read (x)",
        })))
      .child(h_flex().gap(10).items_center().flex_wrap()
        .child(div().text_size(TEXT.display).line_height(1.3).font_semibold().child(s.title))
        .when(s.weight === "key", (e) => e.child(chip(t, "Key change", t.accent, t.accent + "14").tooltip("The rest of the change depends on this, or its main behavior lives here. Read it closely.")))
        .when(s.weight === "skim", (e) => e.child(chip(t, "Context", null, t.raised).tooltip("A supporting change, here so the rest makes sense. Safe to skim.")))
        .when(s.outdated, (e) => e.child(chip(t, "Outdated", t.blocked, t.blocked + "14").tooltip("Code this step described has changed or is gone."))))
      .when(Boolean(this.navigationFile), (e) => e.child(div().text_size(TEXT.note).text_color(t.accent).child(`From blueprint: ${this.navigationFile}`)))
      .when(Boolean(this.taskView?.total), (e) => {
        const asks = asksOf(this.taskView, s);
        const toTask = (id, el) => div().id(id).cursor_pointer().on_click((_e, cx) => { this.go(this.pageIndex("task")); cx.notify(); }).child(el);
        return e.child(h_flex().gap(6).flex_wrap().items_center().children(asks.length
          ? asks.map((a) => toTask(`for-${s.id}-${a.id}`, chip(t, `For: ${clip(a.text, 64)}`, t.ansi2, t.ansi2 + "12").tooltip(a.text)))
          : [toTask(`for-${s.id}-none`, chip(t, "Not tied to a request", null, t.raised).tooltip("No request in the task points at this step: supporting work, or work the task doesn't mention."))]));
      })
      // Markdown, so the model's `code` reads as code rather than as backticks; the diff's files it names are links.
      .child(div().w_full().max_w(820).text_size(TEXT.heading).line_height(1.65).child(this.prose(`step-text-${at}`, s.text, paths, { markdown: true })))
      .when(this.asking, (e) => e.child(this.questionBox(t)))
      .children(answers.map((a) => v_flex().w_full().max_w(820).p(12).gap(6).rounded(10).border_1().border_color(t.border).bg(t.surface ?? t.raised)
        .child(eyebrow(t, a.name))
        .child(div().text_size(TEXT.ui).line_height(1.6).child(this.prose(`follow-${a.key}-${at}`, a.text, paths)))))
      .when(this.following?.step === s.id, (e) => e.child(div().text_size(TEXT.body).text_color(t.dim)
        .child(`${modelOf(entry.model).backend === "pi" ? `Asking pi (${modelOf(entry.model).name})` : `Asking Claude ${modelOf(entry.model).name}`} for a closer look…`)))
      .when(s.notes.length > 0, (e) => e.child(v_flex().w_full().max_w(820).gap(8).children(s.notes.map((n, i) =>
        callout(t, noteColor(t, n.kind), NOTE_LABEL[n.kind], this.prose(`note-${at}-${i}`, n.text, paths, { markdown: true })).id(`note-${s.id}-${i}`).tooltip(NOTE_ABOUT[n.kind])))))
      // The banner above and the Outdated chip say it already; this says how much.
      .when(s.outdated, (e) => e.child(h_flex().gap(6).items_center().flex_wrap().text_size(TEXT.body)
        .child(div().font_semibold().text_color(t.blocked).child(s.found.length ? `${s.missing} of ${s.missing + s.found.length} hunks` : "Every hunk"))
        .child(div().text_color(t.muted).child(s.found.length ? "changed or gone · what's left is below" : "this step described changed or is gone · regenerate to read the code as it is now"))))
      .when(s.found.length > 0, (e) => e.child(this.code(t, s.found, true, shown)));
    this.codeGroups = shown;
    const pinned = this.stuck && shown.groups[this.stuck.index];
    return v_flex().flex_1().min_h(0).relative().child(frame)
      .when(Boolean(pinned), (e) => e.child(this.fileHeader(t, pinned.file, pinned.sum, pinned.twice).id("pinned-header").shadow_xs()
        .absolute().top(this.stuck.shift).left(PAGE_PADDING + 1).right(PAGE_PADDING + 1)));
  }

  /** Recap with a native, local diagram; source remains available on demand. */
  recap(t) {
    const w = this.shown.entry.walkthrough;
    // The blueprint card's own padding (12 a side) and border (1 a side).
    const available = this.contentWidth() - 26;
    const omitted = (w.omitted?.recap ?? 0) + (w.omitted?.contracts ?? 0);
    const language = this.contractLanguage(), words = recapStrings(language);
    const changeZoom = (factor, cx) => { this.diagramZoom = Math.max(0.5, Math.min(3, this.diagramZoom * factor)); cx.notify(); };
    const heading = (text) => div().pt(8).text_size(TEXT.section).font_semibold().child(text);
    const filePill = (path) => div().flex_none().px(7).h(grow(20)).flex().items_center().rounded(6).bg(t.raised).border_1().border_color(t.border)
      .text_size(TEXT.small).font_family(settings().font_family ?? "JetBrains Mono").text_color(t.muted).child(path);
    const zoom = h_flex().flex_none().items_center().rounded(8).border_1().border_color(t.border)
      .child(button(t, "diagram-minus", "−", (_e, cx) => changeZoom(1 / 1.25, cx), { small: true, kind: "ghost", tooltip: "Zoom out" }))
      .child(div().w(1).h(px(14)).bg(t.border))
      .child(button(t, "diagram-fit", "Fit", (_e, cx) => { this.diagramZoom = 1; cx.notify(); }, { small: true, kind: "ghost" }))
      .child(div().w(1).h(px(14)).bg(t.border))
      .child(button(t, "diagram-plus", "+", (_e, cx) => changeZoom(1.25, cx), { small: true, kind: "ghost", tooltip: "Zoom in" }));
    const change = (c, i) => h_flex().id(`recap-change-${i}`).w_full().gap(12).items_start().p(14).rounded(12).border_1().border_color(t.border).bg(t.surface ?? t.raised)
      .child(div().flex_none().size(grow(24)).rounded_full().bg(t.accent + "24").text_color(t.accent).text_size(TEXT.small).font_semibold().flex().items_center().justify_center().child(String(i + 1)))
      .child(v_flex().flex_1().min_w(0).gap(8)
        .child(div().text_size(TEXT.strong).line_height(1.55).font_medium().child(TextView.markdown(`recap-change-text-${i}`, c.description).on_link_click(openWebLink)))
        .child(h_flex().gap(8).items_start()
          .child(div().flex_none().pt(2).text_size(TEXT.label).font_semibold().text_color(t.dim).child(upper(words.motivation, words.tag)))
          .child(div().flex_1().min_w(0).text_size(TEXT.ui).line_height(1.55).text_color(t.muted).child(TextView.markdown(`recap-motivation-${i}`, c.motivation).on_link_click(openWebLink))))
        .child(h_flex().gap(6).flex_wrap().children(c.paths.map(filePill))));
    return pageFrame(`recap-${this.shown.entry.generatedAt}`)
      .child(eyebrow(t, words.recap, null, words.tag))
      .child(div().text_size(TEXT.display).line_height(1.3).font_semibold().child(w.title))
      .when(Boolean(w.summary), (e) => e.child(div().max_w(820).text_size(TEXT.heading).line_height(1.6).text_color(t.muted).child(w.summary)))
      .when(omitted > 0, (e) => e.child(callout(t, t.ansi3, null, words.leftOut.replace("{count}", String(omitted)))))
      .when(!w.recap, (e) => e.child(callout(t, t.muted, null, recapMarkdown(null).replace(/^###[^\n]*\n+/, "").trim())))
      .when(Boolean(w.recap?.architecture.description), (e) => e
        .child(heading(words.architecture))
        .child(div().max_w(820).text_size(TEXT.strong).line_height(1.6).child(TextView.markdown("architecture-description", w.recap.architecture.description).on_link_click(openWebLink).selectable(true))))
      .when(Boolean(w.recap) && !w.recap.architecture.mermaid, (e) => e.child(div().text_size(TEXT.body).text_color(t.dim).child(words.noBlueprint)))
      .when(Boolean(w.recap?.architecture.mermaid), (el) => el
        .child(v_flex().w_full().gap(10).p(12).rounded(12).border_1().border_color(t.border).bg(t.surface ?? t.raised)
          .child(h_flex().gap(8).items_center()
            .child(zoom)
            .child(div().flex_1())
            .child(button(t, "diagram-source", this.diagramSource ? "Hide Mermaid" : "Mermaid source", (_e, cx) => { this.diagramSource = !this.diagramSource; cx.notify(); }, { small: true, kind: "ghost" })))
          .child(blueprintView(w.recap.architecture, t, {
            words,
            width: available, zoom: this.diagramZoom,
            files: this.diff?.files ?? [], selectedId: this.diagramSelected, fileTargets: (path) => this.blueprintTargets(path),
            onSelect: (id, cx) => { this.diagramSelected = id; cx.notify(); },
            onFile: (path, cx) => this.goToBlueprintFile(path, cx),
            onClose: (cx) => { this.diagramSelected = null; cx.notify(); },
          })))
        .when(this.diagramSource, (e) => e.child(TextView.markdown("mermaid-source", "```mermaid\n" + mermaidWithConnections(w.recap.architecture.mermaid, w.recap.architecture.connections, w.recap.architecture.groups) + "\n```").selectable(true))))
      .when(Boolean(w.recap?.changes.length || w.recap?.other?.length), (e) => e.child(heading(words.changesAndMotivations)))
      .when(Boolean(w.recap), (e) => e.children(w.recap.changes.map(change)))
      .when(Boolean(w.recap?.other?.length), (e) => e.child(v_flex().id("recap-other").w_full().gap(8).p(14).rounded(12).border_1().border_color(t.border)
        .child(div().text_size(TEXT.label).font_semibold().text_color(t.dim).child(upper(words.other, words.tag)))
        .child(h_flex().gap(6).flex_wrap().children(w.recap.other.map(filePill)))));
  }

  /** Everything no step covers, file by file, each with the model's one-line note. */
  tail(t) {
    const v = this.view;
    return pageFrame(`tail-${this.shown.entry.generatedAt}`)
      .child(eyebrow(t, "The rest of the diff"))
      .child(div().text_size(TEXT.display).line_height(1.3).font_semibold().child("Not covered"))
      .child(div().max_w(820).text_size(TEXT.ui).text_color(t.muted).child(v.uncovered.length
        ? "Changes no step describes: edits made after the walkthrough was written, ones the model judged routine, generated and binary files, and files too large to read. Open a file to see its hunks."
        : "Every change is covered by a step."))
      .children([...v.uncovered].sort((a, b) => Number(b.file.path === this.navigationFile) - Number(a.file.path === this.navigationFile)).map(({ file, hunks, note }) => {
        const id = `${file.scope}:${file.path}`;
        const open = this.openFiles.has(id);
        const twice = v.uncovered.filter((u) => u.file.path === file.path).length > 1;
        const added = hunks.reduce((n, h) => n + h.added, 0), deleted = hunks.reduce((n, h) => n + h.deleted, 0);
        const fresh = hunks.filter((h) => !hunkRead(h.id, this.read)).length;
        const all = { hunkIds: hunks.map((h) => h.id) };
        return v_flex().rounded(12).overflow_hidden().border_1().border_color(file.path === this.navigationFile || fresh ? t.accent + "88" : t.border).bg(t.surface ?? t.raised)
          .child(h_flex().pr(8).gap(8).items_center()
            .child(h_flex().id(`tail-${id}`).flex_1().min_w(0).px(12).py(9).gap(8).items_center().when(hunks.length > 0, (e) => e.cursor_pointer().hover((st) => st.bg(t.hover)))
              .on_click((_e, cx) => { if (!hunks.length) return; open ? this.openFiles.delete(id) : this.openFiles.add(id); cx.notify(); })
              .child(div().w(grow(10)).text_size(TEXT.caret).text_color(t.dim).child(hunks.length ? (open ? "▼" : "▶") : ""))
              .child(v_flex().flex_1().min_w(0)
                .child(div().truncate().text_size(TEXT.ui).when(hunks.length > 0 && !fresh, (e) => e.text_color(t.muted)).child(twice ? `${file.path}  (${scopeName(file.scope)})` : file.path))
                .when(Boolean(note || file.unread), (e) => e.child(div().text_size(TEXT.note).text_color(t.dim).child(file.unread ?? note))))
              .when(file.status !== "modified", (e) => e.child(div().text_size(TEXT.small).text_color(t.dim).child(file.status)))
              .child(div().text_size(TEXT.note).text_color(t.ansi2).child(added ? `+${added}` : ""))
              .child(div().text_size(TEXT.note).text_color(t.ansi1).child(deleted ? `−${deleted}` : "")))
            .when(fresh > 0, (e) => e.child(chip(t, fresh === hunks.length ? "Unread" : `${fresh} unread`, t.accent, t.accent + "14")))
            .when(hunks.length > 0, (e) => e.child(button(t, `tail-read-${id}`, fresh ? "Mark read" : "✓ Read", (_e, cx) => { this.setRead(all, fresh > 0); cx.notify(); },
              { kind: "ghost", small: true, tooltip: fresh ? "Mark this file's hunks here read" : "Mark them unread" }))))
          .when(open, (e) => e.child(div().border_t(1).border_color(t.border).child(this.code(t, hunks.map((hunk) => ({ hunk, file })), false))));
      }));
  }

  /** A file's header over its code: path, status, totals, and a button that copies the path as shown. */
  fileHeader(t, file, sum, twice, divided = false) {
    return h_flex().when(divided, (e) => e.border_t(1).border_color(t.border)).h(grow(36)).px(12).gap(8).items_center().bg(t.raised).border_b(1).border_color(t.border)
      .child(div().flex_none().text_size(TEXT.body).text_color(t.dim).child("▤"))
      .child(div().flex_1().min_w(0).truncate().text_size(TEXT.ui).font_medium().when(file.path === this.navigationFile, (e) => e.text_color(t.accent)).child(file.path))
      .when(twice || (file.scope === "staged" && this.scope === "uncommitted"), (e) => e.child(chip(t, scopeName(file.scope))))
      .when(file.status !== "modified", (e) => e.child(div().text_size(TEXT.small).text_color(t.dim).child(file.oldPath ? `${file.status} from ${file.oldPath}` : file.status)))
      .when(Boolean(sum?.added), (e) => e.child(chip(t, `+${sum.added}`, t.ansi2, t.ansi2 + "1f")))
      .when(Boolean(sum?.deleted), (e) => e.child(chip(t, `−${sum.deleted}`, t.ansi1, t.ansi1 + "1f")))
      .child(button(t, `copy-path-${file.scope}:${file.path}`, "Copy path", (_e, cx) => { cx.write_to_clipboard(file.path); this.flash(`Copied ${file.path}.`); cx.notify(); },
        { kind: "ghost", small: true, tooltip: "Copy this file's repository-relative path" }));
  }

  /**
   * Hunks as code, consecutive ones of a file under one header. Click a line to comment on it.
   * `shown`: given, gets the card's and each file's element ids, for the pinned header.
   */
  code(t, found, headers = true, shown = null) {
    const font = settings().font_family ?? "JetBrains Mono";
    // One group of rows per file header (one in all without headers), each measured for the pinned header.
    const groups = [];
    let rows = [];
    let lines = 0, last = null, cut = 0;
    const twice = new Set();
    const scopes = new Map();
    for (const { file } of found) {
      if (scopes.has(file.path) && scopes.get(file.path) !== file.scope) twice.add(file.path);
      scopes.set(file.path, file.scope);
    }
    // The line-number column is as wide as the largest number here needs.
    const numbers = grow(numberDigits(found.map((f) => f.hunk)) * 7 + 8);
    const totals = new Map(fileTotals(found).map((f) => [f.path, f]));
    let previous = null;
    for (const { hunk, file } of found) {
      // Past the cap nothing more is drawn, headers included; the lines left are counted.
      if (lines >= MAX_PAGE_LINES) { cut += hunk.lines.length; continue; }
      const name = `${file.scope}:${file.path}`;
      const opened = headers && name !== last;
      if (opened || !groups.length) {
        rows = [];
        groups.push({ id: `file-${hunk.id}`, file, sum: totals.get(file.path), twice: twice.has(file.path), rows });
      }
      if (opened) rows.push(this.fileHeader(t, file, totals.get(file.path), twice.has(file.path), groups.length > 1));
      // Where the hunk is, in words, instead of git's @@ line: lines skipped since the last one of its file, its line, its function.
      const label = hunkLabel(hunk, name === last ? previous : null);
      last = name;
      previous = hunk;
      // Without headers (Not covered), a hunk not read yet says so.
      const fresh = !headers && !hunkRead(hunk.id, this.read);
      rows.push(h_flex().h(grow(24)).px(12).gap(8).items_center().when(rows.length > 0 && !opened, (e) => e.border_t(1).border_color(t.border))
        .bg(fresh ? t.accent + "1f" : (t.surface ?? t.hover)).text_size(TEXT.small).text_color(fresh ? t.accent : t.dim).tooltip(hunk.header)
        .when(fresh, (e) => e.child(div().flex_none().child("●")))
        .child(div().flex_none().child(label.skipped ? `⋯ ${label.skipped} line${label.skipped === 1 ? "" : "s"} · ${label.at}` : label.at))
        .when(Boolean(label.context), (e) => e.child(div().flex_1().min_w(0).truncate().font_family(font).text_color(fresh ? t.accent : t.muted).child(label.context))));
      for (const line of numberLines(hunk)) {
        if (lines >= MAX_PAGE_LINES) { cut++; continue; }
        lines++;
        rows.push(this.line(t, file, line, font, numbers));
        if (line.kind === "meta") continue;
        const spot = this.spot(file, line.number, line.kind === "-" ? "-" : "+");
        const c = this.comments.find((x) => sameSpot(x, spot));
        if (c) rows.push(this.commentRow(t, c));
        if (this.target && sameSpot(this.target, spot)) rows.push(this.commentBox(t));
      }
    }
    const blocks = groups.map((g) => v_flex().id(g.id).w_full().on_size_change(this.measure(g.id)).children(g.rows));
    if (cut) blocks.push(div().px(10).py(6).text_size(TEXT.note).text_color(t.dim).child(`${cut} more line${cut === 1 ? "" : "s"} not drawn here.`));
    const card = `card-${found[0]?.hunk.id ?? "none"}`;
    if (shown) Object.assign(shown, { card, groups: groups.map(({ rows: _rows, ...g }) => g) });
    const box = v_flex().id(card).w_full().flex_none().rounded(10).border_1().border_color(t.border).bg(t.background).overflow_hidden().on_size_change(this.measure(card));
    if (this.wrap) return box.children(blocks);
    // One sideways scroll for the whole hunk list, so line numbers and code stay aligned; the column is as wide as its longest line.
    return box.child(h_flex().id(`code-${found[0]?.hunk.id ?? "none"}`).w_full().overflow_x_scrollbar()
      .child(v_flex().flex_none().min_w_full().children(blocks)));
  }

  line(t, file, { kind, number, text }, font, numbers = 44) {
    if (kind === "meta") return div().h(grow(20)).px(10).flex().items_center().text_size(TEXT.small).text_color(t.dim).font_family(font).child(text);
    const side = kind === "-" ? "-" : "+";
    const spot = this.spot(file, number, side);
    const selected = this.target && sameSpot(this.target, spot);
    // An added or removed line has a coloured edge as well as its tint, so the change reads at a glance.
    return h_flex().id(`l-${file.scope}:${file.path}-${side}${number}`).when(this.wrap, (e) => e.min_h(grow(21)).items_start().pr(10)).when(!this.wrap, (e) => e.h(grow(21))).w_full().gap(8).font_family(font).text_size(TEXT.note).cursor_pointer()
      .border_l(2).border_color(kind === "+" ? t.ansi2 : kind === "-" ? t.ansi1 : "#00000000")
      .when(kind === "+", (e) => e.bg(t.ansi2 + "14")).when(kind === "-", (e) => e.bg(t.ansi1 + "14"))
      .when(Boolean(selected), (e) => e.bg(t.selection))
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        this.target = { ...spot, code: text };
        const existing = this.comments.find((c) => sameSpot(c, spot));
        this.input.set_value(existing?.text ?? "");
        this.input.focus();
        cx.notify();
      })
      .child(div().w(numbers).flex_none().text_right().text_color(t.dim).child(String(number)))
      .child(div().w(grow(10)).flex_none().text_color(kind === "+" ? t.ansi2 : kind === "-" ? t.ansi1 : t.dim).child(kind === " " ? "" : kind))
      .child(h_flex().when(this.wrap, (e) => e.flex_1().min_w(0).flex_wrap()).when(!this.wrap, (e) => e.flex_none().whitespace_nowrap().pr(10)).children(text
        ? tokenize(text, file.path).map((tok) => div().when(!this.wrap, (e) => e.flex_none()).min_w(0).text_color(syntaxColor(t, tok.kind)).child(tok.text))
        : [div().child(" ")]));
  }

  commentRow(t, c) {
    return h_flex().px(10).py(5).gap(8).items_start().bg(t.popover).border_y(1).border_color(t.border)
      .child(div().w(grow(62)).flex_none().text_right().text_size(TEXT.small).text_color(t.accent).child("comment"))
      .child(div().flex_1().text_size(TEXT.body).child(c.text))
      .child(button(t, `rm-${c.scope}:${c.path}-${c.kind}${c.line}`, "✕", (_e, cx) => { this.comments = this.comments.filter((x) => x !== c); cx.notify(); }, { kind: "ghost", small: true }));
  }

  commentBox(t) {
    return h_flex().px(10).py(6).gap(8).items_center().bg(t.popover).border_y(1).border_color(t.accent)
      .child(div().flex_1().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).w_full()))
      .child(button(t, "comment-save", "Add", (_e, cx) => { this.saveComment(); cx.notify(); }, { kind: "solid", small: true }))
      .child(button(t, "comment-cancel", "Cancel", (_e, cx) => { this.target = null; this.handle.focus(); cx.notify(); }, { kind: "ghost", small: true }));
  }

  questionBox(t) {
    const agent = this.agent();
    return h_flex().max_w(820).px(10).py(6).gap(8).items_center().rounded(6).bg(t.popover).border_1().border_color(t.accent)
      .child(div().flex_1().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.question).w_full()))
      .child(picker(t, "pick-agent-ask", agent ? `${agent.program?.name ?? "Agent"} · ${agent.address}` : "No agent here", (_e, cx) => { this.togglePicker("agent"); cx.notify(); }, { disabled: !agent }))
      .child(button(t, "ask-send", "Send", (_e, cx) => cx.spawn(async (cx) => this.ask(cx)), { kind: "solid", small: true, disabled: !agent, tooltip: "Pastes the question, with the step's title, text and files, into the agent and presses Enter" }))
      .child(button(t, "ask-cancel", "Cancel", (_e, cx) => { this.closeAsk(); cx.notify(); }, { kind: "ghost", small: true }));
  }

  footer(t) {
    const steps = this.view.steps.length, pages = this.pages(), page = pages[this.step], next = pages[this.step + 1];
    const read = this.view.steps.filter((s) => isRead(s, this.read)).length;
    const agent = this.agent();
    const n = this.ownComments().length;
    const wide = (this.width ?? 1000) >= 900;
    return h_flex().h(grow(52)).flex_none().px(14).gap(8).items_center().border_t(1).border_color(t.border).bg(t.surface ?? t.popover)
      .child(button(t, "prev", "← Previous", (_e, cx) => { this.move(-1); cx.notify(); }, { small: true, disabled: this.step === 0 }))
      .child(button(t, "next", next && next.kind !== "step" ? `${next.title} →` : "Next →", (_e, cx) => { this.move(1); cx.notify(); }, { kind: "solid", small: true, disabled: this.step >= pages.length - 1 }))
      .child(h_flex().pl(6).gap(8).items_center()
        .child(meter(t, 72, steps ? read / steps : 0, read === steps && steps ? t.ansi2 : t.accent))
        // A page that isn't a step is named, so the footer says where the reader is as well as how far.
        .child(div().text_size(TEXT.note).text_color(t.dim).child(page?.kind === "tail" ? `End · ${read} / ${steps} read`
          : page?.kind === "step" ? `${read} / ${steps} read` : `${page?.title ?? ""} · ${read} / ${steps} read`)))
      .child(h_flex().id("footer-keys").pl(4).gap(4).items_center().text_size(TEXT.small).text_color(t.dim).tooltip("← → (or j k) move between pages")
        .child(kbd(t, "←")).child(kbd(t, "→")).when(wide, (e) => e.child(div().pl(2).child("to move"))))
      .child(button(t, "wrap", this.wrap ? "Scroll lines" : "Wrap lines", (_e, cx) => { this.wrap = !this.wrap; cx.notify(); },
        { kind: "ghost", small: true, tooltip: this.wrap ? "Keep each line on one row and scroll sideways (w)" : "Fold long lines to fit the width (w)" }))
      .child(button(t, "unread-only", this.unreadOnly ? "Show all" : "Unread only", (_e, cx) => { this.unreadOnly = !this.unreadOnly; cx.notify(); },
        { kind: "ghost", small: true, tooltip: this.unreadOnly ? "List every step again (u)" : "List and step through only the steps not read yet (u)" }))
      .child(div().flex_1())
      .when(this.confirm === "post" && Boolean(this.pr), (e) => e
        .child(div().text_size(TEXT.note).text_color(t.foreground).truncate().child(`Post this walkthrough as a comment on #${this.pr.number}? Everyone who can see the pull request will see it.`))
        .child(button(t, "post-yes", this.posting ? "Posting…" : "Post", (_e, cx) => cx.spawn(async (cx) => this.post(cx)), { kind: "solid", small: true, disabled: this.posting }))
        .child(button(t, "post-no", "Cancel", (_e, cx) => { this.confirm = null; cx.notify(); }, { kind: "ghost", small: true, disabled: this.posting })))
      .when(this.confirm === "notion", (e) => e
        .child(div().text_size(TEXT.note).text_color(t.foreground).truncate().child("Create a Notion page with this walkthrough? Its task, your prompts included, goes with it."))
        .child(button(t, "notion-yes", this.posting ? "Sending…" : "Send", (_e, cx) => cx.spawn(async (cx) => this.sendNotion(cx)), { kind: "solid", small: true, disabled: this.posting }))
        .child(button(t, "notion-no", "Cancel", (_e, cx) => { this.confirm = null; cx.notify(); }, { kind: "ghost", small: true, disabled: this.posting })))
      .when(!this.confirm, (e) => e
        .when(this.scope === "pr" && Boolean(this.pr), (e) => e.child(button(t, "post", `Post to #${this.pr.number}`,
          (_e, cx) => { this.confirm = "post"; this.sent = null; cx.notify(); }, { kind: "ghost", small: true, tooltip: "Adds the walkthrough as a comment on the pull request, after you confirm" })))
        .child(button(t, "copy", "Copy as Markdown", (_e, cx) => cx.spawn(async (cx) => this.copy(cx)), { kind: "ghost", small: true, tooltip: "The steps and notes, without the code: for a pull request, a review or a chat" }))
        .when(Boolean(this.notion), (e) => e.child(button(t, "notion", "Send to Notion", (_e, cx) => { this.confirm = "notion"; this.sent = null; cx.notify(); }, { kind: "ghost", small: true, tooltip: "Creates a Notion page with the walkthrough as Markdown, after you confirm" })))
        .when(Boolean(this.sent), (e) => {
          const ok = /^(Sent|Copied|Posted)\b/.test(this.sent);
          return e.child(div().id("sent").text_size(TEXT.note).text_color(ok ? t.ansi2 : t.dim).truncate().child(ok ? `✓ ${this.sent}${this.sentUrl ? " Open it ↗" : ""}` : this.sent)
            .when(Boolean(this.sentUrl), (e) => e.cursor_pointer().on_click((_e, cx) => cx.open_url(this.sentUrl))));
        })
        .child(div().text_size(TEXT.note).text_color(n ? t.foreground : t.dim).child(n ? `${n} comment${n === 1 ? "" : "s"}` : "Click a line to comment"))
        .when(n > 0, (e) => e
          .child(picker(t, "pick-agent", agent ? `${agent.program?.name ?? "Agent"} · ${agent.address}` : "No agent here", (_e, cx) => { this.togglePicker("agent"); cx.notify(); }, { disabled: !agent }))
          .child(button(t, "send", "Send", (_e, cx) => cx.spawn(async (cx) => this.send(cx)), { kind: "solid", small: true, disabled: !agent, tooltip: "Pastes the comments into the agent and presses Enter" }))));
  }
}
