import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as filesystem from "node:fs/promises";
import { executionBundleSchema, knownCleanWorktree } from "@review-canvas/shared";
import { recordExecution, type RecorderOptions } from "./recorder.js";

vi.mock("node:fs/promises", { spy: true });

const dirs: string[] = [];
const target = { owner: "synthetic", repo: "retry-demo", number: 1 };
const manifest = { version: 1, scenario: { id: "retry", version: "1", title: "Synthetic retry" }, inputs: { z: 2, a: 1 }, environment: { runtime: "node" }, goalIds: ["retry"], sourceRefs: [] };
const event = (id = "output", value: unknown = 42) => `REVIEW_CANVAS_EVENT ${JSON.stringify({ id, kind: "output", title: id, value, sourceRefs: [] })}`;
async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), "recorder-")); dirs.push(cwd);
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  git("init", "-q"); git("config", "user.name", "Synthetic"); git("config", "user.email", "synthetic@example.test");
  git("remote", "add", "origin", "git@github.com:synthetic/retry-demo.git");
  await writeFile(join(cwd, ".gitignore"), "manifest.json\nbundle.json\nignored\n");
  await writeFile(join(cwd, "tracked"), "seed"); git("add", "."); git("commit", "-qm", "Seed");
  await writeFile(join(cwd, "manifest.json"), JSON.stringify(manifest));
  const options: RecorderOptions = { cwd, target, manifestPath: join(cwd, "manifest.json"), outPath: join(cwd, "bundle.json"), argv: [process.execPath, "-e", `console.log(${JSON.stringify(event())})`] };
  return { cwd, git, options };
}
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

