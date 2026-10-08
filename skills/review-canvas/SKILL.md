---
name: review-canvas
description: Lay a GitHub pull request out on Review Canvas, an infinite map that shows files in the order they should be read, and hand back the link. Use when the user gives a PR URL or number and asks to review it on the canvas, to "open it in review canvas", to "plan the review", or to "give me a link to review this PR".
---

# Review Canvas

Review Canvas shows a pull request as a course on a map. Each file is a frame. A purple line
runs file to file in reading order, and dashed lines join hunks that refer to each other. The
server does the deterministic work: it fetches the PR with `gh`, parses hunks, sorts files into
layers, hides noise, and finds links in the code. You do the judgement: the order, and short
notes on each file and hunk.

## Steps

1. **Prepare.** Run:

   ```bash
   review-canvas prepare <pr-url-or-owner/repo#number>
   ```

   It prints the review id, the brief to read, and the course JSON to fill in.

2. **Read the brief** (`brief.md`). It lists every file and hunk id with its diff, the links the
   server already found, and what is out of bounds. On large PRs, read it in chunks; skim the
   generated and test files.

3. **Fill in the course** (`course.json`, pre-filled with every id and a default order). Edit:

   - `route`: two or three sentences on how the course runs and why.
   - `order`: every on-course file id in reading order. Follow how data and calls flow: schema
     and models, domain, jobs, mail, the hand-written API contract (`.tsp`), routes, policies,
     controllers, then the UI. Tests and generated files are moved next to their subject or
     source automatically, so you do not need to place them carefully.
   - `files.<id>.what`: one sentence on what changed. `files.<id>.why`: one short sentence on why
     it comes at this point ("Start here: everything below reads these columns.").
   - `hunks.<id>`: one sentence per hunk on what it does or what to check. Name risks plainly
     ("Nothing checks the sync is failed before retrying it.").
   - `links` (optional): extra relationships the server missed, as
     `{ "from": "<hunk id>", "to": "<hunk id>", "label": "reads subject from", "symbol": "subject" }`.
     The symbol must appear in both hunks or the server rejects the link. Never invent one.

   Write plainly: no marketing words, no restating the diff line by line. Leave generated
   files' notes empty.

4. **Publish:**

   ```bash
   review-canvas publish <review-id>
   ```

   It checks the course against the analysis, prints warnings, starts the server if needed, and
   prints the URL. If it warns that files were missing or links were rejected, fix
   `course.json` and publish again.

5. **Reply with the URL** and one or two lines on the route you planned and anything the reviewer
   should look at first. Do not paste the notes into chat; they are on the canvas.

## Notes

- Nothing is posted to GitHub by this skill. The reviewer drafts comments in the UI and posts
  them from there after an explicit confirmation.
- `review-canvas open <pr>` skips the agent and opens the PR in the default layer order. Use it
  only when the user asks for a quick look without notes.
- If `review-canvas` is not on PATH, it lives at `~/src/review-canvas/bin/review-canvas`.
- If the link is a `localhost` URL and the user is on another machine, run
  `review-canvas setup` once (it configures `tailscale serve`) and publish again.
