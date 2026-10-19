import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readlink, rename, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { canonicalJson, executionBundleSchema, observationInputSchema, repositoryPathSchema, revisionSchema, safeIdSchema, sameRepository, scenarioManifestSchema, targetSchema, type ExecutionBundle, type Observation, type ScenarioManifest } from "@review-canvas/shared";

const execute = promisify(execFile);
const PREFIX = "REVIEW_CANVAS_EVENT ";
const STREAM_LIMIT = 128 * 1024;
const LINE_LIMIT = 64 * 1024;
const TRACE_LIMIT = 1024 * 1024;
const BUNDLE_LIMIT = 2 * 1024 * 1024;
const MANIFEST_LIMIT = 256 * 1024;

export interface RecorderOptions {
  target: ExecutionBundle["target"];
  manifestPath: string;
  outPath: string;
  argv: string[];
  /** The child directory; the artifact stores its path relative to the Git root. */
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

const digest = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const unknownTree = () => ({ dirty: null, fingerprint: null });

async function git(cwd: string, args: string[]): Promise<Buffer> {
  const result = await execute("git", args, { cwd, encoding: "buffer", maxBuffer: 32 * 1024 * 1024 });
  return result.stdout;
}

function repositoryOf(remote: string): ExecutionBundle["provenance"]["repository"] {
  const match = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https?:\/\/github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(remote.trim());
  if (!match || !safeIdSchema.safeParse(match[1]).success || !safeIdSchema.safeParse(match[2]).success) return null;
  return { owner: match[1]!, repo: match[2]! };
}

async function treeState(root: string): Promise<ExecutionBundle["provenance"]["worktree"]["before"]> {
  const hash = createHash("sha256");
  hash.update(await git(root, ["rev-parse", "HEAD"]));
  const changes = await git(root, ["diff", "--binary", "--no-ext-diff", "--no-textconv", "--"]);
  const staged = await git(root, ["diff", "--cached", "--binary", "--no-ext-diff", "--no-textconv", "--"]);
  hash.update(changes);
  hash.update(staged);
  const paths = (await git(root, ["ls-files", "--others", "--exclude-standard", "-z"])).toString("utf8").split("\0").filter(Boolean).sort();
  for (const path of paths) {
    const full = resolve(root, path);
    const stat = await lstat(full);
    const contents = stat.isSymbolicLink() ? Buffer.from(await readlink(full)) : await readFile(full);
    hash.update(JSON.stringify([path, stat.mode, digest(contents)]));
  }
  return { dirty: changes.length > 0 || staged.length > 0 || paths.length > 0, fingerprint: hash.digest("hex") };
}

/** Records an explicit command and atomically writes its artifact, including failed runs. */
export async function recordExecution(options: RecorderOptions): Promise<ExecutionBundle> {
  const target = targetSchema.parse(options.target);
  if (!options.argv.length || options.argv.some(arg => typeof arg !== "string" || arg.includes("\0"))) throw new Error("Expected an explicit command argv without NUL bytes");
  const timeoutMs = options.timeoutMs ?? 300_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) throw new Error("timeoutMs must be a positive integer no larger than 2147483647");
  const manifestBytes = await readFile(options.manifestPath);
  if (manifestBytes.length > MANIFEST_LIMIT) throw new Error("Scenario manifest exceeds 256 KiB");
  const manifest: ScenarioManifest = scenarioManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
  if (Buffer.byteLength(JSON.stringify(options.argv)) > MANIFEST_LIMIT) throw new Error("Command argv exceeds 256 KiB");
  const cwd = resolve(options.cwd ?? process.cwd());
  const issues: string[] = [];
  const issue = (message: string) => { if (!issues.includes(message)) issues.push(message); };
  let root: string | null = null;
  let repository: ExecutionBundle["provenance"]["repository"] = null;
  let revision: string | null = null;
  try { root = (await git(cwd, ["rev-parse", "--show-toplevel"])).toString("utf8").trim(); }
  catch { issue("Git repository root unavailable; working-tree provenance is unknown"); }
  if (root) {
    try { repository = repositoryOf((await git(root, ["remote", "get-url", "origin"])).toString("utf8")); }
    catch { /* Missing origin is unknown identity. */ }
    if (repository && !sameRepository(target, repository)) throw new Error("Command repository differs from review target repository");
    if (!repository) issue("Git repository identity unavailable; working-tree provenance is unknown");
    try { revision = revisionSchema.parse((await git(root, ["rev-parse", "HEAD"])).toString("utf8").trim()); }
    catch { issue("Git HEAD unavailable; revision provenance is unknown"); }
  }
  const repoCwd = root ? relative(root, cwd).split(sep).join("/") || "." : ".";
  if (repoCwd !== ".") repositoryPathSchema.parse(repoCwd);
  for (const ref of manifest.sourceRefs) {
    if (!sameRepository(ref, repository) || ref.revision !== revision) throw new Error("Manifest source reference must use the command repository and revision");
  }
  const readTree = async () => {
    if (!root || !repository || !revision) return unknownTree();
    try { return await treeState(root); }
    catch { issue("Working-tree fingerprint unavailable due to a Git or file read error"); return unknownTree(); }
  };
  const before = await readTree();
  const startedAt = new Date().toISOString();
  let lastReceipt = Date.parse(startedAt);
  const observations: Observation[] = [];
  const ids = new Set<string>();
  let receivedObservations = 0;
  let traceBytes = 0;
  const stdout: Buffer[] = []; const stderr: Buffer[] = [];
  let stdoutBytes = 0; let stderrBytes = 0;
  let stdoutTruncated = false; let stderrTruncated = false;
  let line = Buffer.alloc(0); let lineOverflow = false;
  function parseLine() {
    const value = line.toString("utf8");
    if (value.startsWith(PREFIX)) {
      receivedObservations++;
      if (lineOverflow) issue("Protocol line exceeds 64 KiB");
      else {
        try {
          const raw: unknown = JSON.parse(value.slice(PREFIX.length));
          if (raw && typeof raw === "object" && ("sequence" in raw || "at" in raw)) throw new Error("Recorder-owned receipt fields");
          const input = observationInputSchema.parse(raw);
          if (input.sourceRefs.some(ref => !sameRepository(ref, repository) || ref.revision !== revision)) throw new Error("Source reference differs from command provenance");
          if (ids.has(input.id)) issue("Duplicate observation ID omitted");
          else {
            ids.add(input.id);
            lastReceipt = Math.max(lastReceipt, Date.now());
            const observation = { ...input, sequence: receivedObservations - 1, at: new Date(lastReceipt).toISOString() };
            const size = Buffer.byteLength(JSON.stringify(observation));
            if (observations.length >= 2000) issue("Observation count exceeds 2000");
            else if (traceBytes + size > TRACE_LIMIT) issue("Trace storage exceeds 1 MiB");
            else { observations.push(observation); traceBytes += size; }
          }
        } catch { issue("Malformed or invalid protocol observation omitted"); }
      }
    }
    line = Buffer.alloc(0); lineOverflow = false;
  }
  function parseChunk(chunk: Buffer) {
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start);
      const end = newline === -1 ? chunk.length : newline;
      const remaining = LINE_LIMIT - line.length;
      const part = chunk.subarray(start, end);
      if (part.length > remaining) lineOverflow = true;
      if (remaining > 0) line = Buffer.concat([line, part.subarray(0, remaining)]);
      if (newline === -1) break;
      parseLine(); start = end + 1;
    }
  }
  let termination: ExecutionBundle["process"]["termination"] = "exited";
  let exitCode: number | null = null; let signal: string | null = null;
  const posix = process.platform !== "win32";
  if (!posix) issue("Process-group termination is unavailable on this platform; descendants may survive");
  await new Promise<void>((settle) => {
    const child = spawn(options.argv[0]!, options.argv.slice(1), { cwd, shell: false, detached: posix, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, REVIEW_CANVAS_SCENARIO_INPUT: canonicalJson(manifest.inputs) } });
    let escalation: NodeJS.Timeout | undefined;
    let closed = false;
    const kill = (killSignal: NodeJS.Signals) => {
      try { if (posix && child.pid) process.kill(-child.pid, killSignal); else child.kill(killSignal); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") issue("Could not terminate command process group"); }
    };
    const stop = (reason: "timed_out" | "interrupted") => {
      if (termination !== "exited") return;
      termination = reason; issue(reason === "timed_out" ? "Command timed out" : "Command interrupted");
      kill("SIGTERM");
      escalation = setTimeout(() => { kill("SIGKILL"); escalation = undefined; if (closed) settle(); }, 300);
    };
    const abort = () => stop("interrupted");
    const timer = setTimeout(() => stop("timed_out"), timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      const keep = Math.max(0, STREAM_LIMIT - stdoutBytes);
      if (chunk.length > keep) { stdoutTruncated = true; issue("Stdout storage exceeds 128 KiB"); }
      if (keep) { const bytes = chunk.subarray(0, keep); stdout.push(bytes); stdoutBytes += bytes.length; }
      parseChunk(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const keep = Math.max(0, STREAM_LIMIT - stderrBytes);
      if (chunk.length > keep) { stderrTruncated = true; issue("Stderr storage exceeds 128 KiB"); }
      if (keep) { const bytes = chunk.subarray(0, keep); stderr.push(bytes); stderrBytes += bytes.length; }
    });
    child.on("error", () => { if (termination === "exited") termination = "spawn_error"; issue("Command could not be spawned"); });
    child.on("close", (code, terminalSignal) => {
      clearTimeout(timer);
      closed = true;
      options.signal?.removeEventListener("abort", abort);
      exitCode = code; signal = terminalSignal;
      if (termination === "exited" && terminalSignal) { termination = "signaled"; issue("Command terminated by signal"); }
      if (line.length || lineOverflow) parseLine();
      if (!escalation) settle();
    });
    if (options.signal?.aborted) abort();
  });
  if (!receivedObservations) issue("No structured observations were received");
  const finishedAt = new Date(Math.max(lastReceipt, Date.now())).toISOString();
  const after = await readTree();
  function streamText(chunks: Buffer[]) {
    let text = Buffer.concat(chunks).toString("utf8");
    while (Buffer.byteLength(text) > STREAM_LIMIT) text = text.slice(0, -1);
    return text;
  }
  const bundle: ExecutionBundle = {
    ...manifest, runId: randomUUID(), target,
    inputDigest: digest(canonicalJson(manifest.inputs)), environmentDigest: digest(canonicalJson(manifest.environment)),
    provenance: { producer: { name: "review-canvas", version: "0.1.0" }, origin: "recorded", repository, revision, worktree: { before, after } },
    process: { argv: options.argv, cwd: repoCwd, startedAt, finishedAt, exitCode, signal, termination, stdout: streamText(stdout), stderr: streamText(stderr), stdoutTruncated, stderrTruncated },
    observations,
    capture: { protocolVersion: 1, status: issues.length ? "partial" : "complete", issues, receivedObservations, storedObservations: observations.length },
  };
  // JSON escaping can exceed the byte budget even when raw stream/trace storage fits.
  if (Buffer.byteLength(JSON.stringify(bundle)) > BUNDLE_LIMIT) {
    issue("Serialized bundle exceeds 2 MiB; retained logs or observations were reduced");
    bundle.capture.status = "partial";
    if (bundle.process.stdout) { bundle.process.stdout = ""; bundle.process.stdoutTruncated = true; }
    if (bundle.process.stderr) { bundle.process.stderr = ""; bundle.process.stderrTruncated = true; }
    while (Buffer.byteLength(JSON.stringify(bundle)) > BUNDLE_LIMIT && observations.length) observations.pop();
    bundle.capture.storedObservations = observations.length;
  }
  executionBundleSchema.parse(bundle);
  const serialized = JSON.stringify(bundle, null, 2);
  // Whitespace is deliberately excluded: its cost must not defeat the import limit.
  const output = Buffer.byteLength(serialized) <= BUNDLE_LIMIT ? serialized : JSON.stringify(bundle);
  if (Buffer.byteLength(output) > BUNDLE_LIMIT) throw new Error("Required bundle metadata exceeds 2 MiB");
  const destination = resolve(options.outPath);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, output, { flag: "wx" }); await rename(temporary, destination); }
  finally { await rm(temporary, { force: true }); }
  return bundle;
}
