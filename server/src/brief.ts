import { LAYER_INFO, onCourse, testStarts, type Analysis, type CourseInput, type PrFile } from "@review-canvas/shared";

// The brief is what the agent reads before planning the course. It carries every id the agent
// may use, the diff of every hunk it should summarize, and the links the server already found,
// and it leaves out bulk the agent has no judgement to add to (generated files).

const MAX_HUNK_LINES = 200;

function fileHeading(f: PrFile, byId: Map<string, PrFile>) {
  const bits = [`${LAYER_INFO[f.layer].name}`, `+${f.additions} −${f.deletions}`, f.status];
  if (f.subjectOf) bits.push(`test of ${f.subjectOf} (${byId.get(f.subjectOf)?.path})`);
  if (f.generatedFrom) bits.push(`generated from ${f.generatedFrom} (${byId.get(f.generatedFrom)?.path})`);
  if (f.noise && f.noise !== "generated") bits.push(`noise filter: ${f.noise}`);
  return `### ${f.id} \`${f.path}\`\n${bits.join(" · ")}`;
}

/** Generated output (orval clients, schema dumps, translation key types) needs no notes. */
export const isGeneratedOutput = (f: PrFile) => f.noise === "api" || !!f.generatedFrom;

function hunkBlock(f: PrFile, full: boolean, reviewId: string) {
  if (f.patchMissing) return "_GitHub sent no patch (binary or too large)._";
  if (!full) return `_${f.hunks.length} hunk(s): ${f.hunks.map((h) => h.id).join(", ")}. Generated; no notes needed._`;
  return f.hunks
    .map((h) => {
      const lines = h.lines.map((l) => (l.kind === "add" ? "+" : l.kind === "del" ? "-" : " ") + l.text);
      const shown = lines.slice(0, MAX_HUNK_LINES);
      if (lines.length > MAX_HUNK_LINES) shown.push(`… ${lines.length - MAX_HUNK_LINES} more lines: run \`review-canvas show ${reviewId} ${h.id}\``);
      const tests = f.noise === "tests" ? testStarts(h).map((t) => `"${t.name}"`) : [];
      const names = tests.length ? `\nTests in it (crop one with \`${h.id}@<part of the name>\`): ${tests.join(", ")}` : "";
      return `#### ${h.id} ${h.range} ${h.section}${names}\n\`\`\`diff\n${shown.join("\n")}\n\`\`\``;
    })
    .join("\n\n");
}

/** Ticket ids in a title, branch or body: `user/e-51-title` holds `E-51`. Matched without regard to case. */
export const TICKET_ID = /[A-Za-z]+-\d+/;

