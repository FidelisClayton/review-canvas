import { onCourse, parentOf } from "./course.js";
import { FILTERS, type FilterId, type Link, type PrFile, type Review } from "./types.js";

export type Filters = Record<FilterId, boolean>;

export interface OobItem {
  id: string;
  path: string;
  additions: number;
  deletions: number;
  reason: string;
  kind: "generated" | FilterId;
}

/** What the canvas draws for a review under the reviewer's current noise filters. */
export interface ReviewView {
  files: Map<string, PrFile>;
  hunkFile: Map<string, PrFile>;
  /** Visible on-course files, in course order. */
  order: string[];
  /** Control number per visible file. Dependents share their parent's number. */
  ctl: Record<string, string>;
  /** "test" or "gen" for files riding beneath a visible parent. */
  sub: Record<string, "test" | "gen" | undefined>;
  parent: Record<string, string | undefined>;
  oob: OobItem[];
  links: Link[];
}

export const isIgnored = (f: PrFile, filters: Filters) => !!f.noise && f.noise !== "generated" && filters[f.noise];

export function buildView(review: Review, filters: Filters): ReviewView {
  const files = new Map(review.analysis.files.map((f) => [f.id, f]));
  const hunkFile = new Map(review.analysis.files.flatMap((f) => f.hunks.map((h) => [h.id, f] as const)));
  const order = review.course.order.filter((id) => {
    const f = files.get(id);
    return f && onCourse(f) && !isIgnored(f, filters);
  });
  const visible = new Set(order);

  const ctl: ReviewView["ctl"] = {};
  const sub: ReviewView["sub"] = {};
  const parent: ReviewView["parent"] = {};
  let n = 0;
  for (const id of order) {
    const f = files.get(id)!;
    const p = parentOf(f);
    if (p && visible.has(p) && ctl[p]) {
      parent[id] = p;
      sub[id] = f.subjectOf ? "test" : "gen";
      ctl[id] = ctl[p]!;
    } else {
      n += 1;
      ctl[id] = String(n);
    }
  }

  const oob: OobItem[] = [];
  for (const f of review.analysis.files) {
    if (visible.has(f.id)) continue;
    const ignoredBy = f.noise && f.noise !== "generated" ? FILTERS.find((x) => x === f.noise) : undefined;
    oob.push({
      id: `oob-${f.id}`,
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      kind: ignoredBy ?? "generated",
      reason: ignoredBy ? `Hidden by your filter: ${f.noiseReason?.replace(/\.$/, "").toLowerCase() ?? ignoredBy}.` : (f.noiseReason ?? "Generated."),
    });
  }

  const links = [...review.analysis.links, ...review.agentLinks].filter((l) => {
    const a = hunkFile.get(l.from);
    const b = hunkFile.get(l.to);
    return a && b && visible.has(a.id) && visible.has(b.id);
  });

  return { files, hunkFile, order, ctl, sub, parent, oob, links };
}
