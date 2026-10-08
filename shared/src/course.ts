import { hunkMentions } from "./links.js";
import type { CourseInput } from "./schemas.js";
import { LAYERS, type Analysis, type Course, type Link, type PrFile, type Review } from "./types.js";

/** Files that can be on the course. Always-generated files are out of bounds for everyone. */
export const onCourse = (f: PrFile) => f.noise !== "generated";

/** The file a dependent rides with: a test with its subject, generated output with its source. */
export const parentOf = (f: PrFile): string | undefined => f.subjectOf ?? f.generatedFrom;

/** Order when no agent course exists: by layer, sources before their dependents, then by path. */
export function defaultOrder(analysis: Analysis): string[] {
  const rank = (f: PrFile) => LAYERS.indexOf(f.layer);
  return analysis.files
    .filter(onCourse)
    .slice()
    .sort((a, b) => rank(a) - rank(b) || Number(!!parentOf(a)) - Number(!!parentOf(b)) || a.path.localeCompare(b.path))
    .map((f) => f.id);
}

/**
 * Makes any proposed order complete and consistent: drops unknown and out-of-bounds ids and
 * duplicates, appends forgotten files in the default order, and moves each dependent directly
 * after the file it rides with, so a test always sits beside its subject.
 */
export function normalizeOrder(analysis: Analysis, proposed: string[], warnings: string[] = []): string[] {
  const byId = new Map(analysis.files.map((f) => [f.id, f]));
  const seen = new Set<string>();
  const order: string[] = [];
  for (const id of proposed) {
    const f = byId.get(id);
    if (!f) {
      warnings.push(`order: unknown file id "${id}" was ignored.`);
      continue;
    }
    if (!onCourse(f)) {
      warnings.push(`order: ${f.path} is out of bounds (${f.noiseReason ?? "generated"}) and was left off the course.`);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  const missing = defaultOrder(analysis).filter((id) => !seen.has(id));
  if (missing.length) {
    warnings.push(`order: ${missing.length} file(s) were missing and were appended by layer: ${missing.map((id) => byId.get(id)!.path).join(", ")}.`);
    order.push(...missing);
  }

  const dependents = new Map<string, string[]>();
  const roots: string[] = [];
  for (const id of order) {
    const parent = parentOf(byId.get(id)!);
    if (parent && seen.has(parent) && parent !== id) {
      const list = dependents.get(parent) ?? [];
      list.push(id);
      dependents.set(parent, list);
    } else roots.push(id);
  }
  return roots.flatMap((id) => [id, ...(dependents.get(id) ?? [])]);
}

export function defaultCourse(analysis: Analysis): Course {
  return { route: "", order: normalizeOrder(analysis, defaultOrder(analysis)), files: {}, hunks: {} };
}

/** Checks an agent's course against the analysis. Nothing the agent says is taken on trust. */
export function mergeCourse(analysis: Analysis, input: CourseInput, now = new Date()): Review {
  const warnings: string[] = [];
  const files = new Map(analysis.files.map((f) => [f.id, f]));
  const hunks = new Map(analysis.files.flatMap((f) => f.hunks.map((h) => [h.id, { hunk: h, file: f }] as const)));

  const course: Course = {
    route: input.route,
    order: normalizeOrder(analysis, input.order, warnings),
    files: {},
    hunks: {},
  };
  for (const [id, notes] of Object.entries(input.files)) {
    if (files.has(id)) course.files[id] = notes;
    else warnings.push(`files: unknown file id "${id}" was ignored.`);
  }
  for (const [id, summary] of Object.entries(input.hunks)) {
    if (hunks.has(id)) course.hunks[id] = summary;
    else warnings.push(`hunks: unknown hunk id "${id}" was ignored.`);
  }

  const existing = new Set(analysis.links.map((l) => `${l.from}>${l.to}`));
  const agentLinks: Link[] = [];
  for (const link of input.links) {
    const from = hunks.get(link.from);
    const to = hunks.get(link.to);
    if (!from || !to) {
      warnings.push(`links: ${link.from} → ${link.to} names a hunk that does not exist; rejected.`);
      continue;
    }
    if (from.file.id === to.file.id) {
      warnings.push(`links: ${link.from} → ${link.to} stays inside one file; rejected.`);
      continue;
    }
    if (!hunkMentions(from.hunk, link.symbol) || !hunkMentions(to.hunk, link.symbol)) {
      warnings.push(`links: "${link.symbol}" does not appear in both ${link.from} and ${link.to}; rejected.`);
      continue;
    }
    if (existing.has(`${link.from}>${link.to}`)) continue;
    existing.add(`${link.from}>${link.to}`);
    agentLinks.push({ id: `A${agentLinks.length + 1}`, from: link.from, to: link.to, label: link.label, symbol: link.symbol, source: "agent" });
  }

  return { analysis, course, agentLinks, defaultCourse: false, warnings, publishedAt: now.toISOString() };
}

export function draftReview(analysis: Analysis): Review {
  return { analysis, course: defaultCourse(analysis), agentLinks: [], defaultCourse: true, warnings: [], publishedAt: null };
}
