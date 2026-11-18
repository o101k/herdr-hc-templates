// hc templates beside your agents: list, view, edit, add, duplicate, remove and run the
// templates herdr-core (`hc`) starts agents from (~/.config/herdr-core/templates/*.md).
// Roles (props.role): the panel (default); "toggle", the tab-bar button that shows or hides the
// layout's "hc-templates-panel" node; dialogs "create", "remove" and "run". A dialog does its own
// work while it stays open (its tasks end when it closes), then tells the panel through shared
// state which template to show.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, EditorState, Editor } from "gpui-base";
import { run, theme, settings, layout, spaces, focused, shared, setShared, openOverlay, closeOverlay, props as blockProps, checking, watchFolder, notify, home } from "herdr";
import { field, serializeTemplate, modelOf, programOf, nameProblem, commandProblem, copyName, starterText, tilde, oneLine } from "./model.js";
import { load, save, create, rename, remove, start, templatesDir } from "./store.js";

const MOD = "hc-templates";
const PANEL = "hc-templates-panel"; // the layout node the toggle shows and hides
const CHANGED = "hc-templates.changed"; // { at, select }: a dialog changed the folder
const NOTICE_MS = 4000;

const stop = (_e, cx) => cx.stop_propagation();
const icon = (name, size, color) => svg(`mods/${MOD}/icons/${name}.svg`).size(size).flex_none().text_color(color);
const message = (e) => String(e?.message ?? e).replace(/^Error:\s*/, "");
// Work started from render runs after the render ends: cx.notify() throws while a view renders.
const later = (cx, fn) => cx.spawn(async (cx) => { await cx.sleep(0); return fn(cx); });

function S() {
  const b = Number(settings().ui_font_size) || 13;
  return { title: b + 1, body: b, small: b - 1, tiny: b - 2 };
}
const mono = () => settings().font_family || "Menlo";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) { const f = find(child, id); if (f) return f; }
  return null;
}

// The shown space when it is on this computer (templates and their terminals are local).
function localSpace() {
  const s = spaces().find((x) => x.active) ?? null;
  return s && !s.machine ? s : null;
}
const startFolder = () => (localSpace() ? focused()?.cwd || localSpace().folder || home() : home());

// Starts a template in a new tab of the shown space, names the tab after it and shows it.
async function launch(cx, name, space, cwd, task) {
  const r = await start(name, { space, cwd, task });
  // The terminal becomes a tab once Herdr sees its labels.
  for (let i = 0; i < 40 && !spaces().some((sp) => sp.tabs?.some((tb) => tb.id === r.tab)); i++) await cx.sleep(100);
  run("tab.rename", { id: r.tab, name });
  run("tab.select", { id: r.tab });
  if (r.sent === false) notify({ title: `${name} started without its task`, body: `${r.reason ?? "It wasn't ready."} Read it with hc read ${r.address}.`, level: "warning" });
  return r;
}

const openDialog = (props, width, height) => openOverlay({ mod: MOD, kind: "dialog", width, height, props });

// ---- Small parts ----

function pill(text, t, color) {
  return div().flex_none().px(6).py(1).rounded(5).bg(t.selected).text_size(S().tiny).text_color(color ?? t.muted).child(text);
}

function iconButton(id, name, tip, t, onClick, o = {}) {
  return h_flex().id(id).size(o.size ?? 26).flex_none().justify_center().items_center().rounded(6).cursor_pointer()
    .when(Boolean(o.disabled), (el) => el.opacity(0.4))
    .hover((s) => s.bg(t.hover)).on_mouse_down("left", stop)
    .on_click((e, cx) => { if (!o.disabled) onClick(e, cx); })
    .tooltip(tip).child(icon(name, o.icon ?? 14, o.color ?? t.muted));
}

function button(id, label, t, onClick, o = {}) {
  const solid = o.kind === "solid", danger = o.kind === "danger";
  const bg = solid ? t.solid : danger ? t.ansi1 : t.raised;
  const fg = solid ? t.solid_foreground : danger ? t.background : t.foreground;
  return h_flex().id(id).h(28).px(12).gap(6).flex_none().items_center().justify_center().rounded(7)
    .bg(bg).text_color(fg).text_size(S().small).font_semibold()
    .when(!solid && !danger, (el) => el.border_1().border_color(t.border))
    .when(Boolean(o.disabled), (el) => el.opacity(0.45))
    .when(!o.disabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)))
    .on_mouse_down("left", stop)
    .on_click((e, cx) => { if (!o.disabled) onClick(e, cx); })
    .children([o.icon ? icon(o.icon, 12, fg) : null, label].filter(Boolean));
}

