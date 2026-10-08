#!/usr/bin/env node
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildAnalysis, courseInputSchema, mergeCourse, type GhFile, type GhPull } from "@review-canvas/shared";
import { buildApp } from "./app.js";
import { courseTemplate, renderBrief } from "./brief.js";
import { baseUrl, home, port, readConfig, reviewUrl, writeConfig } from "./config.js";
import { fetchFiles, fetchHeads, fetchPull, GhError, parsePrRef } from "./github.js";
import { loadAnalysis, reviewPath, saveAnalysis, saveReview } from "./store.js";

const USAGE = `review-canvas: review a pull request on an infinite canvas

  review-canvas prepare <pr-url>          Fetch and analyze a PR. Prints the review id, the brief to
                                          read, and the course JSON to fill in.
  review-canvas publish <id> [course.json] Check the course against the analysis, save it, make sure
                                          the server runs, and print the URL to open.
  review-canvas open <pr-url>             prepare + publish the default course in one step (no agent).
  review-canvas url <id>                  Print the URL of a review.
  review-canvas up                        Start the server in the background if it is not running.
  review-canvas serve                     Run the server in the foreground.
  review-canvas stop | restart            Stop (or stop and start) the background server.
  review-canvas demo                      Load a synthetic PR with a planned course, to try the UI.
  review-canvas setup [--public-url URL]  Choose the URL reviews are opened at. With no URL, uses
                                          this machine's Tailscale name and runs \`tailscale serve\`.
`;

async function prepare(input: string) {
  const ref = parsePrRef(input);
  const pull = await fetchPull(ref);
  const files = await fetchFiles(ref);
  const heads = await fetchHeads(ref, pull.head.sha, files);
  const analysis = buildAnalysis(pull, files, heads);
  saveAnalysis(analysis);
  const coursePath = reviewPath(analysis.id, "course.json");
  const briefPath = reviewPath(analysis.id, "brief.md");
  writeFileSync(coursePath, JSON.stringify(courseTemplate(analysis), null, 2) + "\n");
  writeFileSync(briefPath, renderBrief(analysis, coursePath));
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

function publish(id: string, path?: string) {
  const analysis = loadAnalysis(id);
  if (!analysis) throw new Error(`No analysis for ${id}. Run \`review-canvas prepare <pr-url>\` first.`);
  const raw = JSON.parse(readFileSync(path ?? reviewPath(id, "course.json"), "utf8")) as unknown;
  const parsed = courseInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`The course JSON is invalid:\n${parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  }
  const review = mergeCourse(analysis, parsed.data);
  saveReview(review);
  return review;
}

function tailscaleName(): string {
  const status = JSON.parse(execFileSync("tailscale", ["status", "--json"], { encoding: "utf8" })) as { Self: { DNSName: string } };
  return status.Self.DNSName.replace(/\.$/, "");
}

async function main(argv: string[]) {
  const [cmd, ...args] = argv;
  switch (cmd) {
    case "prepare": {
      if (!args[0]) throw new Error("Usage: review-canvas prepare <pr-url>");
      const { analysis, coursePath, briefPath } = await prepare(args[0]);
      const onCourse = analysis.files.filter((f) => f.noise !== "generated").length;
      console.log(`Review id: ${analysis.id}`);
      console.log(`PR: ${analysis.pr.owner}/${analysis.pr.repo}#${analysis.pr.number} ${analysis.pr.title}`);
      console.log(`Files: ${analysis.files.length} (${onCourse} on the course), static links: ${analysis.links.length}`);
      console.log(`Brief (read this): ${briefPath}`);
      console.log(`Course (edit this): ${coursePath}`);
      console.log(`Then run: review-canvas publish ${analysis.id}`);
      return;
    }
    case "publish": {
      if (!args[0]) throw new Error("Usage: review-canvas publish <id> [course.json]");
      const review = publish(args[0], args[1]);
      await up();
      for (const w of review.warnings) console.log(`warning: ${w}`);
      console.log(`Published ${review.course.order.length} files, ${review.agentLinks.length} agent link(s) accepted.`);
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
      const root = new URL("../../test/fixtures/", import.meta.url);
      const { pull, files } = JSON.parse(readFileSync(new URL("sync-retries.json", root), "utf8")) as { pull: GhPull; files: GhFile[] };
      const analysis = buildAnalysis(pull, files, {});
      saveAnalysis(analysis);
      const review = publish(analysis.id, fileURLToPath(new URL("sync-retries.course.json", root)));
      await up();
      for (const w of review.warnings) console.log(`warning: ${w}`);
      console.log(`Open: ${reviewUrl(analysis.id)}`);
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

main(process.argv.slice(2)).catch((e: unknown) => {
  console.error(e instanceof GhError || e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
