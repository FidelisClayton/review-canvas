import { defaultCourse, LAYER_INFO, onCourse, type Analysis, type CourseInput, type PrFile } from "@review-canvas/shared";

// The brief is what the agent reads before planning the course. It carries every id the agent
// may use, the diff of every hunk it should summarize, and the links the server already found,
// and it leaves out bulk the agent has no judgement to add to (generated files).

const MAX_HUNK_LINES = 80;

function fileHeading(f: PrFile, byId: Map<string, PrFile>) {
  const bits = [`${LAYER_INFO[f.layer].name}`, `+${f.additions} −${f.deletions}`, f.status];
  if (f.subjectOf) bits.push(`test of ${f.subjectOf} (${byId.get(f.subjectOf)?.path})`);
  if (f.generatedFrom) bits.push(`generated from ${f.generatedFrom} (${byId.get(f.generatedFrom)?.path})`);
  if (f.noise && f.noise !== "generated") bits.push(`noise filter: ${f.noise}`);
  return `### ${f.id} \`${f.path}\`\n${bits.join(" · ")}`;
}

function hunkBlock(f: PrFile, full: boolean) {
  if (f.patchMissing) return "_GitHub sent no patch (binary or too large)._";
  if (!full) return `_${f.hunks.length} hunk(s): ${f.hunks.map((h) => h.id).join(", ")}. Generated; no summary needed._`;
  return f.hunks
    .map((h) => {
      const lines = h.lines.map((l) => (l.kind === "add" ? "+" : l.kind === "del" ? "-" : " ") + l.text);
      const shown = lines.slice(0, MAX_HUNK_LINES);
      if (lines.length > MAX_HUNK_LINES) shown.push(`… ${lines.length - MAX_HUNK_LINES} more lines`);
      return `#### ${h.id} ${h.range} ${h.section}\n\`\`\`diff\n${shown.join("\n")}\n\`\`\``;
    })
    .join("\n\n");
}

export function renderBrief(analysis: Analysis, coursePath: string): string {
  const { pr } = analysis;
  const byId = new Map(analysis.files.map((f) => [f.id, f]));
  const hunkFile = new Map(analysis.files.flatMap((f) => f.hunks.map((h) => [h.id, f] as const)));
  const course = analysis.files.filter(onCourse);
  const out = analysis.files.filter((f) => !onCourse(f));

  const sections = [
    `# Review canvas brief: ${pr.owner}/${pr.repo}#${pr.number}`,
    `**${pr.title}** by ${pr.author} · ${pr.headRef} → ${pr.baseRef} · head ${pr.headSha.slice(0, 7)} · ${pr.changedFiles} files, +${pr.additions} −${pr.deletions}`,
    `Review id: \`${analysis.id}\``,
    pr.body ? `## PR description\n\n${pr.body.trim()}` : "",
    `## Your job

Plan the order a reviewer should read this PR in, and write short notes. Edit the JSON at
\`${coursePath}\` (it is pre-filled with a default order and every id), then publish it.

- \`route\`: two or three sentences on how the course runs and why, e.g. "Storage first, then the
  jobs that use it, the endpoint, then the UI."
- \`order\`: every file id below that is on the course, in reading order. Follow how data and
  calls flow: schema and models, domain, jobs, mail, contracts and HTTP, then the UI. Put the
  hand-written TypeSpec \`.tsp\` before the controllers that implement it. You do not need to place
  tests or generated files carefully: each one is moved directly after its subject or source.
- \`files.<id>.what\`: one sentence on what changed. \`files.<id>.why\`: one short sentence on why
  it comes at this point in the order ("Start here: everything below reads these columns.").
- \`hunks.<id>\`: one sentence per hunk, saying what it does or what to check. Point out risks
  plainly ("Nothing checks the sync is failed before retrying it.").
- \`links\`: optional extra relationships between hunks in different files, each with the exact
  \`symbol\` that appears in both. The server rejects any link whose symbol is not in both hunks.

Write plainly. No marketing words, no restating the diff line by line. Leave generated files'
notes empty.`,
    `## Files on the course (${course.length})\n\n${course
      .map((f) => `${fileHeading(f, byId)}\n\n${hunkBlock(f, f.noise !== "api")}`)
      .join("\n\n")}`,
    analysis.links.length
      ? `## Links the server already found (${analysis.links.length})\n\nDo not repeat these.\n\n${analysis.links
          .map((l) => `- ${l.from} (${hunkFile.get(l.from)?.path}) → ${l.to} (${hunkFile.get(l.to)?.path}): ${l.label} [\`${l.symbol}\`]`)
          .join("\n")}`
      : "",
    out.length ? `## Out of bounds (${out.length}, skipped for everyone)\n\n${out.map((f) => `- \`${f.path}\`: ${f.noiseReason ?? f.status}`).join("\n")}` : "",
  ];
  return sections.filter(Boolean).join("\n\n") + "\n";
}

/** A course the agent edits in place: default order, every id present, notes empty. */
export function courseTemplate(analysis: Analysis): CourseInput {
  const base = defaultCourse(analysis);
  const byId = new Map(analysis.files.map((f) => [f.id, f]));
  const files: CourseInput["files"] = {};
  const hunks: CourseInput["hunks"] = {};
  for (const id of base.order) {
    const f = byId.get(id)!;
    if (f.noise === "api") continue;
    files[id] = { what: "", why: "" };
    for (const h of f.hunks) hunks[h.id] = "";
  }
  return { route: "", order: base.order, files, hunks, links: [] };
}