function label(text, t) {
  return div().flex_none().text_size(S().tiny).font_semibold().text_color(t.dim).child(text.toUpperCase());
}

function inputBox(id, state, t, o = {}) {
  return div().id(id).h(30).px(9).flex().flex_none().items_center().rounded(7).border_1()
    .border_color(o.error ? t.ansi1 : t.border).bg(t.background).cursor_text().on_mouse_down("left", stop)
    .child(Input.new(state).flex_1().min_w(0).h_full().text_size(o.size ?? S().body).text_color(t.foreground)
      .when(Boolean(o.mono), (el) => el.font_family(mono())));
}

// ---- The tab-bar button ----

function toggle() {
  const t = theme(), node = find(layout(), PANEL), on = node && !node.hidden;
  return h_flex().size_full().pr(10).items_center().bg(t.chrome).border_b(1).border_color(t.border)
    .child(h_flex().id("toggle-hc-templates").h(26).px(8).gap(5).flex_none().items_center().rounded(6)
      .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
      .hover((s) => s.bg(t.hover)).on_mouse_down("left", stop)
      .on_click(() => run("layout.toggle", { id: PANEL }))
      .child(image(`mods/${MOD}/mark.svg`).w(16).h(16).flex_none()).child("Templates"));
}

export default class Templates extends View {
  init(_props, cx) {
    this.role = blockProps()?.role ?? "panel";
    if (this.role === "toggle") return;
    if (this.role !== "panel") return this.initDialog(cx);
    this.state = null;      // load(): entries, skillshare, sourceDir
    this.sel = null;        // the open template's name, or null for the list
    this.form = null;       // the open template's inputs
    this.error = null;      // the folder couldn't be read
    this.notice = null;     // { text, kind, at }
    this.busy = false;
    this.stale = false;     // the open template changed on disk while it had edits
    this.seen = shared(CHANGED)?.at ?? 0;
    this.wasHidden = true;
    if (checking()) return;
    cx.spawn(async (cx) => this.reload(cx));
    cx.spawn(async (cx) => this.watch(cx));
  }

  // Reloads whenever the templates folder, or the folder its links point into, changes.
  async watch(cx) {
    for (;;) {
      const dirs = [templatesDir(), this.state?.sourceDir].filter(Boolean);
      const watches = dirs.map((d) => watchFolder(d));
      try { await Promise.race(watches); } catch { await cx.sleep(10000); }
      for (const w of watches) w.cancel();
      await cx.sleep(250);
      await this.reload(cx);
    }
  }

  async reload(cx, select) {
    try {
      this.state = await load();
      this.error = null;
    } catch (e) {
      this.error = message(e);
    }
    if (select !== undefined) this.sel = select;
    const entry = this.entry();
    if (this.sel && !entry) { this.sel = null; this.dropForm(); }
    else if (entry && (!this.form || this.form.entry.name !== entry.name || select !== undefined)) this.fill(entry);
    else if (entry && this.form && entry.text !== this.form.entry.text) {
      if (this.dirty()) this.stale = true;
      else this.fill(entry);
    }
    cx.notify();
  }

  entry() {
    return this.sel ? this.state?.entries.find((e) => e.name === this.sel) ?? null : null;
  }

  dropForm() {
    if (!this.form) return;
    for (const k of ["name", "description", "command", "body"]) this.form[k]?.release();
    this.form = null;
  }

