import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAnalysis, draftReview, type ExecutionBundle, type GhFile, type GhPull } from "@review-canvas/shared";
import { main, prepare, publish } from "./cli.js";
import * as github from "./github.js";
import * as recorder from "./recorder.js";
import * as revisions from "./revisions.js";
import { getEvidenceIndex, getEvidenceRun } from "./evidence.js";
import { loadAnalysis, loadReview, reviewPath, saveAnalysis, saveReview } from "./store.js";

vi.mock("./github.js", async importOriginal => ({...await importOriginal<typeof import("./github.js")>(), fetchPull: vi.fn(), fetchFiles: vi.fn(), fetchHeads: vi.fn()}));
const fixture = JSON.parse(readFileSync(new URL("../../test/fixtures/sync-retries.json", import.meta.url), "utf8")) as {pull: GhPull; files: GhFile[]};
const analysis = buildAnalysis(fixture.pull, fixture.files, {});
let home: string;
let previousHome: string | undefined;
let previousExitCode: typeof process.exitCode;
let output: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  previousHome = process.env.REVIEW_CANVAS_HOME;
  previousExitCode = process.exitCode;
  process.exitCode = 0;
  home = mkdtempSync(join(tmpdir(), "cli-test-"));
  process.env.REVIEW_CANVAS_HOME = home;
  saveAnalysis(analysis);
  saveReview(draftReview(analysis));
  output = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.mocked(github.fetchPull).mockResolvedValue(structuredClone(fixture.pull));
  vi.mocked(github.fetchFiles).mockResolvedValue(fixture.files);
  vi.mocked(github.fetchHeads).mockResolvedValue({});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(github.fetchPull).mockReset();
  process.exitCode = previousExitCode;
  if (previousHome === undefined) delete process.env.REVIEW_CANVAS_HOME; else process.env.REVIEW_CANVAS_HOME = previousHome;
  rmSync(home, {recursive: true, force: true});
});
const printed = () => output.mock.calls.map((args: unknown[]) => args.join(" ")).join("\n");
const jsonOutput = () => JSON.parse(printed()) as Record<string, unknown>;
function manifest() {
  const path = join(home, "scenario.json");
  writeFileSync(path, JSON.stringify({version: 1, scenario: {id: "retry", version: "1", title: "Retry"}, inputs: {attempt: 2}, environment: {fixture: "synthetic"}, goalIds: ["retry"], sourceRefs: []}));
  return path;
}
async function record(exitCode = 0) {
  const out = join(home, `run-${exitCode}.json`);
  const program = `console.log('REVIEW_CANVAS_EVENT '+JSON.stringify({id:'response',kind:'response',title:'Response',value:{status:202},sourceRefs:[]})); process.exitCode=${exitCode}`;
  await main(["evidence", "record", analysis.id, "--scenario", manifest(), "--out", out, "--cwd", home, "--timeout-ms", "5000", "--", process.execPath, "-e", program]);
  return {out, bundle: JSON.parse(readFileSync(out, "utf8")) as ExecutionBundle};
}

