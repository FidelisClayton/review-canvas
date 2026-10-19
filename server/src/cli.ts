#!/usr/bin/env node
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { constants } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAnalysis, courseInputSchema, emptyState, mergeCourse, onCourse, type Analysis, type ExecutionBundle, type GhFile, type GhPull, type RevisionFilePayload, type RevisionFileChange } from "@review-canvas/shared";
import { buildApp } from "./app.js";
import { courseTemplate, renderBrief } from "./brief.js";
import { baseUrl, home, port, readConfig, reviewUrl, writeConfig } from "./config.js";
import { fetchFileAt, fetchFiles, fetchHeads, fetchPull, GhError, parsePrRef } from "./github.js";
import { compareEvidence, getDeployment, getEvidenceIndex, getEvidenceRun, importDeployment, importEvidence } from "./evidence.js";
import { recordExecution } from "./recorder.js";
import { getRevisions } from "./revisions.js";
import { atomicSidecar, pathDigest } from "./evidenceStore.js";
import { loadAnalysis, loadReview, reviewPath, saveAnalysis, saveHeadFile, saveReview, saveState } from "./store.js";

const USAGE = `review-canvas: review a pull request on an infinite canvas

  review-canvas prepare <pr-url>          Fetch and analyze a PR. Prints the review id, the brief to
                                          read, and the course JSON to fill in.
  review-canvas publish <id> [course.json] Check the course against the analysis, save it, make sure
                                          the server runs, and print the URL to open.
  review-canvas show <id> <file-or-hunk-id> Print a whole file diff or hunk from the analysis.
  review-canvas cat <id> <path>           Print a file as it is at the PR's head commit.
  review-canvas evidence record <id> --scenario <manifest.json> --out <bundle.json>
      [--cwd <path>] [--timeout-ms <ms>] -- <command> [args...]
                                          Record explicit argv; write a bundle without importing.
  review-canvas evidence import <id> <bundle.json>
  review-canvas evidence list <id> [--json]
  review-canvas evidence show <id> <run-id> [--json]
  review-canvas evidence compare <id> --left <run> --right <run> [--mode runs|base-head] [--json]
  review-canvas revisions <id> [--baseline <review-id>] [--json]
  review-canvas deployment import <id> <file.json>
  review-canvas deployment show <id> [--json]
  review-canvas open <pr-url>             prepare + publish the default course in one step (no agent).
  review-canvas url <id>                  Print the URL of a review.
  review-canvas up                        Start the server in the background if it is not running.
  review-canvas serve                     Run the server in the foreground.
  review-canvas stop | restart            Stop (or stop and start) the background server.
  review-canvas demo                      Load a synthetic PR with a planned course, to try the UI.
  review-canvas setup [--public-url URL]  Choose the URL reviews are opened at. With no URL, uses
                                          this machine's Tailscale name and runs \`tailscale serve\`.
`;

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`${path} is not valid JSON: ${(e as Error).message}. Fix or delete it.`);
  }
}

function refreshBrief(id: string, analysis?: Analysis) {
  const review = loadReview(id);
  if (!review) throw new Error(`No review for ${id}.`);
  let deployment;
  try { deployment = getDeployment(id); }
  catch (error) { deployment = {error: error instanceof Error ? error.message : String(error)}; }
  writeFileSync(reviewPath(id, "brief.md"), renderBrief(analysis ?? review.analysis, reviewPath(id, "course.json"), {review, evidence: getEvidenceIndex(id), deployment}));
}

