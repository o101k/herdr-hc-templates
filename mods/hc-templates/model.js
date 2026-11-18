// What an hc template is, as text. No Herdr imports, so the tests run it under plain Node.
//
// A template is `<templates>/<name>.md`: frontmatter (`name`, `description`, `command`) between
// `---` lines, then the instructions hc puts before the task in the agent's first message.
// hc keys a template by its file name, not the `name` field, and reads each value as the raw
// text after `key:` (quotes are kept as typed), so values are written plain, on one line.

export const KNOWN = ["name", "description", "command"];
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// { fields: [[key, value]...] in file order (unknown keys kept), body, hasFrontmatter }.
export function parseTemplate(text) {
  const src = String(text ?? "").replace(/^﻿/, "");
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(src);
  if (!m) return { fields: [], body: src, hasFrontmatter: false };
  const fields = [];
  for (const line of m[1].split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at <= 0) { fields.push([null, line]); continue; } // kept verbatim on write
    fields.push([line.slice(0, at).trim(), line.slice(at + 1).trim()]);
  }
  return { fields, body: src.slice(m[0].length), hasFrontmatter: true };
}

export const field = (parsed, key) => parsed.fields.find(([k]) => k === key)?.[1] ?? "";

// The template's text with `values` ({ name, description, command }) set and every other line kept.
export function serializeTemplate(parsed, values, body) {
  const fields = parsed.fields.map(([k, v]) => [k, v]);
  for (const key of KNOWN) {
    const v = oneLine(values[key] ?? "");
    const i = fields.findIndex(([k]) => k === key);
    if (i >= 0) fields[i][1] = v;
    else if (v) fields.splice(KNOWN.indexOf(key), 0, [key, v]);
  }
  const head = fields.map(([k, v]) => (k === null ? v : v ? `${k}: ${v}` : `${k}:`)).join("\n");
  return `---\n${head}\n---\n${body ?? ""}`;
}

export const oneLine = (s) => String(s ?? "").replace(/[\r\n]+/g, " ").trim();

// The model a command asks for: `--model sonnet` or `--model=sonnet`.
export function modelOf(command) {
  const m = /(?:^|\s)--model(?:=|\s+)(\S+)/.exec(command ?? "");
  return m ? m[1] : null;
}

// The program a command starts: its first word, without a path.
export function programOf(command) {
  const first = String(command ?? "").trim().split(/\s+/)[0] ?? "";
  return first.split("/").pop() || null;
}

// An error message, or null when `name` can be a template file name.
export function nameProblem(name, taken = [], current = null) {
  const n = String(name ?? "").trim();
  if (!n) return "Give it a name";
  if (n.toLowerCase().endsWith(".md")) return "Leave out .md";
  if (!NAME.test(n)) return "Use letters, digits, dot, dash or underscore, starting with a letter or digit";
  if (n.length > 64) return "Keep it to 64 characters";
  if (n !== current && taken.some((t) => t.toLowerCase() === n.toLowerCase())) return `${n} already exists`;
  return null;
}

export function commandProblem(command) {
  return oneLine(command) ? null : "Give it the command that starts the agent";
}

// A free name for a copy: reviewer-copy, reviewer-copy-2, ...
export function copyName(name, taken) {
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  let n = `${name}-copy`;
  for (let i = 2; lower.has(n.toLowerCase()); i++) n = `${name}-copy-${i}`;
  return n;
}

// A new template's text: a starting point shaped like the shipped roles.
export function starterText(name, description = "", command = "claude --model sonnet --permission-mode auto") {
  return serializeTemplate({ fields: [] }, { name, description, command }, [
    `You are a ${name}, started by a lead agent through herdr-core (\`hc\`).`,
    "",
    "## How to work",
    "",
    "- ",
    "",
    "## Reporting",
    "",
    "- Your lead is the `parent` field of `hc get $HC_TERMINAL_ID --json`, unless the task names another terminal.",
    '- Send `hc send <lead> "<the outcome in 1-3 lines, report path>"` when you\'re done or stuck.',
    "",
    "## Your task",
    "",
  ].join("\n"));
}

// The directory most links point into: where new templates go when the folder is made of links.
export function sourceDirOf(entries) {
  const counts = new Map();
  for (const e of entries) {
    if (!e.link || !e.real) continue;
    const d = dirname(e.real);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let best = null, n = 0;
  for (const [d, c] of counts) if (c > n) { best = d; n = c; }
  return best;
}

export const dirname = (p) => String(p).replace(/\/[^/]*$/, "") || "/";
export const basename = (p) => String(p).split("/").pop();

// `ls`-style lines from the listing script: "L\t<path>\t<real>", "F\t<path>\t<path>", "S".
export function parseListing(stdout) {
  const entries = [];
  let skillshare = false;
  for (const line of String(stdout ?? "").split("\n")) {
    if (line === "S") { skillshare = true; continue; }
    const [kind, path, real] = line.split("\t");
    if ((kind !== "L" && kind !== "F") || !path) continue;
    entries.push({ name: basename(path).replace(/\.md$/, ""), path, link: kind === "L", real: real || null });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { entries, skillshare };
}

// A short home-relative path for display.
export const tilde = (p, home) => (home && String(p).startsWith(home + "/") ? `~${String(p).slice(home.length)}` : String(p));
