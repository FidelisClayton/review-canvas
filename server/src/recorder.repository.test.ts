import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { knownCleanWorktree } from "@review-canvas/shared";
import { recordExecution } from "./recorder.js";

it("records .github origin identity and clean provenance from the actual repository", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "recorder-repository-"));
  try {
    const git = (...args: string[]) => execFileSync("git", args, {cwd, encoding: "utf8"}).trim();
    git("init", "-q"); git("config", "user.name", "Synthetic"); git("config", "user.email", "synthetic@example.test");
    git("remote", "add", "origin", "git@github.com:synthetic/.github.git");
    await writeFile(join(cwd, ".gitignore"), "manifest.json\nbundle.json\n");
    git("add", ".gitignore"); git("commit", "-qm", "Seed synthetic repository");
    const manifestPath = join(cwd, "manifest.json"); const outPath = join(cwd, "bundle.json");
    await writeFile(manifestPath, JSON.stringify({version: 1, scenario: {id: "retry", version: "1", title: "Retry"}, inputs: {}, environment: {}, goalIds: [], sourceRefs: []}));
    const target = {owner: "synthetic", repo: ".github", number: 1};
    const bundle = await recordExecution({cwd, target, manifestPath, outPath, argv: [process.execPath, "-e", "console.log('REVIEW_CANVAS_EVENT '+JSON.stringify({id:'output',kind:'output',title:'Output',value:42,sourceRefs:[]}))"]});
    expect(bundle.provenance.repository).toEqual({owner: target.owner, repo: target.repo});
    expect(bundle.provenance.revision).toBe(git("rev-parse", "HEAD"));
    expect(knownCleanWorktree(bundle.provenance)).toBe(true);
    expect(bundle.capture.status).toBe("complete");
    expect(JSON.parse(await readFile(outPath, "utf8"))).toEqual(bundle);
  } finally { await rm(cwd, {recursive: true, force: true}); }
});
