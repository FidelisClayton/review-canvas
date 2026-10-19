import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAnalysis, draftReview, emptyState, type GhFile, type GhPull, type RevisionTreeEntry } from "@review-canvas/shared";
import { getRevisionFile, getRevisions } from "./revisions.js";
import { loadState, reviewPath, saveAnalysis, saveReview, saveState } from "./store.js";
import { pathDigest } from "./evidenceStore.js";
import { fetchExactTree, type GitHubReadTransport } from "./github.js";
const fixture = JSON.parse(readFileSync(new URL("../../test/fixtures/sync-retries.json", import.meta.url), "utf8")) as {pull: GhPull; files: GhFile[]};
const current = buildAnalysis(fixture.pull, fixture.files, {}, new Date("2026-10-19T12:00:00Z"));
const before = "b".repeat(40); const after = current.pr.headSha;
let home: string; let previousHome: string | undefined;
beforeEach(() => { previousHome = process.env.REVIEW_CANVAS_HOME; home = mkdtempSync(join(tmpdir(), "revisions-test-")); process.env.REVIEW_CANVAS_HOME = home; saveAnalysis(current); });
afterEach(() => { if (previousHome === undefined) delete process.env.REVIEW_CANVAS_HOME; else process.env.REVIEW_CANVAS_HOME = previousHome; rmSync(home, {recursive: true, force: true}); });
function baseline(id = "prior", owner = current.pr.owner, at = "2026-10-19T10:00:00Z") {
  const analysis = {...current, id, createdAt: "2026-10-19T09:00:00Z", pr: {...current.pr, owner, headSha: before}}; saveAnalysis(analysis);
  const review = draftReview(analysis); review.course.goals = [{id: "reviewed", title: "Reviewed", src: "PR", quote: "Reviewed", stops: []}]; saveReview(review); saveState(id, {...emptyState(), reviewed: {reviewed: at}});
}
const entry = (path: string, sha: string, mode = "100644", type = "blob"): RevisionTreeEntry => ({path, sha: /^[a-f0-9]{40}$/.test(sha) ? sha : createHash("sha1").update(sha).digest("hex"), mode, type});
function transport(left: RevisionTreeEntry[], right: RevisionTreeEntry[], readFile: GitHubReadTransport["readFile"] = async (_ref, sha) => sha === before ? "old\n" : "new\n") {
  return {readTree: vi.fn(async (_ref: unknown, sha: string) => ({tree: sha === before ? left : right, truncated: false})), readFile: vi.fn(readFile)};
}
describe("exact revision inventory", () => {
  it("selects latest eligible full-repository/PR baseline without carrying state", async () => {
    baseline("prior"); baseline("latest", current.pr.owner, "2026-10-19T11:00:00Z"); baseline("foreign", "other", "2026-10-19T11:59:00Z"); baseline("future", current.pr.owner, "2026-10-19T13:00:00Z");
    const state = loadState(current.id); const result = await getRevisions(current.id, undefined, transport([], []));
    expect(result.baseline?.reviewId).toBe("latest"); expect(result.alternatives.map(b => b.reviewId)).toEqual(["latest", "prior"]);
    expect((await getRevisions(current.id, "foreign", transport([], []))).comparison).toBeNull(); expect(loadState(current.id)).toEqual(state);
  });
  it("preserves more than 300 endpoint changes including mode, type, removed and renamed paths", async () => {
    baseline(); const left = [entry("old-name", "1"), entry("mode", "2"), entry("submodule", "3", "160000", "commit")];
    const right = [entry("new-name", "1"), entry("mode", "2", "100755"), entry("submodule", "4", "160000", "commit"), ...Array.from({length: 301}, (_, i) => entry(`new/${i}`, `${i}`))];
    const io = transport(left, right); const result = await getRevisions(current.id, undefined, io);
    expect(result.comparison).toMatchObject({beforeSha: before, afterSha: after, status: "available"}); expect(result.comparison?.files).toHaveLength(305);
    expect(result.comparison?.files.find(f => f.path === "old-name")?.status).toBe("removed"); expect(result.comparison?.files.find(f => f.path === "mode")?.status).toBe("modified");
    await getRevisions(current.id, undefined, io); expect(io.readTree).toHaveBeenCalledTimes(2);
  });
  it("falls back to nonrecursive subtree traversal when recursive response truncates", async () => {
    const readTree = vi.fn(async (_ref: unknown, sha: string, recursive: boolean) => recursive ? {truncated: true, tree: []} : sha === after ? {truncated: false, tree: [entry("dir", "d", "040000", "tree"), entry("root", "r")]} : {truncated: false, tree: [entry("nested", "n")]});
    expect(await fetchExactTree(current.pr, after, {readTree})).toEqual([entry("dir/nested", "n"), entry("root", "r")]);
    expect(readTree.mock.calls.map(c => [c[1], c[2]])).toEqual([[after, true], [after, false], [entry("dir", "d").sha, false]]);
  });
  it("reports failed trees unavailable with endpoints intact, never as empty changes", async () => {
    baseline(); const result = await getRevisions(current.id, undefined, {readTree: async () => {throw new Error("missing object");}, readFile: async () => ""});
    expect(result.comparison).toMatchObject({status: "unavailable", beforeSha: before, afterSha: after, unavailableReason: expect.stringContaining("missing object")});
  });
});
describe("lazy exact endpoint patches", () => {
  it("accepts git diff exit 1, parses lines, and restricts paths to the inventory", async () => {
    baseline(); const io = transport([entry("app/file.ts", "1")], [entry("app/file.ts", "2")]);
    const result = await getRevisionFile(current.id, "prior", "app/file.ts", io);
    expect(result.patch).toContain("-old\n+new"); expect(result.file?.hunks[0]?.lines).toEqual([expect.objectContaining({kind: "del", text: "old"}), expect.objectContaining({kind: "add", text: "new"})]);
    expect(io.readFile.mock.calls.map(c => c[1])).toEqual([before, after]);
    await expect(getRevisionFile(current.id, "prior", "../secret", io)).rejects.toThrow(); await expect(getRevisionFile(current.id, "prior", "other", io)).rejects.toThrow();
    await expect(getRevisionFile(current.id, "foreign", "app/file.ts", io)).rejects.toThrow();
  });
  it("keeps metadata for binary, submodule, oversized and unavailable text", async () => {
    baseline();
    const paths = ["binary", "large", "sub", "missing"];
    const left = paths.map(path => entry(path, "1", path === "sub" ? "160000" : "100644", path === "sub" ? "commit" : "blob"));
    const right = paths.map(path => entry(path, "2", path === "sub" ? "160000" : "100644", path === "sub" ? "commit" : "blob"));
    for (const [path, value, reason] of [["binary", "a\0b", /binary/i], ["large", "x".repeat(1024*1024+1), /limit|large/i]] as const) {
      const result = await getRevisionFile(current.id, "prior", path, transport(left, right, vi.fn(async () => value)));
      expect(result.patch).toBeNull(); expect(result.change.path).toBe(path); expect(result.unavailableReason).toMatch(reason);
    }
    const sub = await getRevisionFile(current.id, "prior", "sub", transport(left, right)); expect(sub.unavailableReason).toMatch(/submodule/i);
    const missing = await getRevisionFile(current.id, "prior", "missing", transport(left, right, vi.fn(async () => {throw new Error("missing object");}))); expect(missing.unavailableReason).toContain("missing object");
  });
  it("does not present dereferenced symlink target contents as the symlink blob", async () => {
    baseline(); const readFile = vi.fn(async () => "target file contents\n");
    const io = transport([entry("link", "1", "120000")], [entry("link", "2", "120000")], readFile);
    const result = await getRevisionFile(current.id, "prior", "link", io);
    expect(result.change).toMatchObject({path: "link", status: "modified", before: {mode: "120000"}, after: {mode: "120000"}});
    expect(result.patch).toBeNull(); expect(result.unavailableReason).toMatch(/symbolic|symlink/i); expect(readFile).not.toHaveBeenCalled();
  });
  it("handles removed files using only the existing side", async () => {
    baseline(); const io = transport([entry("removed", "1")], []); const result = await getRevisionFile(current.id, "prior", "removed", io);
    expect(result.change.status).toBe("removed"); expect(result.file?.hunks[0]?.lines[0]?.kind).toBe("del"); expect(io.readFile).toHaveBeenCalledTimes(1);
  });
});


