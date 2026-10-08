---
name: Review Canvas
description: A PR review course laid over the codebase as orienteering terrain (working name, unconfirmed).
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
  punch:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    rounded: "{rounded.none}"
    padding: "0 10px 0 8px"
    height: "32px"
  punch-punched:
    backgroundColor: "{colors.purple-tint}"
    textColor: "{colors.course-purple-deep}"
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

The codebase is a printed orienteering map and the review is a course overprinted on it. Layers of the stack are terrain bands drawn in ISOM map inks on map-white; files are controls; the order to read them is a purple course that runs from a start triangle through numbered control circles to a finish double circle. Code relationships are black dashed paths, the map's own symbol for a track you can follow. The interface around the map borrows the orienteer's paper: a control description sheet for the course panel, a legend in table form, SI-style punch pins for reviewed state.

It is an Operate surface for close reading at a desk. Density is high but ruled, never boxed in soft cards: square frames, 1px ink and hairline rules, condensed control numerals beside humanist sans and a monospaced code face. Canvas mechanics (pan, zoom, drag, fly-to) are Figma-like; the look is cartography, not whiteboard. At far zoom, frames collapse to control descriptions and paths disappear so the route reads as a map.

The product is called Review Canvas.

**Key Characteristics:**
- ISOM terrain inks behind everything, purple overprint on top, black for code paths.
- Square corners everywhere; circles only as course symbols.
- 1px ink (#1e1b22) rules frame every surface; hairline warm-grey rules divide inside them.
- Extra Condensed 800 numerals and uppercase sheet labels carry the orienteering voice; Sofia Sans carries reading; JetBrains Mono carries code and quantities.
- One low map-lift under file frames; otherwise flat paper.

## Colors

Map paper and ink, five terrain inks for the stack's layers, one overprint purple for the course, and diff green and red confined to code.

### Primary
- **Course Purple** (course-purple): the overprint. Course legs, control circles and numerals, start triangle, finish circles, out-of-bounds hatching, the current file's outline, the punch strip, the primary action, focus rings. **Course Purple Deep** (course-purple-deep) is its pressed and text-on-tint form.
- **Course Tints** (purple-tint, purple-tint-2): the current row, punched state, hover on bordered controls, the current punch-strip cell, text selection.

### Secondary
- **Contour Brown** (contour-brown): contour lines on the terrain ground (30 to 42 percent opacity), the dashed "Synthetic PR" badge, symbols and numbers in code highlighting.
- **Marsh Blue** (marsh-blue on marsh-wash): horizontal marsh hatching for the Jobs band. **Marsh Ink** (marsh-ink) is its legible form, used for strings in code.

### Tertiary
- **Open Land** (open-land) and **Semi-open Land** (semi-open-land): the HTTP and Mail bands.
- **Thicket Olive** (thicket-olive on thicket-wash): the olive dot screen for the Frontend band.

### Neutral
- **Map White** (map-white): the canvas ground and the halo stroke behind map text.
- **Sheet** (sheet): frames, panels, drawer, legend, zoom bar, buttons. The Data band is plain sheet white with contours only.
- **Ink** (ink): text, 1px structural rules, code paths, band dividers, the map neatline.
- **Ink 2 / Ink 3** (ink-2, ink-3): secondary text and dimmed labels, path prefixes, sheet column labels.
- **Rule / Rule 2** (rule, rule-2): hairlines between hunks, rows and legend lines.
- **Hunk Ground** (hunk-ground): hunk headers and legend group rows.
- **Diff** (add-bg, add-gutter, add-ink, del-bg, del-gutter, del-ink): added and deleted lines, gutters and +/- counts only.

### Named Rules
**The Overprint Rule.** Purple means the course: order, position, progress, out-of-bounds, and the action that ends the course. It never fills a layer band, never decorates, never marks a code relationship.

**The Black Path Rule.** Relationships between hunks are drawn in ink only: dashed (9 6) at 2px with a filled dot at the source and a hollow dot at the target, turning solid at 4px when lit. Code paths are never colored.

**The Terrain Stays on the Ground Rule.** Terrain inks fill only the map ground behind frames, plus their legend swatches. Chrome, frames and controls stay sheet white and ink. Diff green and red are not map inks and stay inside code lines and counts.

## Typography

**Display Font:** Sofia Sans Extra Condensed (fallback Sofia Sans, system-ui)
**Body Font:** Sofia Sans (fallback system-ui, Segoe UI)
**Label/Mono Font:** JetBrains Mono (fallback ui-monospace, SF Mono, Menlo)

**Character:** The condensed face is the map's lettering: band names, control numbers, sheet column heads, uppercase and tight. Sofia Sans is the plain reading voice; mono is reserved for code and for counts that must align. All three ship embedded as WOFF2.

### Hierarchy
- **Display** (800, 28px, line-height 1, uppercase, 0.01em): panel titles, the course sheet ("Course") and the review drawer. The wordmark uses the same face at 25px; on the map, band names use it at 112 world units.
- **Control Numeral** (800, 30px, line-height 1, course purple): the control number on a frame's title bar and beside each map circle (with a map-white halo). The "N/14" punched count and zoom percent use the same face at 18 to 22px.
- **Headline** (600, 16px): the PR title in the top bar.
- **Title** (600, 13.5px): file names in course rows, buttons, punch, verdict options.
- **Body** (400, 13.5px, line-height 1.4): control descriptions, drafts, PR body. Base text is 14px/1.4; hunk summaries and drawer copy run at 13px.
- **Label** (700, 14px, 0.05em, uppercase): control description column heads (WHAT, WHY HERE), legend group rows (13px), drawer section heads (16px), the SPEC tag (13px).
- **Code** (400, 12px, 19px line): diff lines with tabular line numbers.
- **Quantity** (400, 11.5 to 12px mono): +/- counts, hunk ranges, file locations, key caps.

### Named Rules
**The Numeral Rule.** Numbers that mean order (control numbers, punched count, zoom) are condensed 800; numbers that mean quantity (lines added, hunk ranges) are mono. Never swap them.

## Layout

A fixed app frame: a 56px top bar across the full width, a 320px course sheet on the left, and the canvas filling the rest. The canvas is a world of fixed terrain: five full-width layer bands stacked top to bottom in data-flow order (Data, Jobs, Mail, HTTP, Frontend), each labeled in its left margin with the band name and a one-line subtitle, ruled apart by ink lines and enclosed in a 2px ink neatline. File frames sit inside their band; tests sit beside the code they test; out-of-bounds files gather in a purple-hatched box.

Floating map furniture sits 16px from the canvas edges: legend bottom left, keyboard hints bottom center, zoom bar bottom right, toast top center. The review drawer (380px) slides in from the right over the canvas.

Spacing is a tight ruled rhythm: 14px inset inside frames, 18px inside sheets and the drawer, 8px gaps between controls, 4px inside dense groups. Rows are separated by rules rather than whitespace.

At 760px and below the course sheet becomes an off-canvas panel opened from a "Course" button, the PR title wraps to its own line, meta counts and keyboard hints hide, and the drawer goes full width.

## Elevation & Depth

Flat paper, with exactly one map-lift. File frames carry a hairline plus a soft drop that lifts them off the terrain like paper on a map; at far zoom it reduces to the hairline. The review drawer and the mobile course sheet carry a directional edge shadow while open. Everything else (top bar, course sheet, legend, zoom bar, buttons) is flat and separated by 1px ink rules. State is shown by outline weight, not lift: the current frame takes a 3px purple outline; a linked hunk takes a 2px ink outline.

### Shadow Vocabulary
- **Map-lift** (`box-shadow: 0 1px 0 rgba(30,27,34,.05), 0 14px 28px -18px rgba(40,24,60,.35)`): file frames on the canvas only.
- **Far-zoom hairline** (`box-shadow: 0 1px 0 rgba(30,27,34,.06)`): frames when collapsed to control descriptions.
- **Drawer edge** (`box-shadow: -18px 0 36px -28px rgba(40,24,60,.45)`): the review drawer; mirrored for the mobile course sheet.

### Named Rules
**The One Map-Lift Rule.** Only things that sit on the map get lifted, and only by the map-lift. Chrome is ruled, not floated.

## Shapes

Every rectangle is square-cornered (0px): frames, buttons, chips, inputs, legend, drawer, badges. Circles appear only as course symbols: control circles, the finish double circle, path endpoints. The start is an equilateral triangle. Rules are 1px ink for structure and 1px warm grey inside.

Dashed outlines mean open or provisional: the unpunched pin box, a path chip still to follow, the synthetic-data badge. Solid means settled: a punched pin box goes solid purple, a chip goes solid ink on hover.

**The Dashed Means Open Rule.** A dashed outline marks something not yet done, not yet followed, or not real; it goes solid when settled.

## Components

### Buttons
Square, ink-ruled, quietly tactile.
- **Shape:** square (0px), 1px ink border, 34px tall (28px in composers, 40px in the drawer footer).
- **Default:** sheet white, ink text, title weight; hover takes the purple tint; press nudges down 1px.
- **Primary:** course purple fill and border, white text; hover deepens to course purple deep. Reserved for the course-ending action (Review, Submit). Carries a white count box in condensed 700 purple.
- **Quiet:** no border or fill; hover takes rule-2.
- **Disabled:** 45 percent opacity, not-allowed cursor.
- **Focus:** 2px course purple outline, 2px offset, on every focusable element.

### Chips
- **Path chip:** 12px text, 1px dashed ink-2 border on white, names a relationship to another hunk ("tests this"). Hover inverts to solid ink with white text. Inside a linked hunk, chips are ink with white borders.

### Cards / Containers
- **File frame:** sheet white, 1px ink border, 0px corners, map-lift. A 52px title bar (control numeral, directory in ink-3 plus bold file name, mono delta, punch button) over a control description table (86px condensed label column), then hunks.
- **Hunk:** hunk-ground header with mono range, one-line summary and path chips; when its path is lit the header inverts to ink.
- **Internal padding:** 14px.

### Inputs / Fields
- **Composer and drafts:** 1px course purple border on white, set into the code at 58px left. Textarea borderless with a purple caret.
- **Drawer textarea:** 1px ink border; focus is a 2px purple outline inset by 1px.
- **Verdict:** a ruled radio table; the checked row takes the purple tint, radios use purple accent.

### Navigation
- **Course sheet:** the control description sheet. Display-weight "Course" with the punched count, a 14-cell punch strip (purple outline cells; filled when punched, tinted when current), then one ruled row per control: course symbol (start triangle, numbered circle, smaller unnumbered circle for specs, finish double circle, hatched out-of-bounds square), name and directory, counts, pin box. Current row takes the purple tint; hover a warm grey.
- **Top bar:** wordmark in purple condensed 800, repo and PR title, meta counts, dashed brown "Synthetic PR" badge, primary Review button. Ruled off by 1px ink.
- **Mobile:** course sheet becomes an off-canvas panel behind a quiet "Course" button.

### Punch
The SI punch. A 32px bordered button with an 18px pin box: dashed ink-3 while unpunched; once punched the box goes solid purple and shows that control's unique pin pattern, and the button takes the purple tint. Punching fires a toast in ink with the pin in light purple.

### Course Overprint
Drawn on the map layer, not in HTML. Legs are purple lines at 3.5 units, the active leg at 6, completed legs at 38 percent opacity. Control circles are 22-unit radius, white-filled, purple-stroked (5 when active). Numerals sit outside the circle in condensed 800 purple with a map-white halo. Finish is a double circle with a "FINISH" label.

### Legend and Zoom Bar
Map furniture in sheet white with a 1px ink border. The legend is a collapsible ISOM-style table: condensed uppercase group rows on hunk-ground, a 44px symbol swatch, a plain description. The zoom bar is a segmented strip of 36px cells divided by hairlines, with the percent in condensed 700.

## Do's and Don'ts

### Do:
- **Do** keep purple for the course: order, current position, punched state, out-of-bounds, and the action that finishes the review.
- **Do** draw every code relationship as a black dashed path with a filled source dot and a hollow target dot; light it solid and heavier on hover along with the far hunk.
- **Do** place files on the layer band they belong to, top to bottom in data-flow order, and label each band in the map margin in condensed 800.
- **Do** frame surfaces with 1px ink and divide them with rule or rule-2 hairlines; keep every rectangle at 0px.
- **Do** collapse frames to control descriptions and hide paths at far zoom.
- **Do** use dashed outlines for open or provisional things and solid once settled.
- **Do** label synthetic data visibly with the dashed brown badge.

### Don't:
- **Don't** use a dotted-grid whiteboard ground or rounded cards with soft shadows; the ground is terrain and frames are square paper.
- **Don't** fill chrome, frames or buttons with terrain inks; they belong on the map ground and in the legend.
- **Don't** color code paths, and don't draw a path the code does not have.
- **Don't** use purple for decoration or for a layer.
- **Don't** add shadows beyond the map-lift on frames and the drawer edge.
- **Don't** use diff green or red outside code lines and +/- counts.
