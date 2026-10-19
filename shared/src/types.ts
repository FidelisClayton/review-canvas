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
 * What makes a file noise. "generated" (lockfiles, schema dumps, snapshots, files headed "do not
 * edit") and "api" (generated API clients) are out of bounds and never stops; tests and
 * translations stay on the course.
 */
export type NoiseKind = "tests" | "i18n" | "api" | "generated";

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
  /** Absent on legacy reviews; never inferred from the current base branch. */
  baseSha?: string;
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

/** One stop: lines `from` to `to` (inclusive indices into `hunk.lines`) of one changed chunk. */
export interface Stop {
  hunkId: string;
  from: number;
  to: number;
  /** The chunk is in a test file, or the stop is a single test cropped out of it. */
  test: boolean;
  /** Set when the stop is one test cropped out of its chunk; absent for the whole chunk. */
  name?: string;
}

export interface Goal {
  /** Slug of the title, made unique by the server. Reviewed marks are keyed by it. */
  id: string;
  title: string;
  /** Ticket id such as "E-51", or "PR". */
  src: string;
  /** The verbatim words the goal came from. */
  quote: string;
  /** Reading order: code, then boilerplate, then tests. */
  stops: Stop[];
  /** Said when no test proves the goal. */
  gap?: string;
}

export interface LineNote {
  side: "LEFT" | "RIGHT";
  line: number;
  text: string;
}

export interface ChunkNotes {
  summary: string;
  lines: LineNote[];
}

/** What the agent contributes: goals, the chunks that serve them, and words. */
export interface Course {
  sentence: string;
  goals: Goal[];
  /** On-course chunks no goal cites: the "Changes no goal asked for" stop. */
  unclaimed: Stop[];
  notes: Record<string, ChunkNotes>;
}

export interface Review {
  /** 2 is the goal-based course; a published review without it is the old file-based format. */
  version: 2;
  analysis: Analysis;
  course: Course;
  /** Agent-proposed links that passed the evidence check. */
  agentLinks: Link[];
  /** True when no agent course was published. */
  defaultCourse: boolean;
  warnings: string[];
  publishedAt: string | null;
  /** Set when the stored review is in the old format and must be republished. */
  outdated?: boolean;
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

export interface ReviewState {
  /** Stop key (hunk id, or `hunkId@from` for a crop) to when it was read. */
  read: Record<string, string>;
  /** Goal id to when it was marked reviewed. */
  reviewed: Record<string, string>;
  drafts: Draft[];
  verdict: Verdict;
  summary: string;
  submitted: { at: string; url: string; event: Verdict } | null;
}

export const emptyState = (): ReviewState => ({
  read: {},
  reviewed: {},
  drafts: [],
  verdict: "COMMENT",
  summary: "",
  submitted: null,
});

export interface ReviewPayload {
  review: Review;
  state: ReviewState;
}