export async function prepare(input: string) {
  const ref = parsePrRef(input);
  const pull = await fetchPull(ref);
  const files = await fetchFiles(ref);
  const heads = await fetchHeads(ref, pull.head.sha, files);
  const latest = await fetchPull(ref);
  if (pull.head.sha !== latest.head.sha || pull.base.sha !== latest.base.sha || pull.number !== latest.number ||
      pull.base.repo.name !== latest.base.repo.name || pull.base.repo.owner.login !== latest.base.repo.owner.login) {
    throw new Error("PR repository, number, base or head changed during preparation. Retry `review-canvas prepare <pr-url>`.");
  }
  const analysis = buildAnalysis(pull, files, heads);
  saveAnalysis(analysis);
  const coursePath = reviewPath(analysis.id, "course.json");
  const briefPath = reviewPath(analysis.id, "brief.md");
  // The id includes the head commit, so an existing course was planned against this same code:
  // keep the agent's work instead of resetting it to the template. A course without `goals` is the
  // old file-based format, so it is replaced.
  const existing = existsSync(coursePath) ? (readJson(coursePath) as { goals?: unknown } | null) : null;
  if (!existing?.goals) writeFileSync(coursePath, JSON.stringify(courseTemplate(analysis), null, 2) + "\n");
  refreshBrief(analysis.id, analysis);
  return { analysis, coursePath, briefPath };
}

async function healthy(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port()}/api/health`, { signal: AbortSignal.timeout(800) });
    return res.ok && ((await res.json()) as { app?: string }).app === "review-canvas";
  } catch {
    return false;
  }
}

/** Starts `serve` detached, logging to the app directory, and waits until it answers. */
async function up() {
  if (await healthy()) return;
  mkdirSync(home(), { recursive: true });
  const log = openSync(`${home()}/server.log`, "a");
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "serve"], { detached: true, stdio: ["ignore", log, log] });
  child.unref();
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (await healthy()) return;
  }
  throw new Error(`The server did not start. See ${home()}/server.log.`);
}

const pidFile = () => `${home()}/server.pid`;

async function stop() {
  let pid: number | null = null;
  try {
    pid = Number(readFileSync(pidFile(), "utf8"));
  } catch {
    /* no pid file: nothing we started is running */
  }
  if (pid) {
    try {
      process.kill(pid);
    } catch {
      /* already gone */
    }
    rmSync(pidFile(), { force: true });
  }
  for (let i = 0; i < 30 && (await healthy()); i++) await new Promise((r) => setTimeout(r, 100));
}

export function publish(id: string, path?: string) {
  const analysis = loadAnalysis(id);
  if (!analysis) throw new Error(`No analysis for ${id}. Run \`review-canvas prepare <pr-url>\` first.`);
  const raw = readJson(path ?? reviewPath(id, "course.json"));
  const parsed = courseInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`The course JSON is invalid:\n${parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  }
  const review = mergeCourse(analysis, parsed.data);
  saveReview(review);
  refreshBrief(id);
  return review;
}

/** Load the built-in, explicitly synthetic course and evidence without network access. */
export function loadDemo() {
  const root = new URL("../../test/fixtures/", import.meta.url);
  const fixture = (name: string) => readJson(fileURLToPath(new URL(`sync-retries.${name}.json`, root)));
  const {pull, files} = readJson(fileURLToPath(new URL("sync-retries.json", root))) as {pull: GhPull; files: GhFile[]};
  const revisions = fixture("revisions") as {
    currentCreatedAt: string;
    baseline: {reviewId: string; headSha: string; createdAt: string; reviewedAt: string};
    inventory: {beforeSha: string; afterSha: string; files: RevisionFileChange[]};
    files: RevisionFilePayload[];
  };
  const analysis = {...buildAnalysis(pull, files, {}), createdAt: revisions.currentCreatedAt};
  saveAnalysis(analysis);
  const review = publish(analysis.id, fileURLToPath(new URL("sync-retries.course.json", root)));
  const heads = fixture("heads") as Record<string, string>;
  for (const file of analysis.files) if (heads[file.path] !== undefined) saveHeadFile(analysis.id, file.id, heads[file.path]!);

  const baseline = revisions.baseline;
  const earlier = {...buildAnalysis({...pull, head: {...pull.head, sha: baseline.headSha}}, [], {}), id: baseline.reviewId, createdAt: baseline.createdAt};
  saveAnalysis(earlier);
  const firstGoal = review.course.goals[0]!;
  saveReview(mergeCourse(earlier, courseInputSchema.parse({
    sentence: "Synthetic earlier reviewed snapshot",
    goals: [{title: firstGoal.title, src: firstGoal.src, quote: firstGoal.quote, stops: [], gap: "Synthetic baseline stores the review mark; source is in the cached endpoint comparison."}],
    hunks: {}, links: [],
  })));
  if (!existsSync(reviewPath(earlier.id, "state.json"))) saveState(earlier.id, {...emptyState(), reviewed: {[firstGoal.id]: baseline.reviewedAt}});
  const cache = `revisions/${revisions.inventory.beforeSha}-${revisions.inventory.afterSha}`;
  atomicSidecar(reviewPath(analysis.id, `${cache}/inventory.json`), revisions.inventory);
  for (const file of revisions.files) atomicSidecar(reviewPath(analysis.id, `${cache}/files/${pathDigest(file.change.path)}.json`), file);
  for (const bundle of fixture("evidence") as ExecutionBundle[]) importEvidence(analysis.id, bundle, {origin: "synthetic-fixture"});
  importDeployment(analysis.id, fixture("deployment"));
  refreshBrief(analysis.id);
  return review;
}

function tailscaleName(): string {
  const status = JSON.parse(execFileSync("tailscale", ["status", "--json"], { encoding: "utf8" })) as { Self: { DNSName: string } };
  return status.Self.DNSName.replace(/\.$/, "");
}

function options(args: string[], positionalCount: number, values: string[] = [], flags: string[] = []) {
  const positional: string[] = [];
  const parsed = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) { positional.push(arg); continue; }
    if (parsed.has(arg)) throw new Error(`Duplicate option: ${arg}.`);
    if (flags.includes(arg)) parsed.set(arg, "true");
    else if (values.includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}.`);
      parsed.set(arg, value);
    } else throw new Error(`Unknown option: ${arg}.`);
  }
  if (positional.length !== positionalCount) throw new Error(`Expected ${positionalCount} positional argument(s). Run \`review-canvas help\` for usage.`);
  return {positional, parsed};
}

