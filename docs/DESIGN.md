---
name: Review Canvas
description: A goal-based PR review course laid over the codebase as orienteering terrain (working name, unconfirmed).
colors:
  map-white: "#fafaf7"
  sheet: "#ffffff"
  ink: "#1e1b22"
  ink-2: "#47424d"
  ink-3: "#6b6570"
  rule: "#dcd8d2"
  rule-2: "#ebe8e3"
  hunk-ground: "#f7f6f2"
  course-purple: "#7b2cbf"
  course-purple-deep: "#6a22a8"
  purple-tint: "#f3ebfb"
  purple-tint-2: "#e7d8f6"
  note-purple: "#6a22a8"
  note-purple-light: "#a14fd9"
  note-wash: "#f6eefc"
  contour-brown: "#8c5a2b"
  marsh-blue: "#5fa7d6"
  marsh-wash: "#eef6fb"
  marsh-ink: "#2a6290"
  open-land: "#ffe8a3"
  semi-open-land: "#fdf0c4"
  thicket-olive: "#a5b36a"
  thicket-wash: "#f2f4e6"
  add-bg: "#e8f3e2"
  add-gutter: "#d5eacb"
  add-ink: "#2b672e"
  del-bg: "#fbe8e4"
  del-gutter: "#f5d3cc"
  del-ink: "#a3311f"
typography:
  display:
    fontFamily: "Sofia Sans Extra Condensed, Sofia Sans, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.01em"
  control-numeral:
    fontFamily: "Sofia Sans Extra Condensed, Sofia Sans, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 800
    lineHeight: 1
  headline:
    fontFamily: "Sofia Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.4
  title:
    fontFamily: "Sofia Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "13.5px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Sofia Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Sofia Sans Extra Condensed, Sofia Sans, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.05em"
  code:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "19px"
  quantity:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "11.5px"
    fontWeight: 400
    lineHeight: 1.35
rounded:
  none: "0px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "14px"
  float: "16px"
  lg: "18px"
components:
  button:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    rounded: "{rounded.none}"
    padding: "0 14px"
    height: "34px"
  button-hover:
    backgroundColor: "{colors.purple-tint}"
  button-primary:
    backgroundColor: "{colors.course-purple}"
    textColor: "{colors.sheet}"
    typography: "{typography.title}"
    rounded: "{rounded.none}"
    padding: "0 14px"
    height: "34px"
  button-primary-hover:
    backgroundColor: "{colors.course-purple-deep}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0 14px"
    height: "34px"
  button-quiet-hover:
    backgroundColor: "{colors.rule-2}"
  mark-reviewed:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    rounded: "{rounded.none}"
    padding: "0 10px 0 8px"
    height: "32px"
  mark-reviewed-done:
    backgroundColor: "{colors.purple-tint}"
    textColor: "{colors.course-purple-deep}"
  agent-note:
    backgroundColor: "{colors.note-wash}"
    textColor: "{colors.note-purple}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "8px 14px 8px 60px"
  path-chip:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "3px 8px"
  path-chip-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet}"
  file-frame:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
  chunk-drawer:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
  frame-title-bar:
    backgroundColor: "{colors.sheet}"
    typography: "{typography.control-numeral}"
    padding: "0 10px 0 14px"
    height: "52px"
  hunk-header:
    backgroundColor: "{colors.hunk-ground}"
    textColor: "{colors.ink}"
    padding: "9px 14px 8px"
  hunk-header-linked:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet}"
  course-row:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    padding: "9px 14px 9px 12px"
  course-row-current:
    backgroundColor: "{colors.purple-tint}"
  map-furniture:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "36px"
---

# Design System: Review Canvas

## Overview

**Creative North Star: "The Course Over Fixed Terrain"**