describe("CLI evidence", () => {
  it("executes the documented Node example using the documented manifest", async () => {
    const docs = readFileSync(new URL("../../docs/EVIDENCE.md", import.meta.url), "utf8");
    const manifestPath = join(home, "documented.json"); const programPath = join(home, "documented.mjs"); const out = join(home, "documented-run.json");
    writeFileSync(manifestPath, /```json\n([\s\S]*?)\n```/.exec(docs)![1]!);
    writeFileSync(programPath, /```js\n([\s\S]*?)\n```/.exec(docs)![1]!);
    await main(["evidence", "record", analysis.id, "--scenario", manifestPath, "--out", out, "--cwd", home, "--", process.execPath, programPath]);
    const bundle = JSON.parse(readFileSync(out, "utf8")) as ExecutionBundle;
    expect(bundle.process.exitCode).toBe(0);
    expect(bundle.observations.map(observation => observation.kind)).toEqual(["input", "record", "output", "assertion"]);
    expect(bundle.observations.at(-1)?.value).toEqual({outcome: "passed", expected: 2, actual: 2});
  });
  it("records explicit argv without importing, then imports/lists/shows the unchanged bundle with a file receipt", async () => {
    const {out, bundle} = await record();
    expect(bundle.target).toEqual({owner: analysis.pr.owner, repo: analysis.pr.repo, number: analysis.pr.number});
    expect(bundle.process.exitCode).toBe(0);
    expect(bundle.observations[0]?.value).toEqual({status: 202});
    expect(printed()).toContain(out);
    expect(getEvidenceIndex(analysis.id).runs).toEqual([]);
    output.mockClear();
    const withClaimedReceipt = {...bundle, receipt: {origin: "synthetic-fixture"}};
    writeFileSync(out, JSON.stringify(withClaimedReceipt));
    await main(["evidence", "import", analysis.id, out]);
    expect(getEvidenceRun(analysis.id, bundle.runId)).toMatchObject({bundle: withClaimedReceipt, receipt: {origin: "imported-file"}});
    expect(readFileSync(reviewPath(analysis.id, "brief.md"), "utf8")).toContain(bundle.runId);
    output.mockClear();
    await main(["evidence", "show", analysis.id, bundle.runId, "--json"]);
    expect(jsonOutput()).toEqual(getEvidenceRun(analysis.id, bundle.runId));
    output.mockClear();
    await main(["evidence", "list", analysis.id, "--json"]);
    expect(jsonOutput()).toEqual(getEvidenceIndex(analysis.id));
  });
  it("reports a failed child exit and its written artifact", async () => {
    const {out, bundle} = await record(7);
    expect(process.exitCode).toBe(7);
    expect(bundle.process.exitCode).toBe(7);
    expect(printed()).toContain(out);
    expect(printed()).toContain("7");
  });
  it("uses nonzero recorder statuses for timeout, signal, spawn failure and partial capture", async () => {
    const {bundle} = await record();
    const cases = [
      {termination: "timed_out", signal: "SIGTERM", exitCode: null, expected: 124},
      {termination: "signaled", signal: "SIGTERM", exitCode: null, expected: 143},
      {termination: "spawn_error", signal: null, exitCode: null, expected: 1},
      {termination: "exited", signal: null, exitCode: 0, expected: 1},
    ] as const;
    for (const {expected, ...terminal} of cases) {
      vi.spyOn(recorder, "recordExecution").mockResolvedValueOnce({...bundle, process: {...bundle.process, ...terminal}, capture: {...bundle.capture, status: "partial"}});
      await main(["evidence", "record", analysis.id, "--scenario", manifest(), "--out", join(home, "terminal.json"), "--", "command"]);
      expect(process.exitCode).toBe(expected);
    }
  });
  it("compares selected runs with explicit mismatch reasons in one JSON value", async () => {
    const {out, bundle} = await record();
    await main(["evidence", "import", analysis.id, out]);
    const other = {...bundle, runId: "other", capture: {...bundle.capture, status: "partial", issues: ["Missing trace"]}};
    const otherPath = join(home, "other.json"); writeFileSync(otherPath, JSON.stringify(other));
    await main(["evidence", "import", analysis.id, otherPath]);
    output.mockClear();
    await main(["evidence", "compare", analysis.id, "--left", bundle.runId, "--right", "other", "--mode", "base-head", "--json"]);
    expect(jsonOutput()).toMatchObject({leftRunId: bundle.runId, rightRunId: "other", comparable: false, reasons: expect.arrayContaining(["Exact stored base/head revisions are unavailable"])});
  });
  it("forwards signals to the recorder and removes listeners after completion or failure", async () => {
    const {bundle} = await record();
    const before = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      let aborted = false;
      vi.spyOn(recorder, "recordExecution").mockImplementationOnce(async options => {
        expect(options.argv).toEqual(["explicit-command", "--synthetic-fixture"]);
        options.signal!.addEventListener("abort", () => { aborted = true; });
        process.emit(signal);
        return {...bundle, process: {...bundle.process, termination: "interrupted", signal: "SIGTERM", exitCode: null}};
      });
      await main(["evidence", "record", analysis.id, "--scenario", manifest(), "--out", join(home, "interrupted.json"), "--", "explicit-command", "--synthetic-fixture"]);
      expect(aborted).toBe(true);
      expect(process.exitCode).toBe(signal === "SIGINT" ? 130 : 143);
      expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(before);
    }
    vi.spyOn(recorder, "recordExecution").mockRejectedValueOnce(new Error("preflight failed"));
    await expect(main(["evidence", "record", analysis.id, "--scenario", manifest(), "--out", join(home, "bad.json"), "--", "command"])).rejects.toThrow("preflight failed");
    expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(before);
  });
  it("rejects implicit commands, malformed options and synthetic receipt overrides", async () => {
    for (const args of [
      ["record", analysis.id, "--scenario", manifest(), "--out", join(home, "x.json"), "node"],
      ["record", analysis.id, "--scenario", manifest(), "--out", join(home, "x.json"), "--timeout-ms", "NaN", "--", "node"],
      ["record", analysis.id, "--scenario", manifest(), "--out", join(home, "x.json"), "--", ],
      ["import", analysis.id, "bundle.json", "--synthetic-fixture"],
      ["list", analysis.id, "--json", "--json"],
      ["compare", analysis.id, "--left", "a", "--right", "b", "--mode", "guess"],
    ]) await expect(main(["evidence", ...args])).rejects.toThrow();
  });
  it("preserves evidence and rebinds renamed goals when publishing, refreshing the brief without replacing course.json", async () => {
    const course = {sentence: "Retry", goals: [{title: "Retry", src: "PR", quote: "Retry", stops: [], gap: "No source test"}], unclaimed: [], hunks: {}, links: []};
    const path = reviewPath(analysis.id, "course.json"); writeFileSync(path, JSON.stringify(course));
    publish(analysis.id);
    const {out, bundle} = await record(); await main(["evidence", "import", analysis.id, out]);
    expect(getEvidenceIndex(analysis.id).runs[0]?.goalBindings).toEqual([{goalId: "retry", status: "bound"}]);
    course.goals[0]!.title = "Retry later"; const saved = JSON.stringify(course); writeFileSync(path, saved);
    publish(analysis.id);
    expect(getEvidenceRun(analysis.id, bundle.runId).bundle).toEqual(bundle);
    expect(getEvidenceIndex(analysis.id).runs[0]?.goalBindings).toEqual([{goalId: "retry", status: "unbound"}]);
    expect(readFileSync(reviewPath(analysis.id, "brief.md"), "utf8")).toContain('"status": "unbound"');
    expect(readFileSync(path, "utf8")).toBe(saved);
  });
});