describe("revision cache integrity", () => {
  const offline: GitHubReadTransport = {readTree: vi.fn(async () => {throw new Error("Unexpected network tree read");}), readFile: vi.fn(async () => {throw new Error("Unexpected network file read");})};
  const cachedPath = (file: string) => reviewPath(current.id, `revisions/${before}-${after}/${file}`);
  it("reports malformed inventory entries unavailable instead of publishing a false exact inventory", async () => {
    baseline(); const io = transport([entry("code.ts", "1")], [entry("code.ts", "2")]);
    await getRevisions(current.id, "prior", io);
    const valid = JSON.parse(readFileSync(cachedPath("inventory.json"), "utf8")) as {beforeSha: string; afterSha: string; files: unknown[]};
    expect((await getRevisions(current.id, "prior", offline)).comparison?.status).toBe("available");
    const beforeEntry = entry("code.ts", "1"); const afterEntry = entry("code.ts", "2");
    const change = {path: "code.ts", status: "modified", before: beforeEntry, after: afterEntry};
    for (const files of [
      [null], [{...change, path: "../private"}], [{...change, before: {...beforeEntry, sha: "short"}}],
      [{...change, before: {...beforeEntry, mode: "bad"}}], [{...change, after: {...afterEntry, type: "tree"}}],
      [{...change, after: {...afterEntry, path: "other.ts"}}], [{...change, status: "added"}], [change, change],
    ]) {
      writeFileSync(cachedPath("inventory.json"), JSON.stringify({...valid, files}));
      const result = await getRevisions(current.id, "prior", offline);
      expect(result.comparison).toMatchObject({status: "unavailable", beforeSha: before, afterSha: after, unavailableReason: expect.stringMatching(/cache/i)});
    }
  });
  it("rejects a cached file with mismatched identity or malformed render rows before reuse", async () => {
    baseline(); const io = transport([entry("code.ts", "1")], [entry("code.ts", "2")]);
    const valid = await getRevisionFile(current.id, "prior", "code.ts", io);
    expect((await getRevisionFile(current.id, "prior", "code.ts", offline)).file?.hunks).toEqual(valid.file?.hunks);
    const mutations = [
      {...valid, target: {...valid.target, owner: "foreign"}}, {...valid, beforeSha: "c".repeat(40)},
      {...valid, change: {...valid.change, path: "other.ts"}},
      {...valid, change: {...valid.change, before: entry("code.ts", "wrong")}},
      {...valid, file: {...valid.file, path: "other.ts"}}, {...valid, file: {...valid.file, hunks: [null]}},
      {...valid, file: {...valid.file, hunks: [{id: "bad", range: "bad", section: "", lines: [null]}]}},
      {...valid, file: {...valid.file, hunks: []}}, {...valid, patch: {html: "not a patch"}},
    ];
    for (const mutation of mutations) {
      writeFileSync(cachedPath(`files/${pathDigest("code.ts")}.json`), JSON.stringify(mutation));
      expect(await getRevisionFile(current.id, "prior", "code.ts", offline)).toMatchObject({patch: null, file: null, unavailableReason: expect.stringMatching(/cache/i)});
    }
    writeFileSync(cachedPath(`files/${pathDigest("code.ts")}.json`), "{");
    expect(await getRevisionFile(current.id, "prior", "code.ts", offline)).toMatchObject({patch: null, file: null, unavailableReason: expect.stringMatching(/cache|sidecar/i)});
  });
});