async function evidenceCommand(args: string[]) {
  const [action, ...rest] = args;
  if (action === "record") {
    const separator = rest.indexOf("--");
    if (separator < 0 || separator === rest.length - 1) throw new Error("Recording requires an explicit command after --.");
    const {positional: [id], parsed} = options(rest.slice(0, separator), 1, ["--scenario", "--out", "--cwd", "--timeout-ms"]);
    const manifestPath = parsed.get("--scenario"); const outPath = parsed.get("--out");
    if (!manifestPath || !outPath) throw new Error("Recording requires --scenario <manifest.json> and --out <bundle.json>.");
    const rawTimeout = parsed.get("--timeout-ms");
    const timeoutMs = rawTimeout === undefined ? undefined : Number(rawTimeout);
    if (timeoutMs !== undefined && (!/^\d+$/.test(rawTimeout!) || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647)) throw new Error("--timeout-ms must be a positive integer no larger than 2147483647.");
    const analysis = loadAnalysis(id!);
    if (!analysis) throw new Error(`No analysis for ${id}. Run \`review-canvas prepare <pr-url>\` first.`);
    const controller = new AbortController();
    let interrupted: "SIGINT" | "SIGTERM" | undefined;
    const interrupt = (signal: "SIGINT" | "SIGTERM") => { interrupted ??= signal; controller.abort(); };
    const onInt = () => interrupt("SIGINT"); const onTerm = () => interrupt("SIGTERM");
    process.on("SIGINT", onInt); process.on("SIGTERM", onTerm);
    try {
      const {owner, repo, number} = analysis.pr;
      const bundle = await recordExecution({target: {owner, repo, number}, manifestPath, outPath, argv: rest.slice(separator + 1), cwd: parsed.get("--cwd"), timeoutMs, signal: controller.signal});
      console.log(`Recorded ${bundle.runId}: ${resolve(outPath)}`);
      console.log(`Process: ${bundle.process.termination}, exit ${bundle.process.exitCode ?? "unknown"}, signal ${bundle.process.signal ?? "none"}. Capture: ${bundle.capture.status}.`);
      for (const issue of bundle.capture.issues) console.log(`capture issue: ${issue}`);
      if (interrupted) process.exitCode = interrupted === "SIGINT" ? 130 : 143;
      else if (bundle.process.termination === "timed_out") process.exitCode = 124;
      else if (bundle.process.signal) process.exitCode = 128 + (constants.signals[bundle.process.signal as NodeJS.Signals] ?? 0);
      else process.exitCode = bundle.process.exitCode || (bundle.process.termination !== "exited" || bundle.capture.status === "partial" ? 1 : 0);
    } finally {
      process.removeListener("SIGINT", onInt); process.removeListener("SIGTERM", onTerm);
    }
    return;
  }
  if (action === "import") {
    const {positional: [id, path]} = options(rest, 2);
    const stored = importEvidence(id!, readFileSync(path!));
    refreshBrief(id!);
    console.log(`Imported ${stored.bundle.runId} (${stored.receipt.origin}).`);
    for (const warning of stored.receipt.warnings) console.log(`warning: ${warning}`);
    return;
  }
  if (action === "list" || action === "show" || action === "compare") {
    const {positional: [id, runId], parsed} = options(rest, action === "show" ? 2 : 1, action === "compare" ? ["--left", "--right", "--mode"] : [], ["--json"]);
    let result;
    if (action === "list") result = getEvidenceIndex(id!);
    else if (action === "show") result = getEvidenceRun(id!, runId!);
    else {
      const left = parsed.get("--left"); const right = parsed.get("--right"); const mode = parsed.get("--mode") ?? "runs";
      if (!left || !right || (mode !== "runs" && mode !== "base-head")) throw new Error("Comparison requires --left <run> --right <run> and optional --mode runs|base-head.");
      result = compareEvidence(id!, left, right, mode);
    }
    refreshBrief(id!);
    console.log(parsed.has("--json") ? JSON.stringify(result) : JSON.stringify(result, null, 2));
    return;
  }
  throw new Error("Usage: review-canvas evidence record|import|list|show|compare <review-id> …");
}

