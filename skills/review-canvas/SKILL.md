---
name: review-canvas
description: Lay a GitHub pull request out on Review Canvas, a review organised by the goals of its Linear ticket, and hand back the link. Use when the user gives a PR URL or number and asks to review it on the canvas, to "open it in review canvas", to "plan the review", or to "give me a link to review this PR".
---

# Review Canvas

Review Canvas shows a pull request as a course of goals. Each goal is something the ticket asked
for: its quote, then the chunks of the diff that deliver it (code first, then boilerplate, then
tests) and the test that proves it, or a sentence saying nothing does. Chunks no goal asked for
land on a last stop, "Changes no goal asked for". The server does the deterministic work: it
fetches the PR with `gh`, parses chunks, hides generated output and API clients, and finds links in
the code. You do the judgement: the goals, the stops, and short notes on each chunk.

## Steps

1. **Prepare.** Run:

   ```bash
   review-canvas prepare <pr-url-or-owner/repo#number>
   ```

   It prints the review id, the brief to read, and the course JSON to fill in.

2. **Read the brief** (`brief.md`). It lists every chunk id with its diff (and, for test chunks,
   the test names you can crop), the links the server already found, and what is out of bounds
   (generated output and API clients: not stops). On large PRs, read it in chunks.

3. **Find the goals, then fill in the course** (`course.json`, pre-filled with a summary slot for
   every chunk on the course and no goals). Look for a ticket id in the PR title, branch name or
   description (pattern `\b[A-Za-z]+-\d+\b`, matched case-insensitively; `user/e-51-title` holds
   `E-51`). Upper-case it and read the ticket with the Linear MCP `get_issue` tool when you have
   it; try every match (branch, then title, then description) until `get_issue` finds one. With no id, or no Linear, take the goals from the PR description and use `PR` as each
   goal's `src`. The brief's "Your job" section is the full rulebook: one goal per acceptance
   criterion with its verbatim quote, stops in reading order (code, boilerplate, tests), the rule
   to cite a chunk only when the goal's quote needs it, crops (`f3.h1@test name`), gap sentences,
   the `unclaimed` list (list every chunk you left uncited on purpose), chunk summaries (≤ 90
   chars, every chunk), sparse line notes (aim for ≤ 60 chars; at most 3 line notes per chunk, the
   summary is separate) and the evidence rule for extra
   `links`. Follow it. Its two commands, `review-canvas show` and `review-canvas cat`, let you
   read past the diff without a checkout.

4. **Publish:**

   ```bash
   review-canvas publish <review-id>
   ```

   It checks the course against the analysis, repairs what it can, prints a warning for each repair,
   starts the server if needed, and prints the URL. Unknown chunk ids, crops that match no test or
   several, chunks neither cited by a goal nor listed in `unclaimed`, chunks with no summary, goals
   with an empty `quote` or `src`, dropped line notes and goals with no stops or gap all warn: fix
   `course.json` and publish again. Over-long summaries or notes are errors and block publishing
   until fixed.

5. **Reply with the URL**, the goals in a line each, and anything the reviewer should look at
   first (a goal with a gap, or chunks on "Changes no goal asked for"). If you found no ticket,
   say the goals came from the PR description (source tag "PR"). Do not paste the notes into chat;
   they are on the canvas.

## Notes

- Nothing is posted to GitHub by this skill. The reviewer drafts comments in the UI and posts
  them from there after an explicit confirmation.
- `review-canvas open <pr>` skips the agent and opens the PR with no goals or notes. Use it only
  when the user asks for a quick look.
- If `review-canvas` is not on PATH, it lives at `~/src/review-canvas/bin/review-canvas`.
- If the link is a `localhost` URL and the user is on another machine, run
  `review-canvas setup` once (it configures `tailscale serve`) and publish again.
