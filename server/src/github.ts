import { spawn } from "node:child_process";
import { isUtf8 } from "node:buffer";
import { noiseOf, type GhFile, type GhPull, type Draft, type PrMeta, type Verdict, type RevisionTreeEntry } from "@review-canvas/shared";

// All GitHub access goes through the `gh` CLI, so the app uses the reviewer's own login and
// never stores a token.

export class GhError extends Error {}

/** Encodes each path segment, so a `?`, `#` or `&` in a file name cannot change the query or the ref. */
export const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

function gh(args: string[], input?: string, maxBytes?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", args, { stdio: ["pipe", "pipe", "pipe"] });
    const output: Buffer[] = [];
    let err = "";
    let bytes = 0;
    child.stdout.on("data", (d: Buffer) => {
      bytes += d.length;
      if (maxBytes !== undefined && bytes > maxBytes) {
        reject(new GhError("Source exceeds the 1 MiB size limit."));
        child.kill();
        return;
      }
      output.push(d);
    });
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", (e) => reject(new GhError(`Could not run gh: ${e.message}. Install the GitHub CLI and run \`gh auth login\`.`)));
    child.on("close", (code) => {
      if (code !== 0) return reject(new GhError(err.trim() || `gh exited with ${code}`));
      const buffer = Buffer.concat(output);
      if (maxBytes !== undefined && !isUtf8(buffer)) return reject(new GhError("Binary non-UTF-8 source is unavailable."));
      resolve(buffer.toString("utf8"));
    });
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
        const raw = await gh(["api", "-H", "Accept: application/vnd.github.raw", `repos/${ref.owner}/${ref.repo}/contents/${encodePath(f.filename)}?ref=${sha}`]);
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
export function fetchFileAt(ref: PrRef, sha: string, path: string, maxBytes?: number): Promise<string> {
  return gh(["api", "-H", "Accept: application/vnd.github.raw", `repos/${ref.owner}/${ref.repo}/contents/${encodePath(path)}?ref=${sha}`], undefined, maxBytes);
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

export interface GitHubTreeResponse {
  tree: RevisionTreeEntry[];
  truncated: boolean;
}
export interface GitHubReadTransport {
  readTree(ref: PrRef, sha: string, recursive: boolean): Promise<GitHubTreeResponse>;
  readFile(ref: PrRef, sha: string, path: string): Promise<string>;
}
export const githubReadTransport: GitHubReadTransport = {
  readTree: async (ref, sha, recursive) => JSON.parse(await gh(["api", `repos/${ref.owner}/${ref.repo}/git/trees/${sha}${recursive ? "?recursive=1" : ""}`])) as GitHubTreeResponse,
  readFile: (ref, sha, path) => fetchFileAt(ref, sha, path, 1024 * 1024),
};

/** Recursive truncation is never a complete inventory; walk each subtree explicitly. */
export async function fetchExactTree(ref: PrRef, sha: string, transport: Pick<GitHubReadTransport, "readTree"> = githubReadTransport): Promise<RevisionTreeEntry[]> {
  const initial = await transport.readTree(ref, sha, true);
  if (!initial.truncated) return initial.tree.filter(entry => entry.type !== "tree").sort((a, b) => a.path.localeCompare(b.path));
  const entries: RevisionTreeEntry[] = [];
  async function walk(treeSha: string, prefix: string) {
    const response = await transport.readTree(ref, treeSha, false);
    if (response.truncated) throw new GhError("Nonrecursive GitHub tree is truncated; exact inventory is unavailable.");
    for (const entry of response.tree) {
      const path = prefix + entry.path;
      if (entry.type === "tree") await walk(entry.sha, `${path}/`);
      else entries.push({...entry, path});
    }
  }
  await walk(sha, "");
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}
