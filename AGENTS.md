# Working on Review Canvas

## Layout

- `shared/`: pure TypeScript, no I/O, used by both server and web.
  - `diff.ts`: patch parsing.
  - `classify.ts`: layers and noise rules.
  - `links.ts`: static links.
  - `analysis.ts`: GitHub JSON → `Analysis`.
  - `course.ts`: order normalization and the agent merge.
  - `view.ts`: what the canvas shows under the reviewer's filters.
  - `layout.ts`: map placement.
- `server/`: Fastify app (`app.ts`), CLI (`cli.ts`), `gh` wrapper (`github.ts`), file store
  (`store.ts`), agent brief (`brief.ts`).
- `web/`: React app.
  - `canvas/Canvas.tsx`: camera, measuring, interaction.
  - `canvas/Overlay.tsx`: the course and code paths.
  - `canvas/Terrain.tsx`: bands and contours.
  - `canvas/Frames.tsx`: file frames.
  - `panels.tsx`: course sheet, review drawer, legend.
  - `ReviewScreen.tsx`: review state.
- `skills/review-canvas/SKILL.md`: the skill agents follow. Keep it in step with the brief and
  the course schema (`shared/src/schemas.ts`).

## Rules that are easy to break

- **Never show a relationship the code doesn't have.** Static links need a symbol defined in one
  hunk and used, the way that language refers across files, in another file's changed lines.
  Agent links are checked with `hunkMentions`. Don't loosen these to make the map look busier.
- **Nothing is posted to GitHub except from the UI's confirm step** (`POST /api/reviews/:id/submit`).
  The CLI and skill only read.
- **`submitted` is server-owned.** `PUT /state` ignores it.
- **The layout uses sizes measured at reading zoom** (`near`). The overprint uses current sizes.
  Mixing them makes the map re-form every time you zoom out.
- **The overprint stays a fixed size on screen** (`u`, `us`, `ut` in `Overlay.tsx`). Course purple
  is reserved for the course, order and primary actions.
- **Real PR data from private repositories never goes into this repo.** Tests use the synthetic
  `test/fixtures/sync-retries.json`.

## Checks

```bash
npm test && npm run typecheck && npm run build
review-canvas restart   # a running server keeps serving the old build until restarted
```