describe("recordExecution real children", () => {
  it("captures literal argv, canonical declarations, full HEAD, logs, and atomic output", async () => {
    const { cwd, git, options } = await setup();
    const literal = "$(touch SHOULD_NOT_EXIST); & | `whoami`";
    options.argv = [process.execPath, "-e", `console.log('ordinary'); console.error('diagnostic'); console.log('REVIEW_CANVAS_EVENT '+JSON.stringify({id:'actual',kind:'output',title:'Actual',sourceRefs:[],value:{arg:process.argv[1],input:process.env.REVIEW_CANVAS_SCENARIO_INPUT}}))`, literal];
    const bundle = await recordExecution(options);
    expect(bundle.observations[0]?.value).toEqual({ arg: literal, input: '{"a":1,"z":2}' });
    expect(bundle.process).toMatchObject({ argv: options.argv, cwd: ".", exitCode: 0, termination: "exited", stdoutTruncated: false, stderrTruncated: false });
    expect(bundle.process.stdout).toContain("ordinary"); expect(bundle.process.stderr).toContain("diagnostic");
    expect(bundle.provenance.revision).toBe(git("rev-parse", "HEAD"));
    expect(knownCleanWorktree(bundle.provenance)).toBe(true);
    expect(bundle.capture.status).toBe("complete");
    expect(executionBundleSchema.safeParse(bundle).success).toBe(true);
    expect(JSON.parse(await readFile(join(cwd, "bundle.json"), "utf8"))).toEqual(bundle);
  });
  it("retains observations and failures without inventing assertion success", async () => {
    const { options } = await setup();
    options.argv = [process.execPath, "-e", `console.log(${JSON.stringify(event("one"))});console.log(${JSON.stringify(event("two"))});process.exitCode=1`];
    const bundle = await recordExecution(options);
    expect(bundle.process.exitCode).toBe(1); expect(bundle.capture.status).toBe("complete");
    expect(bundle.observations.map(o => o.id)).toEqual(["one", "two"]);
    options.argv = [process.execPath, "-e", "console.log('no trace')"];
    const absent = await recordExecution(options); expect(absent.capture.status).toBe("partial"); expect(absent.observations).toEqual([]);
    options.argv = [join(options.cwd!, "missing-command")];
    const failed = await recordExecution(options); expect(failed.process.termination).toBe("spawn_error"); expect(failed.capture.status).toBe("partial");
  });
  it("records signals, timeout and interruption after child close", async () => {
    const { options } = await setup();
    options.argv = [process.execPath, "-e", "process.kill(process.pid,'SIGTERM')"];
    expect((await recordExecution(options)).process).toMatchObject({ termination: "signaled", signal: "SIGTERM" });
    options.argv = [process.execPath, "-e", `console.log(${JSON.stringify(event())}); setInterval(()=>{},100)`]; options.timeoutMs = 150;
    const timeout = await recordExecution(options); expect(timeout.process.termination).toBe("timed_out"); expect(timeout.capture.status).toBe("partial");
    const controller = new AbortController(); options.signal = controller.signal; options.timeoutMs = 1000;
    const recording = recordExecution(options); setTimeout(() => controller.abort(), 100);
    expect((await recording).process.termination).toBe("interrupted");
  });
  it("bounds streams and malformed, duplicate, invalid, and overlong trace lines", async () => {
    const { options } = await setup();
    options.argv = [process.execPath, "-e", `console.log(${JSON.stringify(event())});console.log(${JSON.stringify(event())});console.log('REVIEW_CANVAS_EVENT {');console.log('REVIEW_CANVAS_EVENT {}');console.log('REVIEW_CANVAS_EVENT '+ 'x'.repeat(70000));process.stdout.write('o'.repeat(160000));process.stderr.write('e'.repeat(160000))`];
    const bundle = await recordExecution(options);
    expect(bundle.observations).toHaveLength(1); expect(bundle.capture.status).toBe("partial");
    expect(bundle.capture.receivedObservations).toBe(5);
    expect(bundle.capture.issues.join(" ")).toMatch(/Duplicate/); expect(bundle.capture.issues.join(" ")).toMatch(/Malformed/); expect(bundle.capture.issues.join(" ")).toMatch(/64 KiB/);
    expect(Buffer.byteLength(bundle.process.stdout)).toBeLessThanOrEqual(128 * 1024); expect(Buffer.byteLength(bundle.process.stderr)).toBeLessThanOrEqual(128 * 1024);
    expect(bundle.process.stdoutTruncated && bundle.process.stderrTruncated).toBe(true);
    expect(executionBundleSchema.safeParse(bundle).success).toBe(true);
  });
  it("detects tracked, untracked, ignored, and during-run changes; cwd stays repository-relative", async () => {
    const { cwd, options } = await setup();
    await writeFile(join(cwd, "ignored"), "ignored");
    expect(knownCleanWorktree((await recordExecution(options)).provenance)).toBe(true);
    await writeFile(join(cwd, "tracked"), "changed");
    const tracked = await recordExecution(options); expect(tracked.provenance.worktree.before.dirty).toBe(true);
    await writeFile(join(cwd, "untracked"), "first"); const first = await recordExecution(options);
    await writeFile(join(cwd, "untracked"), "second"); const second = await recordExecution(options);
    expect(first.provenance.worktree.before.fingerprint).not.toBe(second.provenance.worktree.before.fingerprint);
    await mkdir(join(cwd, "nested")); options.cwd = join(cwd, "nested");
    options.argv = [process.execPath, "-e", `require('fs').writeFileSync('../tracked','during');console.log(${JSON.stringify(event())})`];
    const during = await recordExecution(options); expect(during.process.cwd).toBe("nested");
    expect(during.provenance.worktree.before.fingerprint).not.toBe(during.provenance.worktree.after.fingerprint);
  });
  it("rejects another repository and keeps unknown identity unknown", async () => {
    const { git, options } = await setup();
    git("remote", "set-url", "origin", "https://github.com/synthetic/other.git");
    await expect(recordExecution(options)).rejects.toThrow(/repository/i);
    git("remote", "remove", "origin");
    const unknown = await recordExecution(options); expect(unknown.provenance.repository).toBeNull(); expect(unknown.provenance.worktree.before.dirty).toBeNull(); expect(unknown.capture.status).toBe("partial");
  });
  it("records actual synthetic HTTP response, mutated record, event, job and assertion", async () => {
    const { options } = await setup();
    options.manifestPath = resolve("test/scenarios/sync-retries.manifest.json");
    options.argv = [process.execPath, resolve("test/scenarios/sync-retries.mjs")];
    const bundle = await recordExecution(options);
    expect(bundle.process.exitCode).toBe(0); expect(bundle.capture.status).toBe("complete");
    expect(new Set(bundle.observations.map(o => o.kind))).toEqual(new Set(["input", "response", "record", "event", "job", "output", "assertion"]));
    expect(bundle.observations.find(o => o.kind === "response")?.value).toMatchObject({ status: 202 });
    expect(bundle.observations.find(o => o.kind === "assertion")?.value).toMatchObject({ outcome: "passed" });
  });
});