const jobSection = (reviewId: string, coursePath: string, headRef: string) => `## Your job

Turn this PR into a review a person can walk goal by goal. Edit the JSON at \`${coursePath}\` (it has a
summary slot for every chunk on the course and no goals yet), then publish it.

### 1. Find the goals

The goals are what the work was asked to do. Look for a ticket id in the PR title, the branch name
(\`${headRef}\`) and the PR description. The pattern is \`${TICKET_ID.source}\`, matched
case-insensitively: \`user/e-51-title\` holds ticket \`E-51\`. Upper-case it before you use it.

- If the Linear MCP is available, call \`get_issue\` with that id and read the ticket: its title,
  description and acceptance criteria. Use the id, upper-cased, as each goal's \`src\`.
- If there is no id, or Linear is not available or does not find the ticket, take the goals from
  the PR description above and use \`PR\` as \`src\`.

One goal per acceptance criterion (or per outcome the description promises). \`title\` is the
criterion in a few words, \`quote\` is its text verbatim from the ticket or description, \`src\` is the
tag above. \`sentence\` is the PR in one sentence.

### 2. Give each goal its stops

\`stops\` lists what a reviewer reads to check the goal, in reading order: the code, then
boilerplate (a migration's index, trigger SQL, route registration, locale strings), then tests.
A stop is a chunk id (\`f2.h2\`) or one test cropped out of a test chunk (\`f3.h1@keeps retrying\`,
where the text after \`@\` is part of the test name; the test names of each test chunk are listed in
its heading below). Several goals can cite the same chunk.

Cite a chunk on a goal only when the goal's quote needs that change. When unsure, leave it uncited:
it lands in "Changes no goal asked for", which is where a reviewer looks for scope creep. List the
chunks you know no goal asked for in \`unclaimed\`; chunks nobody cites are added there anyway, with
a warning.

- Good: goal "Failed syncs can be retried from the admin" cites \`f18.h1\` (the \`retry\` action) and
  \`f2.h2\` (\`retry!\`), because its quote needs both.
- Bad: the same goal also cites \`f4.h2\` (the \`backoff\` helper) because retries "involve" the job.
  Nothing in the quote asks for backoff, so leave \`f4.h2\` uncited.

Translations (locale files) are on the course and can be stops. Generated output and generated API
clients are out of bounds: they are listed at the end, they are not stops, and the server ignores
any you cite.

Tests are stops too. Prefer the single test that proves the goal, as a crop, over the whole test
chunk. A goal no test proves gets a \`gap\` sentence saying so ("No test covers the digest email
being skipped when nothing failed."). A goal needs at least one stop or a \`gap\`.

### 3. Write a summary for every chunk

\`hunks.<id>.summary\` for every chunk on the course, and \`hunks.<id>.lines\` for line notes.

Who reads these: an engineer who knows the codebase partly (about 60% of the context) reviewing a
large PR. They can read code. A note must give them something the line itself doesn't say plainly.

#### Chunk summary (every chunk)

- Every chunk gets a \`summary\`, tests and trivial chunks included.
- It describes the change in this chunk as a whole: imperative, commit-subject style, ≤ 90 chars,
  backticks around identifiers, no reasoning or "so that/because".
- Prefer product/domain meaning when the code makes it available; for plumbing say what it wires up
  ("Pass the sync's last error to the digest mailer", "Register the retry route under admin
  syncs"). Trivial chunks still get one: "Import \`SyncStatusBadge\`".
- Large chunks: describe the whole change, e.g. "Add the \`retrying\` and \`failed\` statuses, a
  five-attempt limit and the \`retry!\` action to \`OrderSync\`".
- Test chunks: say what the tests in this chunk check as a set ("Test that a sync fails on the fifth
  attempt and keeps retrying before it"). Helper-only test chunks: "Add a \`failed_sync\` helper that
  takes an attempt count".
- Don't let a summary restate a single line note on a one-line chunk; put the text in the summary and
  drop the line note.

#### Line notes (sparse)

- The test for every line note: cover the note and read the line. If the line already says it, delete
  the note. Never write: "Add \`failed_since\` scope" on \`scope :failed_since, ->(time) { … }\`; "Run
  \`retry!\` as a job" on a line that calls \`OrderSyncJob.perform_later(id)\`; "Import \`X\`"; "Add
  \`error\` param" on a signature that visibly adds \`error\`.
- Line notes worth keeping say one of:
  - what the change does in product terms when the code doesn't make it obvious ("Wait 2, 4, 8, 16
    minutes between attempts" on \`(2**attempts).minutes\`);
  - a behaviour change hidden in a small edit (a default flipped, a condition widened, a nil now
    allowed, an order changed, a status code chosen), e.g. "Clear the last error once a sync
    succeeds" on \`update!(status: :synced, last_error: nil)\`;
  - which line is the heart of the chunk when the chunk is long and the key line is easy to miss
    ("Give up and mark the sync failed after five attempts" on \`if attempts >= MAX_ATTEMPTS\`).
- Anchor to the line that does the work (the call, the assignment, the condition, the new param, the
  new column). Never on lines that only open or close structure: \`class\`, \`def\`, \`do\`, \`end\`, braces,
  imports, blank lines.
- A chunk may carry several line notes when that helps; most chunks carry none.
- Imperative, commit-subject style, ≤ 60 chars, backticks around identifiers, no reasoning.
- At most 3 notes per chunk in total, summary included. Never repeat the same thing in the summary
  and a line note.

A line note is \`{"side": "RIGHT", "line": <line number in the file at head>, "text": "…"}\`. Use
\`"side": "LEFT"\` with the old line number only for a note on a deleted line. A line that is not a
line of that chunk is dropped with a warning.

### 4. Links

\`links\` is optional: relationships the server missed, between hunks in different files. Give the
exact \`symbol\`: it must appear as a whole word (case-sensitive) in some line of both hunks,
context lines included, or the server rejects the link. A pair of hunks already linked below is
skipped, whatever the symbol.

### 5. Publish and fix the warnings

Publishing repairs what it can and prints a warning for each repair. Read them, fix \`${coursePath}\`
and publish again:

- An unknown chunk id, or a stop in an out-of-bounds file, was dropped.
- A crop that matches no test, or more than one, fell back to the whole chunk; the warning lists the
  test names found.
- A chunk on the course that no goal cited was added to "Changes no goal asked for". Cite it if a
  goal needs it, otherwise leave it.
- A line note on a line that is not in its chunk was dropped.
- A goal with no stops and no \`gap\` was dropped.

Length limits are errors, not warnings, and publishing stops until you fix them: \`summary\` ≤ 90,
at most 3 entries in \`lines\`, a line note's \`text\` ≤ 200 (aim for 60), \`title\` ≤ 120, \`src\` ≤ 40,
\`quote\` ≤ 600, \`gap\` ≤ 300, \`sentence\` ≤ 300.

Write plainly. No marketing words, no restating the diff line by line.

The repository is not checked out. To read more than the diff shows:
\`review-canvas show ${reviewId} <file-or-hunk-id>\` prints a whole hunk or file diff, and
\`review-canvas cat ${reviewId} <path>\` prints a file as it is at the head commit.`;

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
    jobSection(analysis.id, coursePath, pr.headRef),
    `## Files on the course (${course.length})\n\n${course
      .map((f) => `${fileHeading(f, byId)}\n\n${hunkBlock(f, !isGeneratedOutput(f), analysis.id)}`)
      .join("\n\n")}`,
    analysis.links.length
      ? `## Links the server already found (${analysis.links.length})\n\nDo not repeat these.\n\n${analysis.links
          .map((l) => `- ${l.from} (${hunkFile.get(l.from)?.path}) → ${l.to} (${hunkFile.get(l.to)?.path}): ${l.label} [\`${l.symbol}\`]`)
          .join("\n")}`
      : "",
    out.length ? `## Out of bounds, not stops (${out.length})\n\n${out.map((f) => `- \`${f.path}\`: ${f.noiseReason ?? f.status}`).join("\n")}` : "",
  ];
  return sections.filter(Boolean).join("\n\n") + "\n";
}

/** A course the agent edits in place: no goals yet, and a summary slot for every on-course chunk. */
export function courseTemplate(analysis: Analysis): CourseInput {
  const hunks: CourseInput["hunks"] = {};
  for (const f of analysis.files.filter(onCourse)) for (const h of f.hunks) hunks[h.id] = { summary: "", lines: [] };
  return { sentence: "", goals: [], unclaimed: [], hunks, links: [] };
}