export async function main(argv: string[]) {
  const [cmd, ...args] = argv;
  switch (cmd) {
    case "evidence":
      return evidenceCommand(args);
    case "revisions": {
      const {positional: [id], parsed} = options(args, 1, ["--baseline"], ["--json"]);
      const result = await getRevisions(id!, parsed.get("--baseline"));
      refreshBrief(id!);
      console.log(parsed.has("--json") ? JSON.stringify(result) : JSON.stringify(result, null, 2));
      return;
    }
    case "deployment": {
      const [action, ...rest] = args;
      if (action !== "show" && action !== "import") throw new Error("Usage: review-canvas deployment import <id> <file.json> | show <id> [--json]");
      const {positional: [id, path], parsed} = options(rest, action === "import" ? 2 : 1, [], action === "show" ? ["--json"] : []);
      const result = action === "import" ? importDeployment(id!, readFileSync(path!)) : getDeployment(id!);
      refreshBrief(id!);
      console.log(parsed.has("--json") ? JSON.stringify(result) : JSON.stringify(result, null, 2));
      return;
    }
    case "prepare": {
      if (!args[0]) throw new Error("Usage: review-canvas prepare <pr-url>");
      const { analysis, coursePath, briefPath } = await prepare(args[0]);
      const onCourseCount = analysis.files.filter(onCourse).length;
      console.log(`Review id: ${analysis.id}`);
      console.log(`PR: ${analysis.pr.owner}/${analysis.pr.repo}#${analysis.pr.number} ${analysis.pr.title}`);
      console.log(`Files: ${analysis.files.length} (${onCourseCount} on the course), static links: ${analysis.links.length}`);
      console.log(`Brief (read this): ${briefPath}`);
      console.log(`Course (edit this): ${coursePath}`);
      console.log(`Then run: review-canvas publish ${analysis.id}`);
      return;
    }
    case "publish": {
      if (!args[0]) throw new Error("Usage: review-canvas publish <id> [course.json]");
      const review = publish(args[0], args[1]);
      for (const w of review.warnings) console.log(`warning: ${w}`);
      await up();
      const stops = review.course.goals.reduce((n, g) => n + g.stops.length, 0);
      console.log(`Published ${review.course.goals.length} goal(s), ${stops} stop(s), ${review.course.unclaimed.length} unclaimed, ${review.agentLinks.length} agent link(s) accepted.`);
      console.log(`Open: ${reviewUrl(review.analysis.id)}`);
      return;
    }
    case "open": {
      if (!args[0]) throw new Error("Usage: review-canvas open <pr-url>");
      const { analysis } = await prepare(args[0]);
      await up();
      console.log(`Open: ${reviewUrl(analysis.id)}`);
      return;
    }
    case "demo": {
      const review = loadDemo();
      for (const w of review.warnings) console.log(`warning: ${w}`);
      await up();
      console.log("Loaded synthetic viewer fixtures; these are not recorded execution results.");
      console.log(`Open: ${reviewUrl(review.analysis.id)}`);
      return;
    }
    case "show": {
      const [id, target] = args;
      const analysis = id ? loadAnalysis(id) : null;
      if (!analysis || !target) throw new Error("Usage: review-canvas show <id> <file-or-hunk-id>");
      const file = analysis.files.find((f) => f.id === target || f.hunks.some((h) => h.id === target));
      if (!file) throw new Error(`No file or hunk "${target}" in ${id}.`);
      console.log(`${file.id} ${file.path}`);
      for (const h of file.hunks.filter((h) => h.id === target || file.id === target)) {
        console.log(`\n${h.id} ${h.range} ${h.section}`);
        for (const l of h.lines) console.log((l.kind === "add" ? "+" : l.kind === "del" ? "-" : " ") + l.text);
      }
      return;
    }
    case "cat": {
      const [id, path] = args;
      const analysis = id ? loadAnalysis(id) : null;
      if (!analysis || !path) throw new Error("Usage: review-canvas cat <id> <path>");
      process.stdout.write(await fetchFileAt(analysis.pr, analysis.pr.headSha, path));
      return;
    }
    case "url":
      if (!args[0]) throw new Error("Usage: review-canvas url <id>");
      console.log(reviewUrl(args[0]));
      return;
    case "up":
      await up();
      console.log(`Running at ${baseUrl()}`);
      return;
    case "serve": {
      const app = await buildApp({ logger: true });
      await app.listen({ host: "127.0.0.1", port: port() });
      mkdirSync(home(), { recursive: true });
      writeFileSync(pidFile(), String(process.pid));
      return;
    }
    case "stop":
      await stop();
      console.log("Stopped.");
      return;
    case "restart":
      await stop();
      await up();
      console.log(`Running at ${baseUrl()}`);
      return;
    case "setup": {
      const config = readConfig();
      const flag = args.indexOf("--public-url");
      if (flag >= 0 && args[flag + 1]) config.publicUrl = args[flag + 1]!;
      else {
        const name = tailscaleName();
        execFileSync("tailscale", ["serve", "--bg", `--https=${config.port}`, `http://127.0.0.1:${config.port}`], { stdio: "inherit" });
        config.publicUrl = `https://${name}:${config.port}`;
      }
      writeConfig(config);
      console.log(`Reviews open at ${config.publicUrl}`);
      return;
    }
    default:
      console.log(USAGE);
      if (cmd && cmd !== "help" && cmd !== "--help") process.exitCode = 1;
  }
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch((e: unknown) => {
  console.error(e instanceof GhError || e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