  // Puts the template's values in fresh inputs (from init, a task or a click, never render).
  fill(entry) {
    this.dropForm();
    this.stale = false;
    const t = theme(), p = entry.parsed;
    this.form = {
      entry,
      name: InputState.new({ value: entry.name, placeholder: "name" }),
      description: InputState.new({ value: field(p, "description"), placeholder: "What it does and what to give it" }),
      command: InputState.new({ value: field(p, "command"), placeholder: "claude --model sonnet" }),
      body: EditorState.new({ language: "markdown", value: p.body, soft_wrap: true, line_numbers: false, folding: false,
        font_family: mono(), font_size: 12,
        syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6, punctuation: t.muted } }),
    };
    for (const k of ["name", "description", "command", "body"]) this.form[k].on("change", (_e, cx) => cx.notify());
  }

  values() {
    const f = this.form;
    return { name: f.name.value().trim(), description: oneLine(f.description.value()), command: oneLine(f.command.value()), body: f.body.value() };
  }

  dirty() {
    if (!this.form) return false;
    const v = this.values(), e = this.form.entry, p = e.parsed;
    return v.name !== e.name || v.description !== field(p, "description") || v.command !== field(p, "command") || v.body !== p.body;
  }

  // A line in the footer that leaves by itself; problems stay twice as long.
  say(cx, text, kind = "info") {
    const at = Date.now();
    this.notice = { text, kind, at };
    cx.spawn(async (cx) => {
      await cx.sleep(kind === "error" ? NOTICE_MS * 2 : NOTICE_MS);
      if (this.notice?.at === at) { this.notice = null; cx.notify(); }
    });
  }

  open(name) {
    this.sel = name;
    const e = this.entry();
    if (e) this.fill(e);
  }

  back() { this.sel = null; this.dropForm(); this.stale = false; }

  async saveForm(cx) {
    if (this.busy || !this.form) return;
    const e = this.form.entry, v = this.values();
    const problem = nameProblem(v.name, this.state.entries.map((x) => x.name), e.name) ?? commandProblem(v.command);
    if (problem) { this.say(cx, problem, "error"); return cx.notify(); }
    this.busy = true; cx.notify();
    try {
      const text = serializeTemplate(e.parsed, v, v.body);
      if (v.name !== e.name) await rename(this.state, e, v.name, text);
      else await save(e, text);
      this.say(cx, v.name !== e.name ? `Renamed to ${v.name}` : "Saved");
      await this.reload(cx, v.name);
    } catch (err) {
      const m = message(err);
      this.say(cx, /stale|match|changed/i.test(m) ? "It changed on disk. Load the new version first." : m, "error");
      if (/stale|match|changed/i.test(m)) this.stale = true;
    } finally {
      this.busy = false; cx.notify();
    }
  }

  editorPane(entry) {
    if (!localSpace() || !focused()?.pane) return;
    run("pane.split", { direction: "right", argv: ["sh", "-c", 'exec ${VISUAL:-${EDITOR:-vi}} "$1"', MOD, entry.real] });
  }

  render(cx) {
    if (this.role === "toggle") return toggle();
    if (this.role !== "panel") return this.renderDialog(cx);
    const t = theme();

    const change = shared(CHANGED);
    if (change?.at && change.at !== this.seen) {
      this.seen = change.at;
      later(cx, (cx) => this.reload(cx, change.select ?? null));
    }
    const node = find(layout(), PANEL), shownNow = !node?.hidden;
    if (shownNow && this.wasHidden && !checking()) later(cx, (cx) => this.reload(cx));
    this.wasHidden = !shownNow;

    const entry = this.entry();
    return v_flex().id("hc-templates").size_full().min_h(0).rounded(10).overflow_hidden()
      .bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(S().body)
      .child(entry && this.form ? this.renderDetail(t, entry, node) : this.renderList(t, node));
  }

  header(t, node, lead, actions) {
    return h_flex().h(44).flex_none().pl(lead.back ? 6 : 14).pr(8).gap(8).items_center().border_b(1).border_color(t.border)
      .children([lead.back ? iconButton("back", "back", "All templates", t, (_e, cx) => { this.back(); cx.notify(); }) : null,
        lead.mark ? image(`mods/${MOD}/mark.svg`).w(18).h(18).flex_none() : null].filter(Boolean))
      .child(div().min_w(0).truncate().text_size(S().title).font_semibold().child(lead.title))
      .children(lead.pills ?? [])
      .child(div().flex_1())
      .children(actions)
      .when(Boolean(node), (el) => el.child(iconButton("close", "close", "Hide", t, () => run("layout.hide", { id: PANEL }))));
  }

  noticeLine(t) {
    if (!this.notice) return null;
    const c = this.notice.kind === "error" ? t.ansi1 : t.muted;
    return div().flex_1().min_w(0).truncate().text_size(S().small).text_color(c).child(this.notice.text);
  }

  renderList(t, node) {
    const s = this.state, entries = s?.entries ?? [];
    const where = s?.sourceDir ? `${tilde(templatesDir(), home())} → ${tilde(s.sourceDir, home())}` : tilde(templatesDir(), home());
    const rows = entries.map((e) => {
      const model = modelOf(field(e.parsed, "command")), program = programOf(field(e.parsed, "command"));
      const desc = field(e.parsed, "description");
      return h_flex().id(`row-${e.name}`).px(10).py(8).mx(6).gap(10).items_start().rounded(8).cursor_pointer()
        .hover((st) => st.bg(t.hover)).on_click((_ev, cx) => { this.open(e.name); cx.notify(); })
        .child(v_flex().flex_1().min_w(0).gap(3)
          .child(h_flex().gap(6).items_center().min_w(0)
            .child(div().min_w(0).truncate().font_semibold().child(e.name))
            .children([e.broken ? pill("broken link", t, t.ansi1) : null,
              program ? pill(program, t) : null, model ? pill(model, t, t.accent) : null,
              e.link ? icon("link", 11, t.dim) : null].filter(Boolean)))
          .child(div().max_h(36).overflow_hidden().text_size(S().small).text_color(desc ? t.muted : t.dim).child(desc || "No description")))
        .child(iconButton(`run-${e.name}`, "play", localSpace() ? `Run ${e.name} in a new tab` : "Show a space on this computer to run", t,
          () => openDialog({ role: "run", name: e.name }, 520, 420), { disabled: !localSpace() || e.broken, color: t.ansi2, icon: 12 }));
    });
    return v_flex().size_full().min_h(0)
      .child(this.header(t, node, { mark: true, title: "Templates", pills: s ? [pill(String(entries.length), t)] : [] },
        [iconButton("reload", "reload", "Reload", t, (_e, cx) => cx.spawn(async (cx) => this.reload(cx))),
          button("new", "New", t, () => openDialog({ role: "create", mode: "new" }, 460, 300), { icon: "plus" })]))
      .child(div().flex_none().px(14).py(6).truncate().text_size(S().tiny).text_color(t.dim).child(where))
      .child(this.error
        ? v_flex().p(14).gap(6).child(div().text_color(t.ansi1).child("Couldn't read the templates folder")).child(div().text_size(S().small).text_color(t.muted).child(this.error))
        : !s ? div().p(14).text_color(t.dim).child("Loading…")
        : entries.length === 0
          ? v_flex().p(14).gap(10).child(div().text_color(t.muted).child("No templates yet. A template is a role hc can start an agent as: hc run <name> \"task\"."))
            .child(h_flex().child(button("new-empty", "New template", t, () => openDialog({ role: "create", mode: "new" }, 460, 300), { kind: "solid", icon: "plus" })))
          : v_flex().id("rows").flex_1().min_h(0).py(4).gap(2).overflow_y_scrollbar().children(rows))
      .child(h_flex().h(34).flex_none().px(14).items_center().border_t(1).border_color(t.border)
        .child(this.noticeLine(t) ?? div().flex_1().text_size(S().small).text_color(t.dim).child(s?.skillshare && s?.sourceDir ? "Linked with skillshare: changes go to your source" : "Click a template to view or edit it")));
  }

  renderDetail(t, entry, node) {
    const f = this.form, dirty = this.dirty(), v = this.values();
    const model = modelOf(v.command);
    const nameErr = v.name !== entry.name ? nameProblem(v.name, this.state.entries.map((x) => x.name), entry.name) : null;
    const local = Boolean(localSpace());
    const actions = [
      iconButton("d-run", "play", local ? "Run in a new tab" : "Show a space on this computer to run", t,
        () => openDialog({ role: "run", name: entry.name }, 520, 420), { disabled: !local || entry.broken, color: t.ansi2, icon: 12 }),
      iconButton("d-copy", "copy", "Duplicate", t, () => openDialog({ role: "create", mode: "copy", from: entry.name }, 460, 240)),
      iconButton("d-edit", "edit", local && focused()?.pane ? "Open the file in $EDITOR beside your terminal" : "Show a space on this computer to open it", t,
        () => this.editorPane(entry), { disabled: !local || !focused()?.pane }),
      iconButton("d-remove", "trash", "Remove", t, () => openDialog({ role: "remove", name: entry.name }, 460, 240), { color: t.ansi1 }),
    ];
    return v_flex().size_full().min_h(0)
      .child(this.header(t, node, { back: true, title: entry.name,
        pills: [model ? pill(model, t, t.accent) : null, entry.link ? icon("link", 12, t.dim) : null].filter(Boolean) }, actions))
      .child(div().flex_none().px(14).py(6).truncate().text_size(S().tiny).text_color(t.dim).child(tilde(entry.real ?? entry.path, home())))
      .children([this.stale ? h_flex().mx(14).mb(6).px(10).py(6).gap(8).items_center().rounded(7).bg(t.selected)
        .child(div().flex_1().text_size(S().small).child("This template changed on disk."))
        .child(button("stale-reload", "Load it", t, (_e, cx) => { const e = this.entry(); if (e) this.fill(e); cx.notify(); })) : null].filter(Boolean))
      .child(v_flex().flex_1().min_h(0).px(14).pb(10).gap(6)
        .child(label("Name", t)).child(inputBox("f-name", f.name, t, { error: Boolean(nameErr) }))
        .children([nameErr ? div().text_size(S().tiny).text_color(t.ansi1).child(nameErr) : null].filter(Boolean))
        .child(label("Description", t)).child(inputBox("f-desc", f.description, t, { size: S().small }))
        .child(label("Command", t)).child(inputBox("f-cmd", f.command, t, { mono: true, size: S().small }))
        .child(h_flex().pt(4).items_center().child(label("Instructions", t)).child(div().flex_1())
          .child(div().text_size(S().tiny).text_color(t.dim).child("sent before the task")))
        .child(div().id("f-body").flex_1().min_h(120).flex().rounded(7).border_1().border_color(t.border).bg(t.surface).overflow_hidden()
          .on_mouse_down("left", stop).child(Editor.new(f.body).flex_1().min_h(0))))
      .child(h_flex().h(46).flex_none().px(14).gap(8).items_center().border_t(1).border_color(t.border)
        .child(this.noticeLine(t) ?? div().flex_1().text_size(S().small).text_color(t.dim).child(dirty ? "Unsaved changes" : ""))
        .child(button("revert", "Revert", t, (_e, cx) => { this.fill(entry); cx.notify(); }, { disabled: !dirty || this.busy }))
        .child(button("save", this.busy ? "Saving…" : "Save", t, (_e, cx) => cx.spawn(async (cx) => this.saveForm(cx)), { kind: "solid", disabled: !dirty || this.busy || Boolean(nameErr) })));
  }

  // ---- Dialogs ----

  initDialog(cx) {
    const p = blockProps();
    this.busy = false; this.err = null;
    if (p.role === "create") {
      this.nameIn = InputState.new({ placeholder: "name, e.g. doc-writer", value: p.mode === "copy" ? `${p.from}-copy` : "" });
      this.descIn = InputState.new({ placeholder: "What it does and what to give it" });
      for (const input of [this.nameIn, this.descIn]) input.on("submit", (_e, cx) => { if (!this.busy) cx.spawn(async (cx) => this.doCreate(cx)); });
      if (!checking()) later(cx, () => this.nameIn.focus());
      // A copy's free name needs the folder; it replaces the first guess once read.
      if (p.mode === "copy" && !checking()) cx.spawn(async (cx) => {
        const s = await load().catch(() => null);
        if (s) { this.nameIn.set_value(copyName(p.from, s.entries.map((e) => e.name))); cx.notify(); }
      });
    }
    if (p.role === "run") {
      this.folderIn = InputState.new({ value: startFolder() });
      this.taskIn = TextareaState.new({ placeholder: "The task (optional): what to do, files it owns, where to report", rows: 7 });
      if (!checking()) later(cx, () => this.taskIn.focus());
    }
  }

  close() { closeOverlay(blockProps().overlay); }

  async doCreate(cx) {
    const p = blockProps(), name = this.nameIn.value().trim();
    this.busy = true; this.err = null; cx.notify();
    try {
      const s = await load(), taken = s.entries.map((e) => e.name);
      const problem = nameProblem(name, taken);
      if (problem) throw new Error(problem);
      let text;
      if (p.mode === "copy") {
        const from = s.entries.find((e) => e.name === p.from);
        if (!from) throw new Error(`${p.from} is gone`);
        text = serializeTemplate(from.parsed, { name, description: field(from.parsed, "description"), command: field(from.parsed, "command") }, from.parsed.body);
      } else text = starterText(name, oneLine(this.descIn.value()));
      await create(s, name, text);
      setShared(CHANGED, { at: Date.now(), select: name });
      this.close();
    } catch (e) { this.err = message(e); this.busy = false; cx.notify(); }
  }

  async doRemove(cx) {
    const p = blockProps();
    this.busy = true; this.err = null; cx.notify();
    try {
      const s = await load(), e = s.entries.find((x) => x.name === p.name);
      if (e) await remove(e);
      setShared(CHANGED, { at: Date.now(), select: null });
      this.close();
    } catch (e) { this.err = message(e); this.busy = false; cx.notify(); }
  }

  async doRun(cx) {
    const p = blockProps(), space = localSpace();
    if (!space) { this.err = "Show a space on this computer first"; return cx.notify(); }
    this.busy = true; this.err = null; cx.notify();
    try {
      await launch(cx, p.name, space.id, this.folderIn.value().trim() || null, this.taskIn.value().trim());
      this.close();
    } catch (e) { this.err = message(e); this.busy = false; cx.notify(); }
  }

  dialog(t, title, sub, body, buttons) {
    return v_flex().size_full().min_h(0).text_size(S().body).text_color(t.foreground)
      .child(v_flex().px(18).pt(16).pb(10).gap(3).flex_none()
        .child(div().text_size(S().title + 1).font_semibold().child(title))
        .children([sub ? div().text_size(S().small).text_color(t.muted).child(sub) : null].filter(Boolean)))
      .child(v_flex().flex_1().min_h(0).px(18).gap(8).children(body.filter(Boolean)))
      .child(h_flex().h(54).flex_none().px(18).gap(8).items_center()
        .child(this.err ? div().flex_1().min_w(0).text_size(S().small).text_color(t.ansi1).child(this.err) : div().flex_1())
        .children(buttons));
  }

  renderDialog(_cx) {
    const t = theme(), p = blockProps();
    const cancel = button("cancel", "Cancel", t, () => this.close(), { disabled: this.busy });
    if (p.role === "create") {
      const copy = p.mode === "copy";
      const go = (_e, cx) => cx.spawn(async (cx) => this.doCreate(cx));
      return this.dialog(t, copy ? `Duplicate ${p.from}` : "New template",
        copy ? "Same command and instructions under a new name." : "Starts with a skeleton you fill in. The name is what you pass to hc run.",
        [label("Name", t), inputBox("c-name", this.nameIn, t),
          copy ? null : label("Description", t), copy ? null : inputBox("c-desc", this.descIn, t, { size: S().small })],
        [cancel, button("create", this.busy ? "Creating…" : copy ? "Duplicate" : "Create", t, go, { kind: "solid", disabled: this.busy })]);
    }
    if (p.role === "remove") {
      const go = (_e, cx) => cx.spawn(async (cx) => this.doRemove(cx));
      return this.dialog(t, `Remove ${p.name}?`, null,
        [div().text_size(S().small).text_color(t.muted).child(`This deletes ${p.name}.md. When it is a link, the file it points to is deleted too, so it won't come back on the next sync. It can't be undone here.`)],
        [cancel, button("remove", this.busy ? "Removing…" : "Remove", t, go, { kind: "danger", disabled: this.busy })]);
    }
    if (p.role === "run") {
      const go = (_e, cx) => cx.spawn(async (cx) => this.doRun(cx));
      return this.dialog(t, `Run ${p.name}`, "Starts it as an agent in a new tab of the shown space. hc sends the template's instructions, then your task.",
        [label("Folder", t), inputBox("r-folder", this.folderIn, t, { mono: true, size: S().small }),
          label("Task", t),
          div().id("r-task").flex_1().min_h(80).p(8).rounded(7).border_1().border_color(t.border).bg(t.background).cursor_text().on_mouse_down("left", stop)
            .child(Textarea.new(this.taskIn).size_full().text_size(S().small).text_color(t.foreground))],
        [cancel, button("run", this.busy ? "Starting…" : "Run", t, go, { kind: "solid", icon: "play", disabled: this.busy || !localSpace() })]);
    }
    return div();
  }
}
