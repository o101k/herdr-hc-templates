// The templates folder on this computer: read it, change it, start a template.
//
// A template may be a plain file or a symlink (skillshare links its source this way). Herdr's
// writeTextFile replaces a file atomically, which would turn a link into a plain file, so every
// write goes to the link's target. New templates go next to the existing targets, and are linked
// with `skillshare sync extras` when skillshare is installed, else with `ln -s`.
import { exec, hc, home, readTextFile, writeTextFile } from "herdr";
import { parseTemplate, parseListing, sourceDirOf, dirname } from "./model.js";

export const templatesDir = () => `${home()}/.config/herdr-core/templates`;

const PATHS = 'PATH="$HOME/.local/bin:$HOME/go/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"; export PATH';
async function sh(script, args = [], timeout = 30000) {
  const r = await exec("sh", ["-c", `${PATHS}\n${script}`, "hc-templates", ...args], { timeout });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || `exit ${r.code}`).trim().split("\n").pop());
  return r.stdout;
}

const LIST = `d="$1"
if [ -d "$d" ]; then
  for f in "$d"/*.md; do
    if [ -L "$f" ]; then
      r=$(realpath "$f" 2>/dev/null || readlink -f "$f" 2>/dev/null || true)
      printf 'L\\t%s\\t%s\\n' "$f" "$r"
    elif [ -f "$f" ]; then
      printf 'F\\t%s\\t%s\\n' "$f" "$f"
    fi
  done
fi
command -v skillshare >/dev/null 2>&1 && echo S
true`;

// { entries: [{ name, path, link, real, text, parsed, broken }], skillshare, sourceDir }.
export async function load() {
  const { entries, skillshare } = parseListing(await sh(LIST, [templatesDir()]));
  await Promise.all(entries.map(async (e) => {
    const text = e.real ? await readTextFile(e.real).catch(() => null) : null;
    e.broken = text === null;
    e.text = text ?? "";
    e.parsed = parseTemplate(e.text);
  }));
  return { entries, skillshare, sourceDir: sourceDirOf(entries) };
}

// Saves new text over a template, only if the file still holds what was loaded.
export async function save(entry, text) {
  await writeTextFile(entry.real, text, entry.text);
}

// Puts `<templates>/<name>.md` in place for a file written at `real` outside the folder.
async function link(state, real, name) {
  const at = `${templatesDir()}/${name}.md`;
  if (state.skillshare) await sh("skillshare sync extras", [], 60000).catch(() => null);
  await sh('[ -e "$2" ] || [ -L "$2" ] || ln -s "$1" "$2"', [real, at]);
}

// Writes a new template and makes hc see it. Returns its name.
export async function create(state, name, text) {
  const dir = state.sourceDir ?? templatesDir();
  const real = `${dir}/${name}.md`;
  await sh('mkdir -p "$1" "$2"', [dir, templatesDir()]);
  await writeTextFile(real, text, null);
  if (state.sourceDir) await link(state, real, name);
  return name;
}

// Moves a template to a new name with new text: writes the new file, removes the old file and
// link, then links the new one. The old file goes before linking, or skillshare's sync would
// link it again.
export async function rename(state, entry, name, text) {
  const now = await readTextFile(entry.real);
  if (now !== entry.text) throw new Error("It changed on disk; reload it first");
  const real = `${dirname(entry.real)}/${name}.md`;
  await writeTextFile(real, text, null);
  await remove(entry);
  if (entry.link) await link({ ...state, sourceDir: dirname(entry.real) }, real, name);
  return name;
}

// Deletes the template: the link and the file it points to, or the plain file.
export async function remove(entry) {
  await sh('rm -f -- "$1"; [ -z "$2" ] || [ "$2" = "$1" ] || rm -f -- "$2"', [entry.path, entry.real ?? ""]);
}

// Starts a template as an agent in a new tab of a space on this computer. hc delivers the
// template's instructions and the task as its first message, waiting for the agent to be ready.
// A terminal with Herdr labels for a tab Herdr doesn't know yet becomes a new tab.
export async function start(name, { space, cwd, task }) {
  const tab = `tb${Date.now().toString(16)}${Math.floor(Math.random() * 0xffffff).toString(16)}`;
  const args = ["run", "--bg", "--keep", "--json", "--label", `herdr.space=${space}`, "--label", `herdr.tab=${tab}`];
  if (cwd) args.push("--cwd", cwd);
  args.push(name);
  if (task) args.push(task);
  const r = await hc(args);
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* reported below */ }
  if (r.code !== 0 || !out?.address) {
    let msg = (r.stderr || r.stdout || `hc exited ${r.code}`).trim();
    try { msg = JSON.parse(r.stderr).error?.message ?? msg; } catch { /* plain text */ }
    throw new Error(msg.split("\n").pop());
  }
  return { tab, address: out.address, sent: out.first_message?.sent ?? null, reason: out.first_message?.reason ?? null };
}
