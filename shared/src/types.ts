// The words used across server, web and the agent skill. A review is one pull request at one
// head commit: the server's deterministic analysis plus the course an agent planned over it.

/** Layers are the terrain bands, top to bottom, in the order code usually flows. */
export const LAYERS = ["data", "domain", "jobs", "mail", "http", "frontend", "other"] as const;
export type LayerId = (typeof LAYERS)[number];

export const LAYER_INFO: Record<LayerId, { name: string; sub: string }> = {
  data: { name: "Data", sub: "migrations · models" },
  domain: { name: "Domain", sub: "services · events · lib" },
  jobs: { name: "Jobs", sub: "background work · tasks · schedules" },
  mail: { name: "Mail", sub: "mailers · templates" },
  http: { name: "HTTP", sub: "contracts · routes · policies · controllers" },
  frontend: { name: "Frontend", sub: "stores · components" },
  other: { name: "Config & docs", sub: "everything else" },
};

/**
 * Noise the reviewer can hide. "generated" is always out of bounds (lockfiles, schema dumps,
 * snapshots, files headed "do not edit"); the other three are filters the reviewer toggles.
 */
export const FILTERS = ["tests", "i18n", "api"] as const;
export type FilterId = (typeof FILTERS)[number];
export type NoiseKind = FilterId | "generated";

export type FileStatus = "added" | "modified" | "removed" | "renamed" | "copied" | "changed" | "unchanged";

export interface DiffLine {
  kind: "add" | "del" | "ctx";
  text: string;
  /** Line number on the base side; null for added lines. */
  oldNo: number | null;
  /** Line number on the head side; null for deleted lines. */
  newNo: number | null;
}

export interface Hunk {
  id: string;
  /** The `@@ -a,b +c,d @@` range, without the section heading. */
  range: string;
  /** Text after the range on the hunk header, usually the enclosing class or function. */
  section: string;
  lines: DiffLine[];
}

export interface PrFile {
  id: string;
  path: string;
  previousPath?: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  lang: string;
  layer: LayerId;
  noise: NoiseKind | null;
  /** Why the file is noise, in words the reviewer reads on the out-of-bounds tag. */
  noiseReason?: string;
  /** A test's subject when that subject is also in the PR; the test sits beside it. */
  subjectOf?: string;
  /** The hand-written source a generated file came from, when that source is in the PR. */
  generatedFrom?: string;
  /** GitHub omits patches for binary and very large files. */
  patchMissing: boolean;
  hunks: Hunk[];
}

export interface Link {
  id: string;
  /** Hunk that refers to the symbol. */
  from: string;
  /** Hunk that defines it. */
  to: string;
  label: string;
  symbol: string;
  source: "static" | "agent";
}

export interface PrMeta {
  owner: string;
  repo: string;
  number: number;
  url: string;
  title: string;
  body: string;
  author: string;
  baseRef: string;
  headRef: string;
  headSha: string;
  additions: number;
  deletions: number;
  changedFiles: number;
}

export interface Analysis {
  version: 1;
  id: string;
  pr: PrMeta;
  files: PrFile[];
  links: Link[];
  createdAt: string;
}

export interface FileNotes {
  what?: string;
  why?: string;
}

/** What the agent contributes: order and words. Never relationships without evidence. */
export interface Course {
  route: string;
  order: string[];
  files: Record<string, FileNotes>;
  hunks: Record<string, string>;
}

export interface Review {
  analysis: Analysis;
  course: Course;
  /** Agent-proposed links that passed the evidence check. */
  agentLinks: Link[];
  /** True when no agent course was published and the order is the server's default. */
  defaultCourse: boolean;
  warnings: string[];
  publishedAt: string | null;
}

export type Verdict = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

export interface Draft {
  id: string;
  hunkId: string;
  lineIndex: number;
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  body: string;
  createdAt: string;
}

export interface Punch {
  at: string;
  /** Time spent on the file before punching, when the reviewer punched the current file. */
  splitMs: number | null;
}

export interface ReviewState {
  punched: Record<string, Punch>;
  drafts: Draft[];
  verdict: Verdict;
  summary: string;
  submitted: { at: string; url: string; event: Verdict } | null;
}

export const emptyState = (): ReviewState => ({
  punched: {},
  drafts: [],
  verdict: "COMMENT",
  summary: "",
  submitted: null,
});

export interface ReviewPayload {
  review: Review;
  state: ReviewState;
}
