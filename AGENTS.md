# Working on Review Canvas

## Layout

- `shared/`: pure TypeScript, no I/O, used by both server and web.
  - `diff.ts`: patch parsing.
  - `classify.ts`: layers and noise rules.
  - `links.ts`: static links.
  - `analysis.ts`: GitHub JSON → `Analysis`.
  - `crop.ts`: finds single tests inside a test chunk, for `hunkId@name` stops.
  - `course.ts`: the agent merge (goals, stops, notes), `onCourse`, goal ids.
  - `view.ts`: an index over the review for the web (goals of a chunk, read state, out-of-bounds files).
- `server/`: Fastify app (`app.ts`), CLI (`cli.ts`), `gh` wrapper (`github.ts`), file store
  (`store.ts`), agent brief (`brief.ts`).
- `web/`: React app.
  - `ReviewScreen.tsx`: review state, keys, view switch (Guided / Map).
  - `course/`: the page. Course sheet, Guided view, Map view, `StopView.tsx` (code rows), chunk
    and file drawers, link groups, Show more, zoom and pan, the read tracker.
  - `panels.tsx`: review drawer and legend.
- `skills/review-canvas/SKILL.md`: the skill agents follow. Keep it in step with the brief and
  the course schema (`shared/src/schemas.ts`).

## Rules that are easy to break

- **Never show a relationship the code doesn't have.** Static links need a symbol defined in one
  hunk and used, the way that language refers across files, in another file's changed lines.
  Agent links are checked with `hunkMentions`. Don't loosen these to make the map look busier.
- **Nothing is posted to GitHub except from the UI's confirm step** (`POST /api/reviews/:id/submit`).
  The CLI and skill only read.
- **`submitted` is server-owned.** `PUT /state` ignores it.
- **A chunk is read by being seen, not by a click.** The read rule lives in one place: seen ranges
  add up to at least half the chunk, each held 300 ms, at reading zoom (not zoomed out). Don't mark
  chunks read from J/K scrolling past them.
- **`onCourse` in `shared/src/course.ts` is the one definition of what is on the course.** Generated
  output and API clients are out of bounds (Map band only); tests and translations are on course.
  Publish, brief and web all use it.
- **Purple means the course, except agent notes.** Notes use the purple sparkle and gradient text
  on a light purple wash (`docs/DESIGN.md`). Gradient text appears nowhere else.
- **Code rows render in one place.** `StopView.tsx` exports `CodeRows` with a `mode` (`guided`,
  `map` or `drawer`); the Map view, the drawers and Show more render through it. Each `course/`
  module imports its own CSS, and `web/src/styles.css` stays with the shell.
- **Real PR data from private repositories never goes into this repo.** Tests use the synthetic
  `test/fixtures/sync-retries.json`.

## Checks

```bash
npm test && npm run typecheck && npm run build
review-canvas restart   # a running server keeps serving the old build until restarted
```