describe("capture budgets and provenance edge cases", () => {
  it("counts but omits observations beyond 2000 and trace storage beyond 1 MiB", async () => {
    const { options } = await setup();
    options.argv = [process.execPath, "-e", `for(let i=0;i<2005;i++)console.log('REVIEW_CANVAS_EVENT '+JSON.stringify({id:'step-'+i,kind:'output',title:'Step',value:i,sourceRefs:[]}));console.log(${JSON.stringify(event('step-2004'))})`];
    const counted = await recordExecution(options);
    expect(counted.observations).toHaveLength(2000); expect(counted.capture.receivedObservations).toBe(2006);
    expect(counted.capture.issues).not.toContain("Duplicate observation ID omitted");
    expect(counted.capture.issues.join(' ')).toContain("2000");
    options.argv = [process.execPath, "-e", `for(let i=0;i<24;i++)console.log('REVIEW_CANVAS_EVENT '+JSON.stringify({id:'step-'+i,kind:'output',title:'Step',value:'x'.repeat(60000),sourceRefs:[]}));console.log(${JSON.stringify(event('step-23'))})`];
    const bounded = await recordExecution(options);
    expect(bounded.capture.receivedObservations).toBe(25);
    expect(bounded.observations.at(-1)?.id).toBe("step-23");
    expect(bounded.capture.issues).not.toContain("Duplicate observation ID omitted");
    expect(bounded.observations.length).toBeLessThan(24);
    expect(bounded.capture.issues.join(' ')).toContain("1 MiB");
    expect(executionBundleSchema.safeParse(bounded).success).toBe(true);
  });
  it("enforces serialized 2 MiB output even when JSON escaping expands stream bytes", async () => {
    const { options } = await setup();
    options.argv = [process.execPath, "-e", `process.stdout.write('\\0'.repeat(128*1024)+'\\n');process.stderr.write('\\0'.repeat(128*1024));for(let i=0;i<17;i++)console.log('REVIEW_CANVAS_EVENT '+JSON.stringify({id:'step-'+i,kind:'output',title:'Step',value:'x'.repeat(60000),sourceRefs:[]}))`];
    const bundle = await recordExecution(options);
    expect(Buffer.byteLength(await readFile(options.outPath))).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(bundle.capture.status).toBe("partial"); expect(bundle.capture.issues.join(' ')).toContain("2 MiB");
    expect(executionBundleSchema.safeParse(bundle).success).toBe(true);
  });
  it("preserves Unicode when UTF-8 characters span child output chunks", async () => {
    const { options } = await setup();
    const line = event("unicode", "患者 🩺 café") + "\n";
    options.argv = [process.execPath, "-e", `const data=Buffer.from(${JSON.stringify(line)});const split=data.indexOf(Buffer.from('🩺'))+2;process.stdout.write(data.subarray(0,split));const err=Buffer.from('診療 🩺');process.stderr.write(err.subarray(0,4));setTimeout(()=>{process.stdout.write(data.subarray(split));process.stderr.write(err.subarray(4))},50)`];
    const bundle = await recordExecution(options);
    expect(bundle.observations[0]?.value).toBe("患者 🩺 café");
    expect(bundle.process.stdout).toBe(line); expect(bundle.process.stderr).toBe('診療 🩺');
    expect(bundle.capture.status).toBe('complete');
  });
  it("records committed behavioral variants under identical declared inputs and environment", async () => {
    const { cwd, git, options } = await setup();
    const source = await readFile(resolve("test/scenarios/sync-retries.mjs"), "utf8");
    await writeFile(join(cwd, "scenario.mjs"), source); git("add", "scenario.mjs"); git("commit", "-qm", "Synthetic deduplicated variant");
    options.manifestPath = resolve("test/scenarios/sync-retries.manifest.json");
    options.argv = [process.execPath, "scenario.mjs"];
    const head = await recordExecution(options);
    await writeFile(join(cwd, "scenario.mjs"), source.replace('const RETRY_POLICY = "deduplicate"', 'const RETRY_POLICY = "duplicate"'));
    git("add", "scenario.mjs"); git("commit", "-qm", "Synthetic duplicate variant");
    const historical = await recordExecution(options);
    expect(head.provenance.revision).not.toBe(historical.provenance.revision);
    expect(knownCleanWorktree(head.provenance) && knownCleanWorktree(historical.provenance)).toBe(true);
    expect(head.inputDigest).toBe(historical.inputDigest); expect(head.environmentDigest).toBe(historical.environmentDigest);
    expect(head.observations.find(o => o.kind === 'response')?.value).toMatchObject({ status: 202, body: { queuedJobs: 1 } });
    expect(historical.observations.find(o => o.kind === 'response')?.value).toMatchObject({ status: 200, body: { queuedJobs: 2 } });
    expect(historical.observations.find(o => o.kind === 'assertion')?.value).toMatchObject({ outcome: 'failed' });
    expect(historical.process.exitCode).toBe(1);
  });
  it("rejects oversized manifests before starting the child", async () => {
    const { cwd, options } = await setup();
    await writeFile(options.manifestPath, JSON.stringify({ ...manifest, inputs: "x".repeat(256 * 1024) }));
    options.argv = [process.execPath, "-e", "require('fs').writeFileSync('started','yes')"];
    await expect(recordExecution(options)).rejects.toThrow(/256 KiB/);
    await expect(readFile(join(cwd, 'started'))).rejects.toThrow();
  });
  it("fingerprints index changes even when the working copy matches HEAD", async () => {
    const { cwd, git, options } = await setup();
    await writeFile(join(cwd, 'tracked'), 'staged'); git('add', 'tracked');
    await writeFile(join(cwd, 'tracked'), 'seed');
    expect((await recordExecution(options)).provenance.worktree.before.dirty).toBe(true);
  });
  it("marks unreadable Git state unknown and keeps receipt fields recorder-owned", async () => {
    const { cwd, options } = await setup();
    await writeFile(join(cwd, '.git', 'index'), 'broken index');
    options.argv = [process.execPath, '-e', `console.log('REVIEW_CANVAS_EVENT '+JSON.stringify({id:'invalid',kind:'output',title:'Invalid',value:1,sourceRefs:[],at:'2000-01-01T00:00:00.000Z',sequence:9}));console.log(${JSON.stringify(event())})`];
    const bundle = await recordExecution(options);
    expect(bundle.provenance.worktree.before).toEqual({ dirty: null, fingerprint: null });
    expect(bundle.observations).toHaveLength(1); expect(bundle.observations[0]?.sequence).toBe(1);
    expect(bundle.capture.status).toBe('partial');
  });
  it("skips command startup when aborted during the initial fingerprint", async () => {
    const { cwd, options } = await setup();
    const pendingFile = join(cwd, "untracked");
    await writeFile(pendingFile, "fingerprint input");
    const controller = new AbortController(); options.signal = controller.signal;
    options.argv = [process.execPath, "-e", "require('fs').writeFileSync('started','yes')"];
    const { readFile: originalReadFile } = await vi.importActual<typeof filesystem>("node:fs/promises");
    let fingerprintRead = false;
    const read = vi.spyOn(filesystem, "readFile").mockImplementation(async (...args: Parameters<typeof originalReadFile>) => {
      if (args[0] === pendingFile && !fingerprintRead) {
        fingerprintRead = true;
        await new Promise<void>(resolve => setImmediate(() => { controller.abort(); resolve(); }));
      }
      return originalReadFile(...args);
    });
    try {
      const bundle = await recordExecution(options);
      expect(fingerprintRead).toBe(true);
      expect(bundle.process).toMatchObject({ termination: "interrupted", exitCode: null, signal: null });
      expect(bundle.capture.issues).toContain("Command interrupted");
      await expect(readFile(join(cwd, "started"))).rejects.toThrow();
      expect(executionBundleSchema.safeParse(JSON.parse(await readFile(options.outPath, "utf8"))).success).toBe(true);
    } finally { read.mockRestore(); }
  });
  it.each(["exit", "timeout"])("bounds detached inherited pipes after %s and flushes the final observation", async reason => {
    if (process.platform === "win32") return;
    const { cwd, options } = await setup();
    options.timeoutMs = reason === "timeout" ? 200 : 5000;
    options.argv = [process.execPath, "-e", `const {spawn}=require('child_process');const holder=spawn(process.execPath,['-e',"setInterval(()=>{},100)"],{detached:true,stdio:'inherit'});holder.unref();require('fs').writeFileSync('ignored',String(holder.pid));process.stdout.write(${JSON.stringify(event())});${reason === "exit" ? "process.exit(7)" : "process.on('SIGTERM',()=>{});setInterval(()=>{},100)"}`];
    let deadline: NodeJS.Timeout | undefined;
    const recording = recordExecution(options);
    try {
      const bundle = await Promise.race([recording, new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error("Recorder did not bound inherited pipes")), 1500); })]);
      expect(bundle.process).toMatchObject(reason === "exit" ? { termination: "exited", exitCode: 7, signal: null } : { termination: "timed_out", exitCode: null, signal: "SIGKILL" });
      expect(bundle.capture.status).toBe("partial");
      expect(bundle.capture.issues.join(" ")).toMatch(/output pipes.*open/i);
      expect(bundle.observations.map(observation => observation.id)).toEqual(["output"]);
      expect(executionBundleSchema.safeParse(JSON.parse(await readFile(options.outPath, "utf8"))).success).toBe(true);
    } finally {
      clearTimeout(deadline);
      try { process.kill(Number(await readFile(join(cwd, "ignored"), "utf8")), "SIGKILL"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
      await recording;
    }
  });
  it("drains inherited output that closes before the grace period without losing main exit metadata", async () => {
    if (process.platform === "win32") return;
    const { options } = await setup();
    options.argv = [process.execPath, "-e", `const child=require('child_process').spawn(process.execPath,['-e',${JSON.stringify(`setTimeout(()=>console.log(${JSON.stringify(event())}),50)`)}],{stdio:'inherit'});child.unref();process.exit(7)`];
    const bundle = await recordExecution(options);
    expect(bundle.process).toMatchObject({ termination: "exited", exitCode: 7, signal: null });
    expect(bundle.capture.status).toBe("complete");
    expect(bundle.observations.map(observation => observation.id)).toEqual(["output"]);
  });
  it("keeps process-group escalation scheduled when the main child closes after SIGTERM", async () => {
    if (process.platform === "win32") return;
    const { cwd, options } = await setup(); options.timeoutMs = 200;
    options.argv = [process.execPath, "-e", `const holder=require('child_process').spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},100)"],{stdio:'ignore'});holder.unref();require('fs').writeFileSync('ignored',String(holder.pid));console.log('REVIEW_CANVAS_EVENT '+JSON.stringify({id:'pid',kind:'output',title:'Main PID',value:process.pid,sourceRefs:[]}));setInterval(()=>{},100)`];
    const kill = vi.spyOn(process, "kill");
    try {
      const bundle = await recordExecution(options);
      expect(bundle.process).toMatchObject({ termination: "timed_out", signal: "SIGTERM" });
      expect(kill).toHaveBeenCalledWith(-Number(bundle.observations[0]?.value), "SIGKILL");
    } finally {
      kill.mockRestore();
      try { process.kill(Number(await readFile(join(cwd, "ignored"), "utf8")), "SIGKILL"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    }
  });
  it("escalates a POSIX process group when child and descendant ignore SIGTERM", async () => {
    if (process.platform === 'win32') return;
    const { options } = await setup(); options.timeoutMs = 200;
    options.argv = [process.execPath, '-e', `process.on('SIGTERM',()=>{});const {spawn}=require('child_process');const p=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},100)"],{stdio:'inherit'});console.log('REVIEW_CANVAS_EVENT '+JSON.stringify({id:'pid',kind:'output',title:'Descendant',value:p.pid,sourceRefs:[]}));setInterval(()=>{},100)`];
    const bundle = await recordExecution(options);
    expect(bundle.process).toMatchObject({ termination: 'timed_out', signal: 'SIGKILL' });
    expect(bundle.capture.status).toBe('partial'); expect(bundle.observations).toHaveLength(1);
  });
});
