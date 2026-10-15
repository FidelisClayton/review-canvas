import { cropTests } from "./crop.js";
import { hunkMentions } from "./links.js";
import type { CourseInput } from "./schemas.js";
import type { Analysis, Course, Goal, Hunk, Link, PrFile, Review, Stop } from "./types.js";

/** Files that can be stops. Generated output and API clients are out of bounds (viewable, never stops). */
export const onCourse = (f: PrFile) => f.noise !== "generated" && f.noise !== "api";

const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "goal";

/** Checks an agent's course against the analysis. Nothing the agent says is taken on trust. */
export function mergeCourse(analysis: Analysis, input: CourseInput, now = new Date()): Review {
  const warnings: string[] = [];
  const hunks = new Map(analysis.files.flatMap((f) => f.hunks.map((h) => [h.id, { hunk: h, file: f }] as const)));

  // "f3.h1" is the whole chunk; "f3.h1@text" crops the one test whose name contains text.
  function resolve(ref: string, where: string): Stop | null {
    const at = ref.indexOf("@");
    const id = at < 0 ? ref : ref.slice(0, at);
    const entry = hunks.get(id);
    if (!entry) {
      warnings.push(`${where}: unknown hunk id "${id}" was ignored.`);
      return null;
    }
    const { hunk, file } = entry;
    if (!onCourse(file)) {
      warnings.push(`${where}: ${file.path} is out of bounds (${file.noiseReason ?? "generated"}) and cannot be a stop; ${id} was ignored.`);
      return null;
    }
    const test = file.noise === "tests";
    const whole: Stop = { hunkId: id, from: 0, to: hunk.lines.length - 1, test };
    if (at < 0) return whole;
    const needle = ref.slice(at + 1);
    const { crops, names } = cropTests(hunk, needle);
    if (crops.length === 1) return { hunkId: id, from: crops[0]!.from, to: crops[0]!.to, test: true, name: crops[0]!.name };
    const found = names.length ? `tests found: ${names.map((n) => `"${n}"`).join(", ")}` : "no tests found in it";
    warnings.push(`${where}: "${needle}" matches ${crops.length ? `${crops.length} tests` : "no test"} in ${id}; the whole chunk was used (${found}).`);
    return whole;
  }

  const taken = new Set(["unclaimed"]);
  const goals: Goal[] = [];
  for (const g of input.goals) {
    const where = `goals "${g.title}"`;
    const stops: Stop[] = [];
    const seen = new Set<string>();
    for (const ref of g.stops) {
      const stop = resolve(ref, where);
      if (!stop) continue;
      const key = stop.name === undefined ? stop.hunkId : `${stop.hunkId}@${stop.from}`;
      if (seen.has(key)) continue;
      seen.add(key);
      stops.push(stop);
    }
    // A chunk cited whole and cropped in one goal keeps the whole citation.
    const whole = new Set(stops.filter((s) => s.name === undefined).map((s) => s.hunkId));
    const kept = stops.filter((s) => s.name === undefined || !whole.has(s.hunkId));
    // Tests come last, in the order the agent gave them.
    const ordered = [...kept.filter((s) => !s.test), ...kept.filter((s) => s.test)];
    const empty = [!g.quote && "quote", !g.src && "src"].filter(Boolean);
    if (empty.length) warnings.push(`${where}: empty ${empty.join(" and ")}; give the ticket text verbatim and where it came from.`);
    if (!ordered.length && !g.gap) {
      warnings.push(`${where}: no stops and no gap sentence; the goal was dropped.`);
      continue;
    }
    let id = slug(g.title);
    for (let n = 2; taken.has(id); n += 1) id = `${slug(g.title)}-${n}`;
    taken.add(id);
    goals.push({ id, title: g.title, src: g.src, quote: g.quote, stops: ordered, ...(g.gap ? { gap: g.gap } : {}) });
  }

  // A crop counts its whole chunk as cited.
  const cited = new Set(goals.flatMap((g) => g.stops.map((s) => s.hunkId)));
  const unclaimed: Stop[] = [];
  for (const ref of input.unclaimed) {
    const stop = resolve(ref, "unclaimed");
    if (!stop || unclaimed.some((u) => u.hunkId === stop.hunkId)) continue;
    if (cited.has(stop.hunkId)) {
      warnings.push(`unclaimed: ${stop.hunkId} is cited by a goal, so it was left off the unclaimed stop.`);
      continue;
    }
    unclaimed.push(stop);
  }
  const forgotten: string[] = [];
  for (const f of analysis.files.filter(onCourse)) {
    for (const h of f.hunks) {
      if (cited.has(h.id) || unclaimed.some((u) => u.hunkId === h.id)) continue;
      unclaimed.push({ hunkId: h.id, from: 0, to: h.lines.length - 1, test: f.noise === "tests" });
      forgotten.push(`${h.id} (${f.path})`);
    }
  }
  if (forgotten.length) warnings.push(`unclaimed: ${forgotten.length} on-course chunk(s) were cited by no goal and were added to the unclaimed stop: ${forgotten.join(", ")}.`);

  const notes: Course["notes"] = {};
  for (const [id, note] of Object.entries(input.hunks)) {
    const entry = hunks.get(id);
    if (!entry) {
      warnings.push(`hunks: unknown hunk id "${id}" was ignored.`);
      continue;
    }
    if (!onCourse(entry.file)) {
      warnings.push(`hunks: ${entry.file.path} is out of bounds; the note for ${id} was ignored.`);
      continue;
    }
    const lines = note.lines.filter((l) => {
      if (anchored(entry.hunk, l)) return true;
      warnings.push(`hunks: ${id} line note on ${l.side} line ${l.line} is not a line of that chunk; dropped.`);
      return false;
    });
    notes[id] = { summary: note.summary, lines };
  }

  for (const f of analysis.files.filter(onCourse)) {
    for (const h of f.hunks) if (!notes[h.id]?.summary.trim()) warnings.push(`summary: ${h.id} (${f.path}) has no summary.`);
  }

  const course: Course = { sentence: input.sentence, goals, unclaimed, notes };

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

  return { version: 2, analysis, course, agentLinks, defaultCourse: false, warnings, publishedAt: now.toISOString() };
}

/** RIGHT notes sit on a line with a head line number; LEFT notes only on a deleted line. */
function anchored(hunk: Hunk, note: { side: "LEFT" | "RIGHT"; line: number }) {
  return hunk.lines.some((l) => (note.side === "RIGHT" ? l.newNo === note.line : l.kind === "del" && l.oldNo === note.line));
}

/** A review with no agent course: no goals and nothing unclaimed, so the canvas shows the map only. */
export function draftReview(analysis: Analysis): Review {
  return {
    version: 2,
    analysis,
    course: { sentence: "", goals: [], unclaimed: [], notes: {} },
    agentLinks: [],
    defaultCourse: true,
    warnings: [],
    publishedAt: null,
  };
}
