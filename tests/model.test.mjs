import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { parseTemplate, serializeTemplate, field, modelOf, programOf, nameProblem, commandProblem, copyName, starterText, sourceDirOf, parseListing } from "../mods/hc-templates/model.js";

const SAMPLE = `---
name: reviewer
description: Read-only review: spec first, then "quality".
command: claude --model opus --permission-mode auto
color: blue
---
You are a reviewer.

## Your task
`;

test("parses frontmatter and body", () => {
  const p = parseTemplate(SAMPLE);
  assert.equal(p.hasFrontmatter, true);
  assert.equal(field(p, "name"), "reviewer");
  assert.equal(field(p, "description"), 'Read-only review: spec first, then "quality".');
  assert.equal(field(p, "command"), "claude --model opus --permission-mode auto");
  assert.equal(p.body, "You are a reviewer.\n\n## Your task\n");
});

test("round-trips unchanged values byte for byte", () => {
  const p = parseTemplate(SAMPLE);
  const v = { name: field(p, "name"), description: field(p, "description"), command: field(p, "command") };
  assert.equal(serializeTemplate(p, v, p.body), SAMPLE);
});

test("round-trips every template in a folder given as TEMPLATES_DIR", { skip: !process.env.TEMPLATES_DIR }, () => {
  const dir = process.env.TEMPLATES_DIR;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".md"))) {
    const text = readFileSync(`${dir}/${f}`, "utf8"), p = parseTemplate(text);
    const v = { name: field(p, "name"), description: field(p, "description"), command: field(p, "command") };
    assert.equal(serializeTemplate(p, v, p.body), text, f);
  }
});

test("keeps unknown keys and order, flattens new lines", () => {
  const p = parseTemplate(SAMPLE);
  const out = serializeTemplate(p, { name: "rev", description: "two\nlines", command: "pi" }, "Body");
  assert.equal(out, "---\nname: rev\ndescription: two lines\ncommand: pi\ncolor: blue\n---\nBody");
});

test("adds missing frontmatter", () => {
  const p = parseTemplate("Just a body\n");
  assert.equal(p.hasFrontmatter, false);
  assert.equal(serializeTemplate(p, { name: "x", description: "", command: "claude" }, p.body), "---\nname: x\ncommand: claude\n---\nJust a body\n");
});

test("reads model and program from a command", () => {
  assert.equal(modelOf("claude --model sonnet --permission-mode auto"), "sonnet");
  assert.equal(modelOf("pi --model=gpt-6 --x"), "gpt-6");
  assert.equal(modelOf("codex --no-daemon"), null);
  assert.equal(programOf("/usr/local/bin/claude --model x"), "claude");
});

test("validates names", () => {
  assert.equal(nameProblem("re-reviewer", []), null);
  assert.match(nameProblem("", []), /name/);
  assert.match(nameProblem("a b", []), /letters/);
  assert.match(nameProblem("x.md", []), /\.md/);
  assert.match(nameProblem("Reviewer", ["reviewer"]), /exists/);
  assert.equal(nameProblem("reviewer", ["reviewer"], "reviewer"), null);
  assert.match(commandProblem("  "), /command/);
});

test("finds a free copy name", () => {
  assert.equal(copyName("reviewer", ["reviewer"]), "reviewer-copy");
  assert.equal(copyName("reviewer", ["reviewer", "reviewer-copy", "reviewer-copy-2"]), "reviewer-copy-3");
});

test("starter text is a valid template", () => {
  const p = parseTemplate(starterText("doc-writer", "Writes docs"));
  assert.equal(field(p, "name"), "doc-writer");
  assert.equal(field(p, "description"), "Writes docs");
  assert.match(field(p, "command"), /^claude /);
  assert.match(p.body, /## Your task\n$/);
});

test("parses the listing and picks the source dir", () => {
  const { entries, skillshare } = parseListing("L\t/t/b.md\t/src/b.md\nF\t/t/a.md\t/t/a.md\nL\t/t/c.md\t/src/c.md\nS\n");
  assert.equal(skillshare, true);
  assert.deepEqual(entries.map((e) => [e.name, e.link]), [["a", false], ["b", true], ["c", true]]);
  assert.equal(sourceDirOf(entries), "/src");
  assert.equal(sourceDirOf(entries.filter((e) => !e.link)), null);
});
