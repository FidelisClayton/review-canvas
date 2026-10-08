import { spawn } from "node:child_process";
import { noiseOf, type GhFile, type GhPull, type Draft, type PrMeta, type Verdict } from "@review-canvas/shared";

// All GitHub access goes through the `gh` CLI, so the app uses the reviewer's own login and
// never stores a token.

export class GhError extends Error {}

function gh(args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", (e) => reject(new GhError(`Could not run gh: ${e.message}. Install the GitHub CLI and run \`gh auth login\`.`)));
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new GhError(err.trim() || `gh exited with ${code}`))));
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

/** Accepts a PR URL, `owner/repo#123`, or `owner/repo/pull/123`. */
export function parsePrRef(input: string): PrRef {
  const s = input.trim();
  const url = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(s);
  const short = /^([\w.-]+)\/([\w.-]+)(?:#|\/pull\/)(\d+)$/.exec(s);
  const m = url ?? short;
  if (!m) throw new GhError(`"${input}" is not a pull request URL or owner/repo#number.`);
  return { owner: m[1]!, repo: m[2]!, number: Number(m[3]) };
}

export async function fetchPull(ref: PrRef): Promise<GhPull> {
  return JSON.parse(await gh(["api", `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`])) as GhPull;
}

export async function fetchFiles(ref: PrRef): Promise<GhFile[]> {
  // --slurp joins the pages into one array of pages.
  const pages = JSON.parse(await gh(["api", "--paginate", "--slurp", `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/files?per_page=100`])) as GhFile[][];
  return pages.flat();
}

/**
 * Reads the top of each file that path rules did not classify, so files headed "do not edit"
 * or "@generated" go out of bounds even when their diff starts far below the header.
 */
export async function fetchHeads(ref: PrRef, sha: string, files: GhFile[]): Promise<Record<string, string | null>> {
  const heads: Record<string, string | null> = {};
  const todo = files.filter((f) => f.status !== "removed" && !noiseOf(f.filename, null) && !f.patch?.startsWith("@@ -0,0 "));
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const f = todo[next++]!;
      try {
        const raw = await gh(["api", "-H", "Accept: application/vnd.github.raw", `repos/${ref.owner}/${ref.repo}/contents/${encodeURI(f.filename)}?ref=${sha}`]);
        heads[f.filename] = raw.slice(0, 1200);
      } catch {
        heads[f.filename] = null;
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return heads;
}


/** A file's full text at a commit. */
export function fetchFileAt(ref: PrRef, sha: string, path: string): Promise<string> {
  return gh(["api", "-H", "Accept: application/vnd.github.raw", `repos/${ref.owner}/${ref.repo}/contents/${encodeURI(path)}?ref=${sha}`]);
}

/** Posts one review with all draft comments. Only ever called from an explicit confirm in the UI. */
export async function submitReview(pr: PrMeta, event: Verdict, body: string, drafts: Draft[]): Promise<{ url: string }> {
  const payload = {
    commit_id: pr.headSha,
    event,
    body,
    comments: drafts.map((d) => ({ path: d.path, line: d.line, side: d.side, body: d.body })),
  };
  const res = JSON.parse(await gh(["api", "--method", "POST", `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/reviews`, "--input", "-"], JSON.stringify(payload))) as { html_url: string };
  return { url: res.html_url };
}