describe("CLI deployment and revisions", () => {
  it("imports and shows deployment context without deleting evidence", async () => {
    const {out, bundle} = await record(); await main(["evidence", "import", analysis.id, out]);
    const doc = {version: 1, target: {owner: analysis.pr.owner, repo: analysis.pr.repo, number: analysis.pr.number, headSha: analysis.pr.headSha}, schemaChanges: [], compatibility: [], backfills: [], rollback: []};
    const path = join(home, "deployment.json"); writeFileSync(path, JSON.stringify(doc));
    await main(["deployment", "import", analysis.id, path]); output.mockClear();
    await main(["deployment", "show", analysis.id, "--json"]);
    expect(jsonOutput()).toMatchObject({status: "available", analysis: doc});
    expect(getEvidenceRun(analysis.id, bundle.runId).bundle).toEqual(bundle);
  });
  it("prints revision selection as clean JSON and forwards an explicit baseline", async () => {
    const payload = {baseline: null, alternatives: [], comparison: null, unavailableReason: "No reviewed revision"};
    const get = vi.spyOn(revisions, "getRevisions").mockResolvedValue(payload);
    await main(["revisions", analysis.id, "--baseline", "earlier", "--json"]);
    expect(get).toHaveBeenCalledWith(analysis.id, "earlier");
    expect(jsonOutput()).toEqual(payload);
  });
});

describe("prepare revision identity", () => {
  it("records the exact base and checks metadata after fetching files and heads", async () => {
    const pull = structuredClone(fixture.pull); pull.base.sha = "b".repeat(40);
    vi.mocked(github.fetchPull).mockResolvedValue(pull);
    const {analysis: prepared} = await prepare("example/sync-service#42");
    expect(github.fetchPull).toHaveBeenCalledTimes(2);
    expect(vi.mocked(github.fetchPull).mock.invocationCallOrder[1]).toBeGreaterThan(vi.mocked(github.fetchHeads).mock.invocationCallOrder.at(-1)!);
    expect(prepared.pr.baseSha).toBe("b".repeat(40));
    const brief = readFileSync(reviewPath(prepared.id, "brief.md"), "utf8");
    expect(brief).toContain("Exact base revision: " + "b".repeat(40));
    expect(brief).toContain('"publishedEvidenceEndpoints"');
    expect(brief).toContain('"baseSha": null');
  });
  it.each(["head", "base", "repository", "number"])("rejects a changed %s before saving any mixed snapshot", async field => {
    const first = structuredClone(fixture.pull); first.head.sha = "a".repeat(40); first.base.sha = "b".repeat(40);
    const second = structuredClone(first);
    if (field === "head") second.head.sha = "c".repeat(40);
    if (field === "base") second.base.sha = "c".repeat(40);
    if (field === "repository") second.base.repo.owner.login = "another-owner";
    if (field === "number") second.number++;
    vi.mocked(github.fetchPull).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const id = buildAnalysis(first, fixture.files, {}).id;
    await expect(prepare("example/sync-service#42")).rejects.toThrow(/changed|retry/i);
    expect(loadAnalysis(id)).toBeNull();
    expect(loadReview(analysis.id)?.analysis).toEqual(analysis);
  });
});