The codebase is a printed orienteering map and the review is a course overprinted on it. Layers of the stack are terrain bands drawn in ISOM map inks on map-white; the course is a list of goals, each a run of chunk stops, and a purple route joins the current goal's stops in reading order. Code relationships are black dashed paths, the map's own symbol for a track you can follow. The interface around the map borrows the orienteer's paper: a control description sheet for the course panel and a legend in table form.

It is an Operate surface for close reading at a desk. Density is high but ruled, never boxed in soft cards: square frames, 1px ink and hairline rules, condensed numerals beside humanist sans and a monospaced code face. The page is a scrolling document, not a free canvas. Layer bands are full-width rows, the Guided view shows one goal at full strength and fades the rest, and the Map view opens every changed file. Zoom is a CSS scale of the page, and below about 60 percent frames collapse to their titles so the route reads as a map.

The product is called Review Canvas.

**Key Characteristics:**
- ISOM terrain inks behind everything, purple overprint on top, black for code paths.
- Square corners everywhere; circles only as course symbols.
- 1px ink (#1e1b22) rules frame every surface; hairline warm-grey rules divide inside them.
- Extra Condensed 800 numerals and uppercase sheet labels carry the orienteering voice; Sofia Sans carries reading; JetBrains Mono carries code and quantities.
- One low map-lift under file frames; otherwise flat paper.
- Agent notes are the one place with a gradient: purple sparkle and gradient text on a light purple wash.

## Colors

Map paper and ink, five terrain inks for the stack's layers, one overprint purple for the course, a purple gradient reserved for agent notes, and diff green and red confined to code.

### Primary
- **Course Purple** (course-purple): the overprint. The route between the current goal's stops, goal and stop numerals, the current chunk's outline, the out-of-bounds hatching, the read and reviewed marks, the primary action, focus rings. **Course Purple Deep** (course-purple-deep) is its pressed and text-on-tint form.
- **Course Tints** (purple-tint, purple-tint-2): the current row, the reviewed state, hover on bordered controls, text selection.

### Agent notes
- **Note Purple** (note-purple to note-purple-light, a 90-degree gradient from #6a22a8 to #a14fd9): the text and sparkle icon of agent notes, and nothing else. **Note Wash** (note-wash, #f6eefc fading to white): the row behind a note. Notes are the agent's voice, so they read apart from the course, which belongs to the reviewer.

### Secondary
- **Contour Brown** (contour-brown): the dashed "Synthetic PR" badge, symbols and numbers in code highlighting.
- **Marsh Blue** (marsh-blue on marsh-wash): horizontal marsh hatching for the Jobs band. **Marsh Ink** (marsh-ink) is its legible form, used for strings in code.

### Tertiary
- **Open Land** (open-land) and **Semi-open Land** (semi-open-land): the HTTP and Mail bands.
- **Thicket Olive** (thicket-olive on thicket-wash): the olive dot screen for the Frontend band.

### Neutral
- **Map White** (map-white): the page ground.
- **Sheet** (sheet): frames, panels, drawer, legend, zoom bar, buttons. The Data band is plain sheet white.
- **Ink** (ink): text, 1px structural rules, code paths, band dividers.
- **Ink 2 / Ink 3** (ink-2, ink-3): secondary text and dimmed labels, path prefixes, sheet column labels.
- **Rule / Rule 2** (rule, rule-2): hairlines between hunks, rows and legend lines.
- **Hunk Ground** (hunk-ground): hunk headers and legend group rows.
- **Diff** (add-bg, add-gutter, add-ink, del-bg, del-gutter, del-ink): added and deleted lines, gutters and +/- counts only.

### Named Rules
**The Overprint Rule.** Purple means the course: order, position, progress, out-of-bounds, and the action that ends a goal. It never fills a layer band, never decorates, never marks a code relationship. One exception: agent notes use the purple sparkle icon and gradient text on a light purple wash, and nothing else uses gradient text.

**The Black Path Rule.** Relationships between hunks are drawn in ink only: dashed (9 6) at 2px with a filled dot at the source and a hollow dot at the target, turning solid at 4px when lit. Code paths are never colored.

**The Terrain Stays on the Ground Rule.** Terrain inks fill only the map ground behind frames, plus their legend swatches. Chrome, frames and controls stay sheet white and ink. Diff green and red are not map inks and stay inside code lines and counts.

## Typography

**Display Font:** Sofia Sans Extra Condensed (fallback Sofia Sans, system-ui)
**Body Font:** Sofia Sans (fallback system-ui, Segoe UI)
**Label/Mono Font:** JetBrains Mono (fallback ui-monospace, SF Mono, Menlo)

**Character:** The condensed face is the map's lettering: band names, goal numbers, sheet column heads, uppercase and tight. Sofia Sans is the plain reading voice; mono is reserved for code and for counts that must align. All three ship embedded as WOFF2.

### Hierarchy
- **Display** (800, 28px, line-height 1, uppercase, 0.01em): panel titles, the course sheet ("Course"), the chunk drawer and the review drawer. The wordmark uses the same face at 25px; band names use it too.
- **Control Numeral** (800, 30px, line-height 1, course purple): the goal number in the course sheet and on a stop's marker. The reviewed count and zoom percent use the same face at 18 to 22px.
- **Headline** (600, 16px): the PR title in the top bar.
- **Title** (600, 13.5px): file names in course rows, buttons, Mark reviewed, verdict options.
- **Body** (400, 13.5px, line-height 1.4): goal quotes, drafts, PR body. Base text is 14px/1.4; hunk summaries and drawer copy run at 13px.
- **Label** (700, 14px, 0.05em, uppercase): sheet column heads, the "Tests" heading in a goal's stops, legend group rows (13px), drawer section heads (16px).
- **Code** (400, 12px, 19px line): diff lines with tabular line numbers, syntax-highlighted and scrolling sideways rather than truncating.
- **Quantity** (400, 11.5 to 12px mono): +/- counts, hunk ranges, file locations, key caps.

### Named Rules
**The Numeral Rule.** Numbers that mean order (goal and stop numbers, reviewed count, zoom) are condensed 800; numbers that mean quantity (lines added, hunk ranges) are mono. Never swap them.

## Layout

A fixed app frame: a 56px top bar across the full width, a 320px course sheet on the left, and the page filling the rest. The page scrolls natively. Layer bands are full-width rows stacked top to bottom in data-flow order (Data, Domain, Jobs, Mail, HTTP, Frontend), each labeled with the band name and a one-line subtitle and ruled apart by ink lines. File frames sit inside their band.

**Guided view.** One goal is current. Its file frames show at full strength and a purple route, an SVG positioned by measuring the frames, joins them in stop order. Inside a frame, chunks that belong to other goals fold into a thin line reading "goal N". The current chunk takes the purple outline. Files used only by other goals show as faded tiles with their goal numbers. While the reviewer steps with J and K, every other file fades until a click or scroll.

**Diff layout.** Guided has a second layout, Diff (key L, or the Canvas | Diff switch in the top bar), remembered in this browser. The current goal's files stack in one full-width column in the order the goal first reaches each file, with the same stops and fold lines as the canvas. Each file header sticks to the top while any part of its file is on screen. A flat list of the goal's files, with their stop numbers, sits on the left (hidden at 760px and below); the row with the current stop takes the course tint. There are no bands, route, faded tiles, zoom or pan, and no zoom button.

**Map view.** Every changed file is open on its band with every chunk expanded, and each chunk carries the numbers of the goals it serves. At the bottom, a collapsed Out of bounds band lists generated output and generated API clients, each with its reason and a Show diff toggle. Translations are not out of bounds; they stay on the course.

**Course sheet.** The goals in order. The current goal expands to one row per stop: file and range for code, the test name for a cropped test, a "Tests" heading before the tests, and a dashed empty row when a goal has no proving test. After the goals come "Changes no goal asked for" and an "Out of bounds: N files" row that opens the Map view at its band. A view switch (Guided and Map) sits in the top bar.

**Drawers.** The review drawer (380px) and the chunk drawer slide in from the right over the page. The chunk drawer shows a linked chunk, or the whole file at the PR head from Open file.

Floating furniture sits 16px from the page edges: legend bottom left, keyboard hints bottom center, zoom bar bottom right, toast top center.

Spacing is a tight ruled rhythm: 14px inset inside frames, 18px inside sheets and drawers, 8px gaps between controls, 4px inside dense groups. Rows are separated by rules rather than whitespace.

At 760px and below the course sheet becomes an off-canvas panel opened from a "Course" button, the PR title wraps to its own line, meta counts and keyboard hints hide, and the drawers go full width.

## Elevation & Depth

Flat paper, with exactly one map-lift. File frames carry a hairline plus a soft drop that lifts them off the terrain like paper on a map; at far zoom it reduces to the hairline. The drawers and the mobile course sheet carry a directional edge shadow while open. Everything else (top bar, course sheet, legend, zoom bar, buttons) is flat and separated by 1px ink rules. State is shown by outline weight, not lift: the current chunk takes a 3px purple outline; a linked hunk takes a 2px ink outline.

### Shadow Vocabulary
- **Map-lift** (`box-shadow: 0 1px 0 rgba(30,27,34,.05), 0 14px 28px -18px rgba(40,24,60,.35)`): file frames on the page only.
- **Far-zoom hairline** (`box-shadow: 0 1px 0 rgba(30,27,34,.06)`): frames when collapsed to their titles.
- **Drawer edge** (`box-shadow: -18px 0 36px -28px rgba(40,24,60,.45)`): the review and chunk drawers; mirrored for the mobile course sheet.

### Named Rules
**The One Map-Lift Rule.** Only things that sit on the map get lifted, and only by the map-lift. Chrome is ruled, not floated.

## Shapes

Every rectangle is square-cornered (0px): frames, buttons, chips, inputs, legend, drawer, badges. Circles appear only as course symbols: route stop markers and path endpoints. Rules are 1px ink for structure and 1px warm grey inside.

Dashed outlines mean open or provisional: the unmarked Mark reviewed box, a goal's gap row, a path chip still to follow, the synthetic-data badge. Solid means settled: a reviewed box goes solid purple, a chip goes solid ink on hover.

**The Dashed Means Open Rule.** A dashed outline marks something not yet done, not yet followed, or not real; it goes solid when settled.

## Components

### Buttons
Square, ink-ruled, quietly tactile.
- **Shape:** square (0px), 1px ink border, 34px tall (28px in composers, 40px in the drawer footer).
- **Default:** sheet white, ink text, title weight; hover takes the purple tint; press nudges down 1px.
- **Primary:** course purple fill and border, white text; hover deepens to course purple deep. Reserved for the action that ends a step of the course (Review, Submit). Carries a white count box in condensed 700 purple.
- **Quiet:** no border or fill; hover takes rule-2.
- **Disabled:** 45 percent opacity, not-allowed cursor.
- **Focus:** 2px course purple outline, 2px offset, on every focusable element.

### Chips
- **Path chip:** 12px text, 1px dashed ink-2 border on white, names a relationship to another hunk ("tests this"). Hover inverts to solid ink with white text. Inside a linked hunk, chips are ink with white borders.

### Cards / Containers
- **File frame:** sheet white, 1px ink border, 0px corners, map-lift. A 52px title bar (directory in ink-3 plus bold file name, mono delta, Open file) over the chunks. At far zoom it collapses to this bar.
- **Chunk:** hunk-ground header with the mono range, the goal numbers it serves, the link groups (Uses, Used by, Tested by) and the summary row beneath. A long group folds to a count ("Used by 9") that opens the list. When its path is lit the header inverts to ink. Below the code, Show 20 more lines above and below draw from the file at the PR head.
- **Chunk drawer:** a right-hand panel with one chunk or a whole file. Lines that mention the link's symbol as a whole word are highlighted and scrolled to.
- **Internal padding:** 14px.

### Inputs / Fields
- **Composer and drafts:** 1px course purple border on white, set into the code at 58px left. Textarea borderless with a purple caret.
- **Drawer textarea:** 1px ink border; focus is a 2px purple outline inset by 1px.
- **Verdict:** a ruled radio table; the checked row takes the purple tint, radios use purple accent.

### Navigation
- **Course sheet:** the control description sheet. Display-weight "Course" with the reviewed count, then one ruled row per goal: its numeral, title, source tag (the ticket id, or PR), unread-stop count and a Mark reviewed box. The current goal expands into its stop rows. After the goals come "Changes no goal asked for" and the "Out of bounds: N files" row. The current row takes the purple tint; hover a warm grey.
- **Top bar:** wordmark in purple condensed 800, repo and PR title, a Guided and Map switch, meta counts, dashed brown "Synthetic PR" badge, primary Review button. Ruled off by 1px ink.
- **Mobile:** course sheet becomes an off-canvas panel behind a quiet "Course" button.

### Mark reviewed
A 32px bordered button with an 18px box, at the end of each goal and of "Changes no goal asked for". The box is dashed ink-3 while open; once marked it goes solid purple with a check and the button takes the purple tint. X toggles it. Marking is allowed with unread stops, and the goal row shows how many remain. Reading itself is automatic and has no control: a chunk is read once at least half of it has been on screen for 300 ms each at reading zoom.

### Agent notes
The agent's voice, drawn apart from the course. Every on-course chunk has a summary row under its header: a sparkle icon and one line of gradient text (note-purple to note-purple-light) on the note wash, at most 90 characters. A line note is the same row set under the line it explains, and there are few of them. Notes are the only gradient text in the system and the only use of the sparkle.

### Route
Drawn on the page layer, not in HTML. Legs join the current goal's stops in order as purple lines. Stop markers are white-filled, purple-stroked circles with a condensed 800 numeral. The route disappears in the Map view and at far zoom.

### Legend and Zoom Bar
Page furniture in sheet white with a 1px ink border. The legend is a collapsible ISOM-style table: condensed uppercase group rows on hunk-ground, a 44px symbol swatch, a plain description. The zoom bar is a segmented strip of 36px cells divided by hairlines, with the percent in condensed 700.

## Do's and Don'ts

### Do:
- **Do** keep purple for the course: order, current position, reviewed state, out-of-bounds, and the action that ends a goal. The one other purple is the agent-note gradient.
- **Do** draw every code relationship as a black dashed path with a filled source dot and a hollow target dot; light it solid and heavier on hover along with the far hunk.
- **Do** place files on the layer band they belong to, top to bottom in data-flow order, and label each band in condensed 800.
- **Do** frame surfaces with 1px ink and divide them with rule or rule-2 hairlines; keep every rectangle at 0px.
- **Do** collapse frames to their titles and hide paths at far zoom.
- **Do** fold chunks from other goals into a thin "goal N" line and fade files the current goal does not use.
- **Do** use dashed outlines for open or provisional things (an unread goal, a gap row) and solid once settled.
- **Do** put agent notes on the purple sparkle row, and keep them short.
- **Do** label synthetic data visibly with the dashed brown badge.

### Don't:
- **Don't** use a dotted-grid whiteboard ground or rounded cards with soft shadows; the ground is terrain and frames are square paper.
- **Don't** fill chrome, frames or buttons with terrain inks; they belong on the page ground and in the legend.
- **Don't** color code paths, and don't draw a path the code does not have.
- **Don't** use purple for decoration or for a layer.
- **Don't** use gradient text or the sparkle anywhere but agent notes.
- **Don't** add shadows beyond the map-lift on frames and the drawer edge.
- **Don't** use diff green or red outside code lines and +/- counts.
