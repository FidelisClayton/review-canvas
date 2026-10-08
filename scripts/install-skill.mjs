#!/usr/bin/env node
// Installs the review-canvas skill and CLI for this user:
//   ~/.agents/skills/review-canvas  -> <repo>/skills/review-canvas
//   ~/.claude/skills/review-canvas  -> ~/.agents/skills/review-canvas   (Claude Code)
//   ~/.codex/skills/review-canvas   -> ~/.agents/skills/review-canvas   (Codex)
//   ~/.local/bin/review-canvas      -> <repo>/bin/review-canvas
// Existing links are replaced; existing real files or directories are left alone.
import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const home = homedir();
const links = [
  [join(home, ".agents/skills/review-canvas"), join(repo, "skills/review-canvas")],
  [join(home, ".claude/skills/review-canvas"), join(home, ".agents/skills/review-canvas")],
  [join(home, ".codex/skills/review-canvas"), join(home, ".agents/skills/review-canvas")],
  [join(home, ".local/bin/review-canvas"), join(repo, "bin/review-canvas")],
];

for (const [path, target] of links) {
  mkdirSync(dirname(path), { recursive: true });
  let stat = null;
  try {
    stat = lstatSync(path);
  } catch {}
  if (stat && !stat.isSymbolicLink()) {
    console.log(`skip  ${path} (exists and is not a link)`);
    continue;
  }
  if (stat && readlinkSync(path) === target) {
    console.log(`ok    ${path}`);
    continue;
  }
  if (stat) rmSync(path);
  symlinkSync(target, path);
  console.log(`link  ${path} -> ${target}`);
}
if (!existsSync(join(repo, "server/dist/cli.js"))) console.log("\nRun `npm run build` before using the CLI.");
