import { layerOf, noiseOf, subjectPathCandidates } from "./classify.js";
import { langOf, parsePatch } from "./diff.js";
import { staticLinks } from "./links.js";
import type { Analysis, FileStatus, PrFile, PrMeta } from "./types.js";

/** The fields this app reads from GitHub's pull request API. */
export interface GhPull {
  number: number;
  html_url: string;
  title: string;
  body: string | null;
  user: { login: string } | null;
  base: { ref: string; repo: { name: string; owner: { login: string } } };
  head: { ref: string; sha: string };
  additions: number;
  deletions: number;
  changed_files: number;
}

/** The fields this app reads from GitHub's pull request files API. */
export interface GhFile {
  filename: string;
  previous_filename?: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export const reviewId = (pr: Pick<PrMeta, "repo" | "number" | "headSha">) =>
  `${pr.repo}-${pr.number}-${pr.headSha.slice(0, 7)}`.replace(/[^A-Za-z0-9._-]/g, "-");

/**
 * Builds the deterministic part of a review. `heads` holds the first bytes of each file at the
 * head commit, where the server could read them, so generated-file markers can be seen even
 * when the patch does not start at the top of the file.
 */
export function buildAnalysis(pull: GhPull, ghFiles: GhFile[], heads: Record<string, string | null>, now = new Date()): Analysis {
  const pr: PrMeta = {
    owner: pull.base.repo.owner.login,
    repo: pull.base.repo.name,
    number: pull.number,
    url: pull.html_url,
    title: pull.title,
    body: pull.body ?? "",
    author: pull.user?.login ?? "unknown",
    baseRef: pull.base.ref,
    headRef: pull.head.ref,
    headSha: pull.head.sha,
    additions: pull.additions,
    deletions: pull.deletions,
    changedFiles: pull.changed_files,
  };

  const files: PrFile[] = ghFiles.map((f, i) => {
    const id = `f${i + 1}`;
    const head = heads[f.filename] ?? firstLines(f.patch);
    const noise = noiseOf(f.filename, head);
    const file: PrFile = {
      id,
      path: f.filename,
      status: f.status as FileStatus,
      additions: f.additions,
      deletions: f.deletions,
      lang: langOf(f.filename),
      layer: layerOf(f.filename),
      noise: noise?.kind ?? null,
      patchMissing: !f.patch,
      hunks: f.patch ? parsePatch(id, f.patch) : [],
    };
    if (f.previous_filename) file.previousPath = f.previous_filename;
    if (noise) file.noiseReason = noise.reason;
    return file;
  });

  attachTests(files);
  attachGenerated(files);

  return { version: 1, id: reviewId(pr), pr, files, links: staticLinks(files), createdAt: now.toISOString() };
}

/** For new files the patch starts at line 1, which is enough to see a generated header. */
function firstLines(patch: string | undefined): string | null {
  if (!patch || !patch.startsWith("@@ -0,0 ")) return null;
  return patch
    .split("\n")
    .slice(1, 12)
    .map((l) => l.slice(1))
    .join("\n");
}

function attachTests(files: PrFile[]) {
  const byPath = new Map(files.map((f) => [f.path, f]));
  for (const file of files) {
    if (file.noise !== "tests") continue;
    const subject = subjectPathCandidates(file.path)
      .map((p) => byPath.get(p))
      .find((f) => f && f.noise !== "tests");
    if (subject) file.subjectOf = subject.id;
  }
}

const tokens = (path: string) =>
  new Set(
    (path.split("/").pop() ?? "")
      .replace(/\.[^.]+(\.[^.]+)?$/, "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2),
  );

/** Generated files point back at the hand-written source in the same PR, when there is one. */
function attachGenerated(files: PrFile[]) {
  const sources = (re: RegExp) => files.filter((f) => re.test(f.path) && f.noise === null);
  const tsp = sources(/^typespec\/.*\.tsp$/);
  const migrations = sources(/^db\/migrate\//);
  const locales = files.filter((f) => /^config\/locales\/.*\.ya?ml$/.test(f.path));

  for (const file of files) {
    let from: PrFile | undefined;
    if (file.noise === "api" && tsp.length) from = bestMatch(file, tsp);
    else if (/^db\/(schema\.rb|structure\.sql)$/.test(file.path)) from = migrations.at(-1);
    else if (/translationKeys\.d\.ts$/.test(file.path)) from = locales.find((l) => /\/en\.ya?ml$/.test(l.path)) ?? locales[0];
    if (from && from.id !== file.id) file.generatedFrom = from.id;
  }
}

function bestMatch(file: PrFile, candidates: PrFile[]): PrFile {
  const mine = tokens(file.path);
  let best = candidates[0]!;
  let score = -1;
  for (const c of candidates) {
    let s = 0;
    for (const t of tokens(c.path)) if (mine.has(t) || [...mine].some((m) => m.includes(t))) s++;
    if (s > score) [best, score] = [c, s];
  }
  return best;
}
