---
version: alpha
name: Dawnline Portal
description: >-
  The personal portal of Dawnline (an AmneziaWG access server for OpenWrt): one page per person
  with their devices, their access and the set-up of a new device. Near-black and quiet, surfaces
  that step up in brightness instead of borders, one sky-blue accent, colour only for state,
  physical spring motion, and text that changes in place letter by letter.
colors:
  # Dark (the default; measured from skiper21). Light values follow with the light- prefix.
  bg: "#080808"
  raised: "#121212"
  field: "#161616"
  knob: "#232323"
  seg: "rgba(237, 237, 237, 0.05)"
  line: "rgba(255, 255, 255, 0.06)"
  line-glass: "rgba(255, 255, 255, 0.07)"
  text: "#ededed"
  text-2: "#8c8c8a"
  text-3: "#4f4f4e"
  accent: "#4eafff"
  accent-ink: "#ffffff"
  accent-soft: "rgba(78, 175, 255, 0.13)"
  ok: "#30d158"
  ok-soft: "rgba(48, 209, 88, 0.14)"
  warn: "#ff8d28"
  bad: "#ff383c"
  bad-soft: "rgba(255, 56, 60, 0.13)"
  selection-bg: "rgba(131, 209, 255, 0.25)"
  selection-fg: "#64c6ff"
  scrim: "rgba(8, 8, 8, 0.8)"
  bar: "rgba(237, 237, 237, 0.13)"
  toast: "#232323"
  toast-fg: "#ededed"
  qr-bg: "#0a0a0a"
  light-bg: "#f2f2f1"
  light-raised: "#ffffff"
  light-field: "#f3f3f2"
  light-knob: "#e8e8e7"
  light-seg: "#ffffff"
  light-line: "rgba(0, 0, 0, 0.07)"
  light-text: "#0b0b0b"
  light-text-2: "#6d6d6b"
  light-text-3: "#a6a6a4"
  light-accent: "#2b9dff"
  light-accent-soft: "rgba(43, 157, 255, 0.12)"
  light-ok: "#30d158"
  light-ok-soft: "rgba(48, 209, 88, 0.12)"
  light-warn: "#ff8d28"
  light-bad: "#ff383c"
  light-bad-soft: "rgba(255, 56, 60, 0.1)"
  light-selection-bg: "rgba(78, 175, 255, 0.22)"
  light-selection-fg: "#0a76cf"
  light-scrim: "rgba(236, 236, 235, 0.62)"
  light-bar: "rgba(11, 11, 11, 0.11)"
  light-toast: "#0b0b0b"
  light-toast-fg: "#f2f2f1"
  light-qr-bg: "#ffffff"
typography:
  body:
    fontFamily: system-ui
    fontSize: 15px
    fontWeight: 400
    lineHeight: 22px
    letterSpacing: -0.011em
  display-number:
    fontFamily: system-ui
    fontSize: 36px
    fontWeight: 600
    lineHeight: 40px
    letterSpacing: -0.045em
  card-title-alone:
    fontFamily: system-ui
    fontSize: 22px
    fontWeight: 500
    lineHeight: 28px
    letterSpacing: -0.03em
  section-title:
    fontFamily: system-ui
    fontSize: 20px
    fontWeight: 500
    lineHeight: 28px
    letterSpacing: -0.025em
  sheet-title:
    fontFamily: system-ui
    fontSize: 20px
    fontWeight: 500
    lineHeight: 28px
    letterSpacing: -0.5px
  empty-title:
    fontFamily: system-ui
    fontSize: 18px
    fontWeight: 500
    lineHeight: 24px
    letterSpacing: -0.02em
  value:
    fontFamily: system-ui
    fontSize: 17px
    fontWeight: 500
    lineHeight: 24px
    letterSpacing: -0.02em
    fontFeature: '"tnum"'
  card-title:
    fontFamily: system-ui
    fontSize: 16px
    fontWeight: 500
    lineHeight: 22px
    letterSpacing: -0.02em
  button:
    fontFamily: system-ui
    fontSize: 16px
    fontWeight: 500
    lineHeight: 22px
    letterSpacing: -0.015em
  button-strong:
    fontFamily: system-ui
    fontSize: 16px
    fontWeight: 600
    lineHeight: 22px
    letterSpacing: -0.015em
  input:
    fontFamily: system-ui
    fontSize: 16px
    fontWeight: 500
    lineHeight: 24px
    letterSpacing: -0.012em
  step-title:
    fontFamily: system-ui
    fontSize: 16px
    fontWeight: 500
    lineHeight: 24px
    letterSpacing: -0.02em
  row-title:
    fontFamily: system-ui
    fontSize: 15px
    fontWeight: 500
    lineHeight: 22px
    letterSpacing: -0.02em
  breadcrumb:
    fontFamily: system-ui
    fontSize: 15px
    fontWeight: 500
    lineHeight: 22px
    letterSpacing: -0.15px
  question-text:
    fontFamily: system-ui
    fontSize: 15px
    fontWeight: 400
    lineHeight: 21px
  desc:
    fontFamily: system-ui
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
  menu-item:
    fontFamily: system-ui
    fontSize: 14px
    fontWeight: 500
    lineHeight: 20px
  toast:
    fontFamily: system-ui
    fontSize: 14px
    fontWeight: 500
    lineHeight: 20px
  meta:
    fontFamily: system-ui
    fontSize: 13px
    fontWeight: 400
    lineHeight: 18px
  pill-label:
    fontFamily: system-ui
    fontSize: 13px
    fontWeight: 600
    lineHeight: 18px
  label-sm:
    fontFamily: system-ui
    fontSize: 12px
    fontWeight: 500
    lineHeight: 16px
  tooltip:
    fontFamily: system-ui
    fontSize: 12px
    fontWeight: 500
    lineHeight: 12px
    letterSpacing: -0.1px
  divider-label:
    fontFamily: system-ui
    fontSize: 12px
    fontWeight: 500
    lineHeight: 22px
    letterSpacing: 0.06em
  axis:
    fontFamily: system-ui
    fontSize: 11px
    fontWeight: 500
    lineHeight: 16px
  axis-xs:
    fontFamily: system-ui
    fontSize: 10px
    fontWeight: 500
    lineHeight: 14px
  calendar-head:
    fontFamily: system-ui
    fontSize: 9px
    fontWeight: 600
    lineHeight: 10px
  mono-link:
    fontFamily: ui-monospace
    fontSize: 13px
    fontWeight: 400
    lineHeight: 22px
    letterSpacing: 0px
  mono-code:
    fontFamily: ui-monospace
    fontSize: 12px
    fontWeight: 400
    lineHeight: 18px
    letterSpacing: 0px
rounded:
  sheet: 36px
  card: 28px
  notice: 24px
  qr-big: 24px
  qr-dense: 22px
  row: 20px
  menu: 20px
  badge: 18px
  qr: 18px
  field: 16px
  tile: 16px
  kind: 14px
  inner: 14px
  key: 12px
  way-end: 11px
  chip: 10px
  bar: 3px
  full: 999px
spacing:
  gutter: 16px
  page-top: 40px
  page-bottom: 112px
  page-max: 1072px
  access-column: 384px
  columns-gap: 36px
  stack-gap: 40px
  crumbs-below: 32px
  section-head-below: 12px
  grid-gap: 10px
  card-padding: 8px
  sheet-padding: 24px
  sheet-width: 400px
  sheet-edge: 16px
  open-row-gap: 10px
  tile-gap: 8px
  notice-below: 22px
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.button-strong}"
    rounded: "{rounded.full}"
    height: 48px
    padding: 0 20px
  button-tint:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    typography: "{typography.button-strong}"
    rounded: "{rounded.full}"
    height: 48px
    padding: 0 20px
  button-soft:
    backgroundColor: "{colors.knob}"
    textColor: "{colors.text}"
    typography: "{typography.button}"
    rounded: "{rounded.full}"
    height: 48px
    padding: 0 20px
  button-danger:
    backgroundColor: "{colors.bad}"
    textColor: "#ffffff"
    typography: "{typography.button-strong}"
    rounded: "{rounded.full}"
    height: 48px
    padding: 0 20px
  button-small:
    rounded: "{rounded.full}"
    height: 40px
    padding: 0 16px
  knob:
    backgroundColor: "{colors.knob}"
    textColor: "{colors.text}"
    rounded: "{rounded.full}"
    size: 32px
  field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.text}"
    typography: "{typography.input}"
    rounded: "{rounded.field}"
    height: 48px
    padding: 0 4px 0 16px
  go-button:
    backgroundColor: "{colors.knob}"
    textColor: "{colors.text-3}"
    rounded: "{rounded.key}"
    width: 48px
    height: 40px
  go-button-ready:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.key}"
    width: 48px
    height: 40px
  device-card:
    backgroundColor: "{colors.raised}"
    rounded: "{rounded.card}"
    padding: 8px
  usage-block:
    backgroundColor: "{colors.field}"
    rounded: "{rounded.row}"
    padding: 12px 14px 12px 16px
    height: 66px
  accordion-row:
    backgroundColor: "{colors.raised}"
    typography: "{typography.row-title}"
    rounded: "{rounded.row}"
    height: 52px
    padding: 0 8px
  accordion-row-inset:
    backgroundColor: "{colors.field}"
    rounded: "{rounded.row}"
    height: 52px
  sheet:
    backgroundColor: "{colors.raised}"
    rounded: "{rounded.sheet}"
    width: 400px
    padding: 0 24px 24px
  menu:
    backgroundColor: "{colors.field}"
    rounded: "{rounded.menu}"
    padding: 6px
    width: 224px
  menu-item:
    typography: "{typography.menu-item}"
    rounded: "{rounded.inner}"
    height: 40px
    padding: 0 12px
  toast:
    backgroundColor: "{colors.toast}"
    textColor: "{colors.toast-fg}"
    typography: "{typography.toast}"
    rounded: "{rounded.full}"
    height: 42px
    padding: 0 18px 0 13px
  tooltip:
    backgroundColor: "{colors.toast}"
    textColor: "{colors.toast-fg}"
    typography: "{typography.tooltip}"
    rounded: "{rounded.full}"
    height: 26px
    padding: 0 10px
  notice:
    backgroundColor: "{colors.raised}"
    rounded: "{rounded.notice}"
    padding: 14px 18px 14px 14px
  segmented:
    backgroundColor: "{colors.field}"
    rounded: "{rounded.field}"
    height: 48px
    padding: 0 4px
  segmented-pill:
    backgroundColor: "{colors.seg}"
    rounded: "{rounded.key}"
    height: 40px
  kind-tile:
    backgroundColor: "{colors.field}"
    rounded: "{rounded.kind}"
    height: 56px
  option-row:
    backgroundColor: "{colors.field}"
    textColor: "{colors.text}"
    rounded: "{rounded.field}"
    padding: 12px 12px 12px 14px
  switch:
    backgroundColor: "{colors.knob}"
    rounded: "{rounded.full}"
    width: 44px
    height: 26px
  switch-on:
    backgroundColor: "{colors.accent}"
    rounded: "{rounded.full}"
    width: 44px
    height: 26px
  badge:
    backgroundColor: "{colors.field}"
    rounded: "{rounded.badge}"
    height: 60px
    padding: 0 14px 0 12px
  link-row:
    backgroundColor: "{colors.field}"
    typography: "{typography.mono-link}"
    rounded: "{rounded.inner}"
    height: 44px
    padding: 0 4px 0 14px
  update-pill:
    backgroundColor: "rgba(255, 141, 40, 0.14)"
    textColor: "{colors.warn}"
    typography: "{typography.pill-label}"
    rounded: "{rounded.full}"
    height: 32px
    padding: 0 12px 0 10px
  language-pill:
    backgroundColor: "{colors.knob}"
    textColor: "{colors.text}"
    rounded: "{rounded.full}"
    height: 32px
    padding: 0 8px
  name-chip:
    backgroundColor: "{colors.field}"
    typography: "{typography.mono-link}"
    rounded: "{rounded.chip}"
    height: 32px
    padding: 0 10px 0 12px
  qr-code:
    backgroundColor: "{colors.qr-bg}"
    rounded: "{rounded.qr}"
    size: 148px
  qr-code-big:
    backgroundColor: "{colors.qr-bg}"
    rounded: "{rounded.qr-big}"
    size: 208px
---

# DESIGN.md — the Dawnline personal portal

This file describes how the **personal portal** (`web/src/portal`, plus the parts of `web/src/shared` it uses) looks and moves: its tokens, its components and, in its own part, its motion. It is also the design system of the admin (`web/src/admin`, the LuCI modules `dawnline.app`, `dawnline.style`, `dawnline.map` and `dawnline.qr`): every admin page is built from these tokens, components and springs inside LuCI, in a Shadow DOM, with the few admin-only parts and approved deviations listed in `rules/ui-design.md`. A change here reaches both.

The front matter follows the [DESIGN.md](https://github.com/google-labs-code/design.md) draft format (alpha). The prose sections come in that format's order. **Motion Design**, **Content & Voice** and **Accessibility** are extra sections after them.

The styles live in `web/src/portal/styles` (tokens in `tokens.css`), the motion engine in `web/src/portal/motion.ts`.

**Measured live (2026-10-20, Dawnline 0.11.0)** at desktop width (1138 px) and phone width (375 px), in dark and in light, in English and in Russian. Every duration, delay and easing in this file was seen running, not only read. Spring durations and overshoot come from the same function the portal uses (see *Motion → Springs*). Where code and the live page disagree, the live page wins.

---

## Overview

The portal is one person's page on a router.

**Lineage.** The look was approved as a mockup (Oct 2026). It borrows from three places:

- **skiper-ui:** skiper21's palette, accent, highlight and tab pill, and skiper103's bouncy accordion;
- **iconiqui:** the breadcrumb and the edge fades (dia-text);
- **aicss.dev:** the busy orb, "Orbs B4 Converge".

**Personality.** Calm, dark and tactile. The page is near-black (`#080808`). There are no borders: each layer is a step brighter than the one under it. One sky blue is the only accent. Every other colour means a state. The UI is made of big round shapes (36 px sheets, 28 px cards, pills), and glass icons are the only illustration.

### Principles

1. **Structure over text.** Tiles, rings, bars, calendars and pills say it before a sentence does. Summaries come first ("38.6 GB / 100 GB"), details sit one tap deeper (the accordion).
2. **Depth from brightness, not lines.** Each layer goes bg → raised → field → knob, every step a little lighter. A ring is drawn inset, and only to mean something: focus, the picked tile, this device, a notice's tone.
3. **Colour is meaning.** Accent blue means action or "you are here". Green means fine or connected, orange means attention or paused, red means stopped, out or destructive. Grey is everything else.
4. **One place per fact.** The count sits beside "Your devices", the usage sits on its card, and the access sits in its rows. Nothing is repeated.
5. **Nothing blinks.** A change happens where it is: text morphs letter by letter, cards glide to their new places, a sheet glides to its new height. A repaint never flashes.
6. **Physical, interruptible motion.** Springs are given as stiffness and damping, and each animation starts from where the element stands right now.
7. **The keyboard does not start motion.** Escape closes a menu instantly; a sheet goes by the way its × sends it (the one thing a key sets moving: a sheet gone in one frame read as a fault). Reduced motion keeps fades and drops all travel.
8. **Honest states.** Each state is said once, where it matters, in the state's colour.
9. **Cheap to draw on a phone.** Nothing watches the page (no observers): what changes says so. Nothing blurs the page behind a sheet (the scrim only dims); on a touch screen the top fade doesn't blur either. A large block (a fold, an accordion's body, a sheet) fades without a blur, on any screen; letters, icons and small things keep theirs. The page keeps its scale, as an app: no pinch or double-tap zoom.

---

## Colors

All colours are CSS custom properties in `styles/tokens.css`. The dark theme comes first. Light applies under `@media (prefers-color-scheme: light)`, with no toggle: the page follows the system, and its QR codes repaint in place when the system theme changes.

### Surfaces: the brightness ladder

| Token | Dark | Light | Role | Where |
|---|---|---|---|---|
| `--bg` | `#080808` | `#f2f2f1` | The ground | `body`, the edge fades |
| `--raised` | `#121212` | `#ffffff` | Things on the ground | device cards, accordion rows, sheet, notices, the "gone" card |
| `--field` | `#161616` | `#f3f3f2` | Things inside raised | usage block, inputs, segmented track, inset rows, tiles, badges, QR row, menu |
| `--knob` | `#232323` | `#e8e8e7` | Controls on anything | knobs, soft buttons, step numbers, hover fills, toast (dark) |
| `--seg` | `rgba(237,237,237,.05)` | `#ffffff` + `--seg-shadow` | The picked pill in the app picker | `.seg-pill` |
| `--line` | `rgba(255,255,255,.06)` | `rgba(0,0,0,.07)` | The only hairline | "OR" divider, menu separator and inner rim, light QR rim |

The measured luminance steps are tiny. In dark, raised vs bg is 1.07:1, field vs raised 1.04:1 and knob vs raised 1.19:1. In light they are 1.12, 1.11 and 1.23. Hierarchy comes from the shape and the radius as much as from the fill, so **do not add borders** to make a level visible.

### Text ladder

| Token | Dark | Light | Use |
|---|---|---|---|
| `--text` | `#ededed` | `#0b0b0b` | Titles, values, the breadcrumb's place, bold steps |
| `--text-2` | `#8c8c8a` | `#6d6d6b` | Secondary lines: statuses at rest, labels, hints, sheet subs, head values, accordion chevrons |
| `--text-3` | `#4f4f4e` | `#a6a6a4` | Faint: counts ("3 of 4"), "OR", axis ends, placeholders, idle picker icons, the limit note, chevrons in badges |

`.desc` is `--text` at `opacity: .6`, not `--text-2`, so it stays readable inside rows of any fill.

### Accent and states

| Token | Dark | Light | Meaning |
|---|---|---|---|
| `--accent` | `#4eafff` | `#2b9dff` | Primary action, "this device", today, links in hints, the selection ring, a field's caret and selection, a switch that is on |
| `--accent-ink` | `#ffffff` | `#ffffff` | Text on a filled accent button, the knob of a switch that is on |
| `--accent-soft` | `blue @ 13%` | `blue @ 12%` | Tinted "Connect", the Demo chip, a primary badge's icon tile |
| `--ok` / `--ok-soft` | `#30d158` / 14% | *same* / 12% | Connected, included, the way filling green, the arrival ring |
| `--warn` | `#ff8d28` | *same* | Not set up yet, settings changed, Reconnect, ends soon, a link that fails (the card's line; the way's can't finish and no data) |
| `--bad` / `--bad-soft` | `#ff383c` / 13% | *same* / 10% | Out of data, access ended, Remove, errors |
| `--sel-bg` / `--sel-fg` | `rgba(131,209,255,.25)` / `#64c6ff` | `rgba(78,175,255,.22)` / `#0a76cf` | `::selection` |
| `--bar` | `text @ 13%` | `text @ 11%` | Chart bars, meter and ring tracks |

### Tint recipes (keep them)

All tints come from `color-mix`, never from new hex values:

| Recipe | Where |
|---|---|
| `color-mix(in srgb, var(--knob), var(--text) 6%)` | hover of knob, soft button, language pill; at rest, the file card's icon and a nested row's soft buttons inside an inset row |
| `… var(--text) 10%` | pressed or open (`aria-expanded`) knob and language pill |
| `… var(--text) 12%` | hover of a nested row's soft buttons inside an inset row |
| `color-mix(in srgb, var(--accent) 82%, transparent)` | hover of the filled accent button |
| `accent 20%` / `24%` over transparent | hover / active of the tinted button |
| `color-mix(in srgb, var(--warn|--bad) 10%, var(--raised))` + `inset 0 0 0 1px tone 22%` | warn / bad notice |
| `warn 14%` → hover `22%` | the Update pill |
| `color-mix(in srgb, var(--raised), var(--knob) 40%)` | hover of an accordion row (inset rows and the option row: field + knob 50%) |
| `color-mix(in srgb, var(--knob) 65%, var(--field))` | the app picker's track, the badges, the file card and a nested inset row inside an inset row (a badge's and that row's hover: `knob`) |
| `color-mix(in srgb, var(--accent) 26%, transparent)` | a field's selection wash |
| `color-mix(in srgb, var(--warn) 14%, transparent)` | the way's router end when the device can't finish (accent 14% while waiting) |
| `color-mix(in srgb, var(--accent) 32%, transparent)` inset 1px | ring of the card of "this device" |
| `color-mix(in srgb, var(--text) 16%, transparent)` inset 1.5px | focused field |
| `color-mix(in srgb, var(--accent) 65%, transparent)` 2px outline, offset 2px | `:focus-visible`, while the keyboard moves focus (`.kbd`) |

### Overlays and floating colours

- **Scrim:** dark `rgba(8,8,8,.8)`, light `rgba(236,236,235,.62)`, a dim alone (no backdrop blur).
- **Toast and tooltip:** `#232323` on dark. On light they invert to `#0b0b0b` with `#f2f2f1` text.
- **QR card:** `#0a0a0a` "night" (light dots) on dark, `#ffffff` "day" (dark dots) on light, with a 1px `--line` rim in light.

### Glass icon tones

Glass icons (`ui/glass.ts`) draw a tinted back shape, the same shape blurred behind a frosted pane, a rim and white detail strokes. Their colours come only from classes, because the CSP drops `style=`.

| Tone | Dark a → b | Light a → b | Used for |
|---|---|---|---|
| `t-grey` | `#cfcfcd` → `#5a5a59` | `#a9a9a7` → `#3d3d3c` | Device cards (default), access rows, Add |
| `t-blue` | `#a6d9ff` → `#1d84e6` | `#7cc4ff` → `#0a6fd6` | This device, first device, kinds, reach tiles that are on, the LAN Bypass row when on, lock |
| `t-green` | `#a8f29c` → `#30d158` | `#82e070` → `#30d158` | "Everything works" (demo) |
| `t-orange` | `#ffc08f` → `#ff8d28` | *same as dark* | Warn notices |
| `t-red` | `#ffadad` → `#ff383c` | `#ff9090` → `#ff383c` | Bad notices, Remove question |

Frosted pane: dark `--gi-a .58 / --gi-b .14` white with a `.5` rim and no edge stroke. Light uses a `.72 / .5` grey pane, a `.9` rim and an `rgba(0,0,0,.11)` edge, with dark detail strokes.

### Contrast (measured, WCAG 2.x)

| Pair | Dark | Light | Verdict |
|---|---|---|---|
| text on bg / raised | 17.1 / 16.0 | 17.6 / 19.7 | AAA |
| text-2 on raised / field | 5.6 / 5.4 | 5.2 / 4.7 | AA |
| text-3 on bg / raised / field | 2.4 / 2.3 | 2.2 / 2.4 | **below AA**: decorative only |
| accent text on raised | 7.9 | **2.9** | AA in dark only |
| white on accent (primary buttons) | **2.4** | **2.9** | below AA, a known trade-off of the skiper21 palette |
| white on bad (Remove) | 3.0 | 3.9 | AA large only |
| ok / warn / bad text on raised | 9.9 / 8.0 / 6.2 | **3.3 / 3.1** / 3.9 | dark AA, light below AA at 13 px |

---

## Typography

**Families:** the system's own, nothing downloaded (no `@font-face`, no `font-src` in the CSP). Sans `system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', Ubuntu, Cantarell, 'Helvetica Neue', Arial, sans-serif`: SF Pro on Apple, Segoe UI on Windows (Segoe UI Variable on 11), Roboto on Android, the desktop's sans on Linux. Mono `ui-monospace, 'SF Mono', SFMono-Regular, Menlo, 'Cascadia Mono', Consolas, 'Liberation Mono', 'DejaVu Sans Mono', monospace`: SF Mono in Safari, Menlo in Chrome on a Mac, Cascadia Mono or Consolas on Windows. Both are `--font` and `--mono` in `tokens.css`.

**Base:** `400 15px/22px`, `letter-spacing: -0.011em`, `-webkit-font-smoothing: antialiased`. Body `cursor: default` and `user-select: none`, because the page is an app, not a document: a title, a label or a value is not text to copy. What is typed or copied by hand can be selected, with the I-beam: fields, the mono text (the link, a hostname, a file's name) and the configuration.

### Scale (measured live)

| Role | Size / line | Weight | Tracking | Where |
|---|---|---|---|---|
| Display number | 36 / 40 | 600 | −0.045em | Days left in "Access until" |
| Card alone title | 22 / 28 | 500 | −0.03em | "Access paused", "This link no longer works" |
| Section title | 20 / 28 | 500 | −0.025em | "Your devices", "Your access" |
| Sheet title | 20 / 28 | 500 | −0.5px | View heads, question titles |
| Empty title | 18 / 24 | 500 | −0.02em | "Add your first device" |
| Value | 17 / 24 | 500 | −0.02em | Weekly usage on a card |
| Card title | 16 / 22 | 500 | −0.02em | Device name |
| Button | 16 / 22 | 500 (600 on accent, tint, red) | −0.015em | `.btn` (`.sm`: 15 px) |
| Input | 16 / 24 | 500 | −0.012em | Name fields (16 px stops iOS zoom) |
| Step title | 16 / 24 | 500 | −0.02em | "1 Get AmneziaVPN" |
| Row title | 15 / 22 | 500 | −0.02em | Accordion heads, notice title, month total |
| Option title | 15 / 22 | 500 | −0.015em | "LAN Bypass" in its option row |
| Breadcrumb | 15 / 22 | 500 | −0.15px | The server's name |
| Question text | 15 / 21 | 400 | — | Remove / Reconnect body |
| Desc / sub / value line | 14 / 20 | 400 | — | Row descriptions, sheet subs, head values |
| Menu item, toast | 14 / 20 | 500 | — | ⋯ menu, toast |
| Meta | 13 / 18 | 400 | — | Card status, usage label, hints, "how to" paths, limit note, the option row's line, the way's second line |
| Pill label | 13 | 600 | — | Update pill, Demo chip |
| Small label | 12 / 16 | 500 | — | Kind labels, badge top line, reach tile sub, "Copy…" labels |
| Divider | 12 | 500 | +0.06em | "OR" (the only positive tracking) |
| Axis | 11 | 500 | — | Month axis |
| Calendar head | 9 / 10 | 600 | — | Weekday initials |
| Mono link | 13 | 400 | 0 | Link rows, name chips |
| Mono code | 12 / 18 | 400 | 0 | `.conf` view; the file card icon is mono 10 / 600 |

### Rules

- **Tracking tightens as size grows:** −0.011em for body, −0.02em at 15–17 px, −0.025em to −0.045em for titles and numbers. Mono is always `0`.
- **Only 400, 500 and 600.** 500 marks a title or a value, 600 marks a filled button, a number on display, a pill or a step number.
- **Numbers that change use `.num`** (`tabular-nums`), so a morph or a hover readout never shifts its neighbours.
- **Mono is for things typed or copied by hand:** addresses, links, hostnames, the configuration. Names stay in the sans.
- **One line where it fits:** names, statuses, crumbs and link rows end in an ellipsis. The full text goes in `title`.
- `text-wrap: balance` for short centred paragraphs (first device, "gone" card, secure sheet). `pretty` for left-aligned question text.
- **No uppercase** except the "OR" divider. **No ellipsis on buttons**: "Remove", never "Remove…". "…" appears only for progress and truncation. The single exception is another app's own menu label quoted verbatim ("Import Tunnel(s) from File…").
- Russian runs 20–30% longer. Every new string is checked at 375 px in Russian (`rules/i18n.md`).

---

## Layout

### Page frame

- `.page`: `max-width: 1072px`, centred. The side gutter is `max(16px, safe-area)`. The top is `40px + safe-area-top` and the bottom `112px`, so the end of the scroll clears the bottom fade.
- No navbar. The page opens with a **breadcrumb row**: 32 px high and 32 px above the content. The Dawnline mark sits in a 32 px box (logo 24 px), then the server's name (not the person's: the page is theirs), then on the right the language pill and the QR knob.
- **Edge fades** sit above the page and under every overlay:
  - **top:** 80 px plus the safe area, a `bg → 75% → 0` gradient with `backdrop-filter: blur(12px)` (not on a touch screen, where it would be drawn again on every frame of a scroll), masked `1 → .88 @44% → 0`. It shows only once `scrollY > 2`, so the breadcrumb at rest stays crisp.
  - **bottom:** 96 px, a plain `bg → transparent` gradient interpolated `in oklab`.

### Columns and order

| Width | Layout |
|---|---|
| < 560 | One column. **"Your access" first** (`order: -1`), then "Your devices". Device grid in one column. |
| 560–959 | One column, device grid in two columns (`gap 10`). |
| ≥ 960 | Two columns: devices on the left (fluid), access on the right (`384px`, `position: sticky; top: 84px + safe-area`). Column gap 36 (40 when stacked). |

Other breakpoints and container queries:

| Condition | Effect |
|---|---|
| `≤ 380px` | A code row stacks (code above its words) |
| `≤ 440px` | The scan line puts the menu path under its label for every app |
| `≥ 760px` | The sheet becomes a centred dialog (below that, a bottom drawer) |
| `@container (≤ 300px)` on the app picker | Items shrink to 44 px, padding 12 |
| `@container (≤ 330px)` on kinds | Tiles 50 px high, labels 11.5 px |

### Single card mode

When the page has only one message to show, it becomes **one card in the middle of the screen** with the breadcrumb above it.

- **The card:** `.gone`, radius 36, padding `32 24 28`, a 56 px glass icon, a 22 px title and a balanced line of text.
- **The breadcrumb:** centred on its words, with the mark hanging to their left. It is nudged right by 12 px so mark and words read as centred together.
- **What it drops:** the language and QR controls.

### Spacing rhythm

There is no strict 4/8 grid. The values in use are `2 3 4 5 6 8 10 12 14 16 18 20 22 24 28 32 36 40`. The common pairs:

- card padding **8**, with the inner block radius = card radius − 8;
- grid gap **10**, and the gap of an open accordion row **10**;
- tile gaps **8**;
- sheet padding **24**;
- section head padding `0 4 12`;
- notice below **22**;
- step spacing **20**, with 10 inside a step.

### Stacking

| Layer | z-index |
|---|---|
| Page | auto |
| Edge fades | 30 |
| Sheet root (scrim + sheet) | 50 |
| ⋯ menu | 60 |
| Toasts | 70 |
| Inside the sheet: × | 3; the connection keys' tooltip 4 |

### Scroll

Only the person moves the page: on a phone nothing the page does pulls it up or down under them.

- **No scroll anchoring** (`html { overflow-anchor: none }`). A row grows and folds in place, and a repaint glides what moves.
- **A fold near the foot takes the page down with it.** The page body holds the height the scroll needs until the rows' new shape is known, then lets go over 476 ms on EASE_OUT, which never overshoots: the scroll follows the fold down frame by frame and stops at the new foot, not short of it while the row's spring dips.
- **A repaint holds the page's height.** The content keeps its height on screen while it is refilled and lets go once everything in it has its styles, so the scroll never jumps. A page that really got shorter (a removed card) still shrinks after.
- **A reload keeps its place.** A reload or a step back onto the page opens where it was left; a fresh visit opens at the top.
- **A sheet never moves the page.** Opening it, closing it or stepping Back from it leaves the page where it stood.
- `html { scrollbar-gutter: stable }` and `body.locked { overflow: hidden }` keep the page from shifting sideways when a sheet locks the scroll.

---

## Elevation & Depth

- **Resting surfaces have no shadow.** Depth comes from the brightness ladder alone, so cards, rows, tiles and fields are all flat.
- **Floating layers get one shadow each:**
  - `--pop-shadow`: dark `0 18px 48px -14px rgba(0,0,0,.75)`, light `0 18px 44px -14px rgba(0,0,0,.2)`. Used on the ⋯ menu (plus `inset 0 0 0 1px var(--line)`), the toast and the tooltip (plus `0 0 0 1px var(--line-glass)`).
  - `--sheet-shadow`: dark `0 24px 64px -16px rgba(0,0,0,.6)`, light `… -18px rgba(0,0,0,.22)`. Used on the sheet.
- **Scrim:** 80% (dark) or 62% (light), a dim alone, as the system's own sheets. No backdrop blur: it would be drawn again on every frame the sheet and the dim move.
- **Inset rings replace borders.** Every ring is `box-shadow: inset 0 0 0 Npx`:
  - focus: 1.5 px, `text` at 16%;
  - picked kind: 1.5 px accent;
  - this device: 1 px, accent at 32%;
  - notice tone: 1 px, tone at 22%;
  - the arrival flash: 1.5 px `--ok`, fading;
  - the item a page was opened from, back on its list (admin): 1.5 px accent, fading over 1.8 s.
- **Inset context.** Inside the sheet, accordion rows use `--field` (`.acc.inset`), one step above the sheet's `--raised`. Segmented controls, badges, the file card and a row nested in one step up again (`knob 65% + field`; a badge's and a nested row's hover go to `knob`).
- **Glass icons** are the only "material" effect: a frosted pane over a 1.5 px Gaussian-blurred copy of the tinted back shape, with a rim stroke. Keep it to icons.

---

## Shapes

### Radius scale

| Radius | Where |
|---|---|
| 36 | Sheet, "gone" card |
| 28 | Device card (and the add / first cards) |
| 24 | Notice, big QR |
| 22 | Dense QR |
| 20 | Accordion row (open, and the shared ends of closed rows), usage block, ⋯ menu, the way |
| 18 | Badge, QR in a row, file card |
| 16 | Field, segmented track, reach tile, option row, the "until" block |
| 14 | Kind tile, link row, menu item and highlight, `.conf` block |
| 12 | Go button, segmented pill |
| 11 | Ends of the way |
| 10 | Name chip, badge icon tile, link row knobs |
| 9 | File card icon |
| 2.5–4 | Chart bars (2.5 month, 3 spark, 3 calendar cells), meter and time strips (the link timeline, Places), a field's and the page's selection wash (4) |
| 1 | A field's caret and selection handles, the page's selection handles |
| 999 / 50% | Buttons, pills, chips, toasts, tooltips, the switch / knobs, step numbers, reach marks, the switch's knob, the handles' knobs |

### Shape rules

- **Nesting:** inner radius = outer radius − padding. Card 28 − 8 = usage 20. Field 16 − 4 = go button 12. Segmented track 16 − 4 = pill 12.
- **Closed accordion rows touch and share rounded ends.** Only the first row's top and the last row's bottom are round. An open row lifts out with 10 px gaps and gets all four corners, and so do its neighbours' facing corners.
- **Line icons:** 24 viewBox, `stroke-width 1.8`, round caps and joins, `currentColor`. Shown at 14, 16, 18 or 20 px.
- **Glass icons:** 24 viewBox drawn at 22 (rows), 24, 26 (kinds), 28 (reach, option row), 30 (demo rows), 32 (cards), 36 (notices, add), 44 (first), 56 (gone) and 64 (questions).
- **QR codes:** round dots (r 0.42, 0.48 when dense), eyes drawn whole as rounded squares (2.6 / 1.8 / 1.5), and the Dawnline mark in a rounded tile at the centre (dense codes have none). Light dots on `#0a0a0a` in dark, dark dots on white in light.
- **The mark:** a sun dome over a horizon bar, one colour, `fill: var(--text)`: white on dark, black on light, never the accent. Clipped above the bar so the sun can rise from behind it.

---

## Components

Measurements are CSS pixels, read live at 1138 px and 375 px. Source files are under `web/src/portal/`.

### Breadcrumb · `page/frame.ts`

- **Layout:** a 32 px row with `gap 10`. The mark box is 32 × 32 (logo 24). The place, the server's name, is the one crumb: 15/22 `text` 500 with `aria-current="page"`. The person's name is not shown: the page is theirs, and on a phone it crowded the place out.
- **Language pill** (`.cr-lang`, a pick pill: see below): 32 high, pill, `knob` fill, padding `0 8`, gap 6: the language's 16 px flag disc, its 14 px 500 code and a 14 px chevron. Its popup opens under it, 10 px away.
- **QR knob** (`.cr-qr`): a knob with the QR icon. It opens into the page's code card where it stands (see below).
- **Truncation:** the place ends in an ellipsis where the row has no room for it.

### Dropdowns · `ui/drop.ts`, `styles/drop.css`

The ⋯ menu, the pick pills' popups and the page code card are one kind of thing, and share every setting; each lays out and fills its own.

- **Glass** (`.drop`): Apple's iOS 26 Liquid Glass, Regular (Figma kit), in `tokens.css` `--glass-*`: on dark black 40% with a white 4% film (the kit's black 60% + white 6% at 67%), on light `rgba(245,245,245,.6)`; backdrop `blur 28, saturate 1.8`; a soft, even 1 px inner edge, no gradient (white 5% / black 4%); a shadow on light only, soft (`0 8 32` black 12%): on dark the edge sets it apart. Its own colours: text `#F5F5F5` / `#1A1A1A`, subtitles `#8A8A8A` / `#727272`, destructive `#FF383C` (`--bad`), separators a touch softer than the edge (white 4% / black 3%); a solid highlight (`raised` + `text` 8% / 11%). Nothing dims around one. Over the page and a sheet alike (z 60).
- **Placement:** its nearest point 8 px from its button, under it where it fits, else over it; centred on it, 12 px inside the screen's edge.
- **Motion:** in, a spring out of where it grows from (`scale .5, blur 6` on SOFT, about 4% over: POP's 14% read as a wobble); out, back towards it from where it stands (`scale .7, blur 4`, 110 ms EASE_IN): quicker than it came.
- **Highlight** (`ui/glide.ts`): one for all of a dropdown's items (rows, segments), under their icons and words, solid and the same for every item (no tint for Reconnect or Remove), with the corners of what it is on. It fades in (160 ms) where the pointer or the keyboard is, glides from item to item on GLIDE (`spring(640, 40)`, about 2% over: place, size, corners), presses in to 0.97 with what it is on, and fades where the pointer leaves, or goes back to the item it rests on (a pick pill's picked segment, where it starts).
- **Shut by:** a press outside it and its button, its button again, Escape (only it: a sheet under it stays; focus goes back to its button), a choice, another dropdown opening (at once), a resize (at once). One at a time; the page holds its repaints while one is open.

### Pick pill · `ui/pick.ts`

- **What it is:** a pill showing what is picked (a lead such as a flag or a dot, its words, a 14 px `text-2` chevron) whose popup, a dropdown (see *Dropdowns*), is a row of segments in one pill frame: 3 px padding and gap, segments 34 high, radius 10 (17 at the frame's ends), 12.5 px 500, clear on the glass; the dropdowns' highlight rests on the picked one (it is what says which is picked) and glides to the one pointed at; the picked one and the one pointed at in `glass-text`, the rest `glass-sub`. Its tail (6 high, 20 wide at the base, shoulders leaving the edge level, the tip rounded) points at the pill's middle and is one shape with the frame (a clip path), so the glass runs into it; a soft even edge (`glass-edge`) traces both. The glass's shadow (light only, `--glass-shadow`) is cast by a clear pill under the frame, since the clip path would cut one off the popup; no halo.
- **Placement:** as every dropdown's, its tail's tip 8 px from the pill, inside its sheet where it fits; above by default, under where it does not fit (or under first, as the language's). Fixed to the screen (it may open on a sheet), so a wheel, a swipe or Tab shuts it too.
- **Picking:** a click opens it and a click picks. Or a quick pick: press the pill, slide onto a segment (it lights as on hover and presses in to 0.96) and let go there; let go anywhere else after sliding and nothing changes. Arrow keys move between segments.
- **Motion:** in and out as every dropdown, from the tail's tip. The pill's words morph into the ones picked.
- **Flags** (`.flag`): 16 px discs with a 1 px inner hairline; a flag not picked is at 70% until pointed at.

### Page code card · `flows/page-code.ts`

- **What it is:** a dropdown (see *Dropdowns*) from the QR knob, scrolling with the page: radius 24, padding 10, gap 8. The page's code (224 px, radius 14: concentric with the card) on top; under it Copy link (36 high, pill, `glass-text` 6% on the glass (11% on hover; Share's knob the same), in `glass-text`, 14 px 500, a 16 px link icon; it says Copied with a check for a moment) and Share (a 36 px knob) where the system has it. No ×. The knob stays where it is.

### Knob · `styles/controls.css`

- 32 px circle, `knob` fill, 16 px icon.
- Hover: +6% text. `aria-expanded` or open: +10%. Press: `scale(.8)`.
- Variants:
  - `.back`: chevron rotated 180°;
  - in link rows: 36 px, radius 10, transparent until hover.

### Buttons · `.btn`

| Variant | Fill / text | Weight | Use |
|---|---|---|---|
| `accent` | accent / white | 600 | The one primary action: Add this device, Open securely, Download (router) |
| `warn` | warn / `#241300` | 600 | Reconnect (its sheet): the colour Reconnect has in the ⋯ menu; dark ink, white on it reads at 2.3:1 |
| `tint` | accent 13% / accent | 600 | A card's **Connect** (quiet primary) |
| `soft` | knob / text | 500 | Cancel, "Add it from the device", Show key, Copy, Start over |
| `red` | bad / white | 600 | Remove |

- **Size:** 48 high (`.sm` 40, 15 px), pill, padding 0 20 (`.sm` 0 16), gap 8, `.block` = full width.
- **Hover:** a filled one (`accent`, `red`) lets its fill down to 82%, `tint` deepens to accent 20%, `soft` takes text 6% over its knob.
- **Press:** `scale(.95)`. No ellipsis, no blue text links for actions.
- **Busy:** the button keeps its size. Its content blurs away and the **orb** comes up through the blur in the button's own colour. See *Motion → Busy orb*.

### Field and go button · `.field`, `.go`

- **Field:** 48 high, radius 16, `field` fill, padding `0 4 0 16`. The input is 16/24 500 and the placeholder `text-3`. Focus: inset 1.5 px ring at text 16%, on SMOOTH.
- **Go button:** 48 × 40, radius 12, at the field's end. Idle: `knob` / `text-3`, `cursor: not-allowed`. Ready: accent / white, the colours changing on SMOOTH. Press `.9`.
- Arrow for create, check for save. The field and its go button are the whole form: no label row, no separate Save.
- **Caret** (`ui/caret.ts`, on name fields, with a mouse or trackpad; a touch screen keeps the system's): the input's own is hidden (`caret-color: transparent`) and the field draws one as macOS does: accent, 2 × 20, radius 1. It glides to where the next letter goes (see *Motion → Caret and selection*), and a click puts it where clicked at once. It blinks 0.6 s on / 0.6 s off with soft fades, stays solid while typing and blinks again 0.5 s after the last key.
- **Selection** (`pointer: fine` only): the native selection is see-through and the text keeps its colour. Under the text sits an accent 26% wash, 22 high, radius 4, with an iOS handle at each end: a 2 × 22 line with a 9 px knob, on top at the start and under it at the end. A selection grows out of the caret and, on collapse, fades in place before its ends rejoin the caret. It never runs past the input's edges, so a long, scrolled name's wash stops before the go button. On a touch screen the field draws neither: the system's caret shows (in the accent) with its own selection and handles.
- **The page's selection** (`ui/selection.ts`, `pointer: fine` only), where text can be selected (*Typography → Base*): the same look as a field's, drawn over the text instead of under it (it cannot sit under every block's), each band blending so the words keep their colour (`screen` in dark, `multiply` in light, over an opaque `accent 26% on bg`). One band per line run, 2 px taller than its line, radius 4; a handle at each end. It stands on the layer of what holds it (the page under its edge fades, a sheet, a dropdown) and is clipped to what clips or scrolls it there. A press where nothing can be selected lets go of the selection (the browser keeps it over unselectable text, which is most of the page). A touch screen keeps the system's.
- **Refusal:** a refused entry makes the field **shake** at once, while a red line under it (`ui/bad-line.ts`) says why in a few words, short enough for one line.
- **Shake** (`shared/shake.ts`): iOS's wrong-passcode shake, a damped swing sideways about four times in 0.52 s (14 px at most, settling by half), linear over its frames. The field's outline goes red with it (a 1.5 px inset ring in `bad`, as the focus ring is drawn), holds 0.7 s and fades back to the ring the field has (focused or not) over 0.8 s on ease-out; another refusal starts it red again. Another one starts from where the field is, never jumping back; only its own animation is touched, so the focus ring's transition goes on. With less motion asked for it doesn't move (the red line or toast still says why).

### Notice · `page/notices.ts`

- **Layout:** radius 24, padding `14 18 14 14`, gap 14, a 36 px glass icon, a 15/22 500 title and a 14/20 `text-2` line that adds to the title and never repeats it.
- **Tones:** `warn` (orange) for attention (ends soon). `bad` (red) for an end (out of data, access ended).
- **Placement:** one per page, above the columns, 22 px above them.
- **On a repaint** a notice that comes blurs in, one that goes fades where it stood and one that changes morphs in place, while its slot glides to the new height. The page under it moves instead of jumping.

### Section head

- 20/28 500 title with a `text-3` 14 px 500 aside at the baseline ("3 of 4", in the page's numerals), `warn` when over the limit.
- Under the grid sits a `note-s` (13/18 `text-3`) for the limit note.

### Device card · `page/devices.ts`

**Anatomy:**

- Card: `raised`, radius 28, padding 8, gap 8.
- Top row (padding `8 6 6 10`, gap 12): a 32 px glass icon (blue on "this device", else grey), the name (16/22 500, one line), the status (13/18, one line; cut short, it says itself whole in the tooltip, with why or when it last connected), a knob for what a router asked of the admin (see *A router's networks*), and the ⋯ knob.
- Bottom, one of three:
  - **Usage** (`field`, radius 20, padding `12 14 12 16`, min-height 66): "Last 7 days" 13/18 `text-2` over the total 17/24 500 tabular. Spark of 7 bars at the right: 6 px wide, gap 4, ≤ 34 px high, min 3, radius 3, `--bar`, today in accent. A day under the pointer, tapped (it stays until a tap elsewhere) or picked with ← → once the bars have focus (*Reading the bars* below) puts its name and bytes in place of the label and total instantly, with no morph; a day with nothing adds "· not used".
  - **Reconnect** (instead of the week): a `tint` block button with the refresh icon.
  - **Connect**: a `tint` block button with the QR icon.
- A status is one line, and Reconnect or Connect takes the week's place. The button is lower than the week (48 against 66), so a card alone in its row is lower too; when its bottom changes, the card glides to its new height (see *Motion → Repaint choreography*).

The grid keeps cards in place across repaints and glides them (FLIP).

**Status line:** one 13/18 line in its state's colour.

| Look | Colour |
|---|---|
| This device | accent; the card gets the accent ring and the icon turns blue |
| Connected | ok |
| Attention (settings changed, no data left, a link that fails, not set up yet) | warn, with Reconnect or Connect in the bottom where one applies |
| At rest ("Last connected 3 h ago", the exact time in `title`) | text-2 |
| Disabled | text-2, the card at 50% opacity |

A longer reason sits in `title` and, for a screen reader, in hidden text right after the status.

**Rename on the card** (`flows/rename.ts`): the name is where it is changed.

- **At rest:** an editable name is a button. Under the pointer a faint wash (`raised` + text 6%, radius 8) hugs its words.
- **Editing:** the name gives way to its own input in the same font and place, with no frame or fill: only the field's caret and selection (the name selected). The status line blurs across to a hint in `text-2`: whole words, not letters (*Whole mode*), as the hint only stands in for the status.
- **Saving:** the words shimmer (see *Motion → Shimmer*), settle to solid, and the status blurs back from the hint, words and colour.
- **Cancelling:** the name it had comes back; the status blurs back.
- **Refusal:** the words shake (no red ring here, the field has none) and the status line blurs across to why in `bad`, in its one line, in full on hover.

**Add card:** a `button.dev.add`, min-height 144, centred, grey glass plus 36 and "Add device" in `text-2` 500. Hover raised + knob 45%, press `.98`.

**First card** (no devices yet):

- spans the grid, padding `28 24 24`;
- blue glass plus 44, "Add your first device" 18/24 500;
- one balanced 14/20 line (max 34ch);
- an accent block button, max 320.

### A router's networks · `flows/behind.ts`, `ui/net-chips.ts` (`styles/behind.css`)

A router of a person's own may bring its network along (site to site). By the server's rule a person only asks: the admin takes a router, and each network behind it, or turns it down. The page says where each stands and never makes the admin's choice look like its own.

- **Adding a router** (`flows/add.ts`). Picking «Router» among the kinds folds a block in between LAN Bypass and the name (`ui/fold.ts`: height, opacity and a 4 px blur on SMOOTH, the fields under it travelling with its edge; it folds away with another kind): the option row's shape on `field`, radius 16, the router's glass 28, «Networks behind it», one line of what that means, and the chips. The line under the title morphs in place from the free slots to «A router is confirmed by the admin», and the go button says «Ask the admin». With the internet alone nothing at home reaches the person's devices, so the block is not shown. Sent, the form does not open a set-up: what it held fades (160 ms EASE_IN), the sheet glides to its new height and the title's words morph to «Asked the admin» over the request's own state: the router's glass in orange, one line, «Done». Where routers are added at once the form is the usual one, with the block.
- **Chips** (`ui/net-chips.ts`; the admin's share the base, `.nb-chip`). In a sheet the chips stand on the sheet's ground: 32 high, radius 10, mono 13/18, each with its own × (28 × 28). One that works is plain; one that waits for the admin is in the pending tone with a clock before it and «waits» after it; one the admin turned down is in the bad tone with «turned down». The last chip adds another, typed where it stands (`ui/inline-edit.ts`); why a typed one is refused is a red line under the chips, the sheet gliding open for it (how to finish is not said: a sheet is narrow). Eight at the most. They move as the admin's do (`ui/chips-motion.ts`).
- **The networks' sheet**, from a router's ⋯ («Networks behind it», with a line of what there is: the networks, «Waiting for the admin», «Turned down») and from the knob beside it. The title «Networks behind <name>», one line of what they are for, the chips, the admin's reason once under them when something was turned down (the alert, bad tone), and one accent button. Nothing is made by a press: what is typed or taken away is a draft the device keeps until the button sends it, «Ask the admin» when something new is asked for and «Save» when networks were only taken away or put away; at rest while there is nothing to send. The router's refusal is said in red over the button and the draft stays.
- **On the card** (`page/devices.ts`). Something of a router waits for the admin: a knob beside its ⋯ with a clock in the pending tone; a network was turned down: the same knob with the alert in the bad tone. Its words are a tooltip (and its accessible name), a press opens the sheet. The status line keeps saying what it always does. A router that itself waits reads «Waiting for approval» in the pending tone, its «Connect» stands at rest, and its ⋯ holds «Rename» and «Take the request back»; one turned down reads «Turned down» in the bad tone with the reason on hover, and ⋯ holds «Rename» and «Remove».
- **Tooltip** (`ui/tip.ts`, shared with the admin). A name or a status cut short by «…» says itself whole in the tooltip; one that fits shows none beyond what its hover always said (when it last connected, why a link fails). Here it may take a second line (radius 12) instead of cutting a sentence.
- «Your access» no longer lists the devices' names at home: a device's own address is copied from its ⋯ menu.

### Accordion · `ui/accordion.ts`

- **Row:** `raised`, padding `0 8`. Head 52 high, gap 10, with a 22 px glass icon, a 15/22 500 title (ellipsis), an optional chip, an optional value at the end (14 px `text-2`) and a 16 px chevron (pointing down, rotated 90°, and up when open).
- **Body:** padding `0 8 16 40` (inset rows `0 8 16 8`), column, gap 12.
- **One row open at a time.** A **still** row (nothing to open) has no chevron, no hover and no click.
- **A row inside a row** has its own open look (chevron, body, `valHide`), apart from the row around it.
- **`valHide`:** a row whose body shows the same numbers drops its head value while open (blur, fade, slide 8 px right).
- **Inset variant** (inside the sheet): rows on `field`, hover field + knob 50%. Inside them the app picker and badges step up to knob 65% over field, and a badge's hover goes to `knob`. A file step inside one steps up the same way: the file card and an inset row inside the row on knob 65% over field (that row's hover `knob`, the `.conf` it opens on `knob`), the card's icon and that row's soft buttons on knob + text 6% (hover 12%).

### "Your access" rows · `page/access.ts`

| Row | Head | Body |
|---|---|---|
| **What it reaches** (`both`, home or globe glass, by what the access reaches) | Title only | Two **reach tiles** (radius 16, `field`, padding `12 12 12 14`, glass 28, title 14/20 500, sub 12/16; a 20 px round mark at the top right: ok-soft check or knob minus, the tile dimmed when off). Then a sentence with the hostname pattern in mono, and **name chips** (32 high, radius 10, mono 13, the domain part in `text-3`, a copy icon 14). |
| **Data this month** (chart glass) | A 16 px **ring** (track `--bar`, arc accent, warn ≥ 90%, bad ≥ 100%) and "38.6 GB / 100 GB"; hidden while open | The **month**: one bar per day (flex, gap 3, 64 high, radius 2.5, min 3; days to come at 45% bar; today accent), an axis 11 px `text-3` with "Today" in accent under its bar, kept inside the axis (each of the month's ends hides where "Today" comes within 6 px of it, measured: the words' widths follow the language), the total line (`bad` when out), a 6 px **meter** (same tone thresholds), and a `.desc`. A picked day (*Reading the bars*) puts its down and up in place of the total and "21 Oct · +62%" (its date and how it compares with the month's other days; today "so far") in place of what is left, instantly. With a limit not reached, a line under the meter (12/16 `text-2`, warn when it fills within a week): the pace lately (the devices' last 7 days) and when the limit fills at it, or what a monthly one reaches by the reset (`shared/pace.ts`). |
| **Access until** (calendar glass) | "30 Nov" plus "42 days" in ok, warn when soon, or "ended" in bad | The **until block** (`field`, radius 16, padding `14 16`): the days left as a 36/40 600 number (warn when soon), "days left", the end date in `text-3`, and a **calendar** of the weeks to the end. 7 columns of 10 px cells with gap 5 and radius 3: past at text 5%, left at text 16%, today in accent, the last day ringed 1.5 px accent; warn colours when soon. With nothing to open, the row is still. |

A repaint keeps the rows on the page and changes what they hold in place, the same row open (see *Motion → Repaint choreography*).

**Reading the bars** (`ui/bars.ts` `readBars`, `shared/scrub.ts`, the same rule as the admin's charts): the pointer picks the day under it; a tap picks one and it stays until a tap elsewhere (a tap on it again lets go), so a touch screen reads a day without it flickering back; with the bars focused (a 2 px accent 55% ring, radius 6) ← → Home End walk the days and Esc lets go, each day read out to a screen reader. The picked column takes the hover look (`.on`).

### Sheet · `ui/sheet.ts`

**Shape:** `raised`, radius 36, `--sheet-shadow`, `overflow: hidden`.

| Width | Form |
|---|---|
| < 760 | **Drawer** floating 16 px from the left, right and bottom edges (plus safe areas), max-width 400, max-height `100% − 32 − safe areas` |
| ≥ 760 | **Dialog** centred by flex layout (not a transform, so text stays on the pixel grid), width `100% − gutters`, max-width 400 |

**Width plan.** On a computer the sheet widens for a dense QR code until the code gets about **3.2 px per module** (+80 px padding), capped by the viewport. Live: 400 → 448 for a key, 400 → 410–422 for a `.conf`. It then scrolls the code fully into view.

**Inside:**

- **×:** a knob pinned at top 22 / right 22.
- **Pinned keys:** a view's own buttons, pinned at top 22 / right 58.
- **View:** padding `0 24 24`.
- **View head** (`.vhead`): 76 high. Title 20/28 500, centred with a Back knob inside a flow. The head is the drag handle, with `touch-action: none` and a grab cursor. A view with no head whose top is a picture and a title (the admin's job stage) names that top the handle instead (`.vgrab`).
- **Sub line:** 14/20 `text-2`, pulled up 16 px under the head.
- **Scrolling:** what is taller than the screen scrolls inside the sheet with no scrollbar (a bar would cut into its round corners); so does the configuration in it.

**Movement:**

- **Views stack.** The sheet glides to each view's height.
- **Closes by:** ×, the scrim, Escape (instant), the phone's back button, or a pull down on its head.
- **A sheet asked for while one closes** opens once it is gone. Escape while it closes ends it at once.

**Connection keys** (`.hpill`): Download and Copy on the connection's row, beside its chevron, while the row is open (they fade in with a blur as it opens, the title making room, and go as it shuts): quiet 32 px circles, the icon 16 px in the chevron's `text-2`, a `knob` circle behind one under the pointer, its icon up to `text`.

- **Tooltip:** one 26 px pill in toast colours under the keys. It appears after 420 ms of hover, then follows the pointer (or Tab) from key to key at once, gliding from where it stands, and says "Copied" after a copy. Back on a key while it still fades out, it turns back from there.

**Question view** (`.ask`: Remove):

- left-aligned, as iOS asks now, with 24 px top padding;
- a 64 px glass icon in the action's tone, a 20/28 500 question and a 15/21 `text-2` paragraph;
- two equal buttons: **Cancel** (soft) and the action (red for Remove);
- no × beside them.

**Reconnect view** (`flows/device-actions.ts`): Add a device without its name. The head ("Reconnect Phone"), what happens as its subline, the kinds with what it is now ringed, the LAN Bypass row as it stands, and a `warn` block **Reconnect** (refresh icon) where the name field would be, 12 px under the row. × stays.

**Secure view:** centred lock glass, an accent "Open securely" button and a short note.

### ⋯ Menu · `ui/menu.ts`

Apple's iOS 26 menu (Figma kit, "Menu – iPhone"), made compact: smaller type and tighter rows.

**Surface:** a dropdown (see *Dropdowns*): at least 210 wide, radius 24, padding `6 0`.

**Rows**, 6 px in, in groups (copy actions; LAN Bypass; then Rename, Reconnect, Remove): 8 px above and below the words (34 high, 50 with a line under the label), radius 18 (concentric); the icon 14 px in from the rounded edge, more than the 10 px from it to the words, so it doesn't crowd the curve; 12 px at the right end: a 16 px icon, a 14 px 400 label (line 18) and an 11.5 px subtitle under it where the item has one (the address it copies, tabular figures; On or Off under LAN Bypass), 1 px apart. Reconnect `warn`, Remove destructive.

**Separators** between groups: 13 px high, their 1 px line 16 px in from the edge.

**Order** (the admin's menus too): groups run from calm to grave, so the tone only deepens downward and the thing that cannot be taken back is always the last row.

1. what only shows or opens something (Open, Show set-up, What's new, a link out);
2. what changes the thing itself and is safe (Rename, a note, a translation, a check);
3. what redoes or moves something of it (Reset traffic, New keys, Move to another server);
4. what stops it: off or Pause in `warn`, then Remove in `bad`, in one group, last. A component's menu ends the same way with what replaces the version in use (Reinstall, Roll back, `warn`).

A neutral row never stands under a `warn` or `bad` one, and nothing follows Remove.

**Highlight:** the dropdowns' (see *Dropdowns*), radius 18 on a row. The row under it grows its icon to 1.08 on the same spring; a press takes the row to 0.97.

**Motion and shutting:** as every dropdown's, growing from the knob's side.

### Toast · `ui/feedback.ts`

- Bottom centre, `24px + safe-area` from the bottom, one at a time; a new one replaces the shown one.
- 42 high pill, padding `0 18 0 13`, 14 px 500, an 18 px icon (check in ok, alert in bad).
- 2.4 s on screen. Used for every result and every failure.

### App picker · `ui/seg.ts`

- **Track:** 48 high, radius 16, `field`, padding `0 4`. The sheet opens on AmneziaWG, the first item (or the app the device was set up with).
- **WireGuard has no item of its own** except for a router (its own package): with the disguise off it takes AmneziaWG's file and code through the same menus, so AmneziaWG's item is both. The words name both ("In AmneziaWG or WireGuard:", "Open AmneziaWG or WireGuard", "import … in AmneziaWG or WireGuard"), a hint line under AmneziaWG's store says WireGuard works too (its name links to its store), and the share badge's small line says "Straight into the app" (two names do not fit it). On Linux a last step gives wireguard-tools' `wg-quick`.
- **Items:** icons only (20 px) at 56 px each. The picked item takes the remaining width (`flex-grow`) and shows its name.
- **Pill:** 40 px, radius 12. It stretches like skiper21's tabs: the leading edge reaches the new item first and the trailing edge follows. At rest it sits on its item by layout alone (4 px and the items before it on the left, the items after it on the right, each 56 or 44 px), so the sheet changing width carries it along with nothing watching.
- **Item colours:** idle `text-3`, hover `text-2`, picked `text`.
- **A name too long for its place** (four apps on a phone): it fades to nothing at the edge it runs past (an 18 px alpha mask, the right edge at its start). Under the pointer, or with the keyboard's focus, it glides to its end a beat later (240 ms) at 40 px/s, eased at both ends, the fade sliding to the left edge (320 ms, `--fade-l`/`--fade-r` as registered properties); it glides back as the pointer leaves, from where it stands. On touch a tap on the picked item glides it there and back. Another pick puts every name back at its start.

### Kinds picker · `flows/device-form.ts` (Add a device, Reconnect)

- **Tiles:** four in a grid (`--n` columns, gap 8): PC, Mobile, Router, Other. Each is 56 high, radius 14, `field`.
- **Icons and labels:** a 26 px blue glass icon, greyscale at 55% opacity until picked. The label sits under the tile at 12/16 500.
- **Picked:** the tile gets an inset 1.5 px accent ring **in place**, without travelling between tiles. Hover → `knob`, press `.94`.
- **Under them:** the option row, 16 px under the kinds and 12 px above the name field (see *Option row*).

### Option row and switch · `.swrow`, `.sw` (`flows/add.ts`)

One choice with a switch (Add a device's **LAN Bypass**). A line that unfolds under the words when it is switched on runs height, opacity and blur on SMOOTH from where the line is, so flicking the switch never snaps, and the row, what follows and the sheet ride along.

- **Row:** the whole row is the switch. `field` on the raised sheet, radius 16, padding `12 12 12 14`, gap 12.
- **Icon:** the `lan` glass at 28 px, blue. Grey while off (`grayscale(1)` at 55% opacity), on SMOOTH.
- **Words:** the title 15/22 500 −0.015em over a 13/18 `text-2` line, gap 1.
- **Hover:** field + knob 50% over 200 ms. **No press shrink.**
- **Switch:** a 44 × 26 pill on `knob`, accent when on. Its knob is 20 px, 3 px in, `text-2` (on: `accent-ink`), and moves 18 px. Held down, the knob stretches to 27 px toward where it goes (from the left when off, toward the left when on) and finishes the move when let go, as iOS switches do. Track colour, knob travel, width and colour all run on SMOOTH.

### Badge · `flows/setup-parts.ts`

- 60 high, radius 18, `field`, padding `0 14 0 12`, gap 12.
- A 36 px icon tile, radius 10, **inverted** (`text` fill, `raised` mark).
- Two lines: top 12/16 `text-2`, main 15/20 500.
- A 16 px trailing mark: chevron for an action, "open" for a page in a new tab.
- `.primary` (the one thing to tap in a step): the icon tile is accent-soft / accent.
- `.badges2`: two side by side, no trailing mark, while each has 150 px, room for its words on one line (a store's name never wraps); narrower, one under the other.
- Inside an inset row: knob 65% over field, hover `knob`, one step above the row.

### Set-up sheet · `flows/setup-view.ts`

**Structure.** The way sits on top, 18 px above what is under it. Under it come numbered steps, inset accordion rows, or both. A row holds what a step would: a QR with its link row, the app picker with a code and its scan line, small soft buttons, or a file card with a nested inset row for the `.conf`. Pinned Download / Copy keys sit in the head where the view has them.

**Steps:** a 24 px round number (knob, 13 px 600), a 16/24 500 title and a body with gap 10. Steps sit 20 px apart.

**"How to" path:** `Open AmneziaWG › + › Import Tunnel(s) from File…` in 13 px `text-2`, the app's own words in `text` 500.

**Scan line:** "In AmneziaWG: + › Create from QR code" ("In AmneziaWG or WireGuard:" with the disguise off). Where iOS and Android name a step differently, that word alternates every 3 s, with the  or Android mark beside it.

**The way:** a picture of the connection, with no buttons.

- **Block:** `field`, radius 20, padding `12 14`, 18 px above what is under it in every state.
- **Ends:** two 34 px rounded squares (radius 11): the device icon in `knob`, and the server in accent tint.
- **Track:** a dotted line between the ends (1.4 px dots every 9 px, `text-3` at 80%).
- **Lines under it:** the line (14/20 500) and, in the states that need one, a second line (13/18 `text-2`).

| State | The way | Lines |
|---|---|---|
| **Waiting** | A light runs along the track and rests a beat | One line |
| **Can't finish** (`.trying`) | The light turns warn, runs almost to the router and falls back (`way-knock`). A 2 × 18 warn break, tilted 18°, flashes at the router (`way-break`). The router's end turns warn 14%. | Line in warn, plus a second line |
| **Connected** (`.done`) | The track fills green from the device and the server end turns green last with a pop | Line in green |
| **No data** (`.nodata`) | The track is green and both ends too (the router's 600 ms after). Two 8 px warn packets, with a soft warn glow, take turns falling through midway (`way-drop`). | Line in warn, plus a second line |
| **Given up** (`.stopped`) | The light goes out | Line, plus a second line |

**Around the way:**

- **The sub line** shows with the waiting way only. Otherwise it folds away with its margins and the way sits right under the head, as in a sheet with no sub line.
- **On arrival** × steps away, the sheet scrolls back to the top, and everything under the way folds shut with the way's 18 px gap (see *Motion → Waiting for the first connection*).
- **Can't finish and no data** fold everything under the way shut the same way, at once, and the sheet stays: the way and its two lines are all it shows. Back to waiting, × comes back and what folded unfolds as it was.

### Code row, QR and link row · `ui/codes.ts`

- **QR:** 148 px (radius 18) beside its words (gap 14). Big: 208 (radius 24). Dense: full width, square, radius 22, words under it.
- **Link row:** 44 high, radius 14, the URL in mono 13 without its scheme (ellipsis, `user-select: all`), then copy and, where the browser has it, share.
- A code that changes **cross-fades in place**: the new one comes in first, so the place is never empty; a code of the other size scales the box to its own.
- A stand-in code (where the real one is too long to scan) takes the same place, with words beside it that say why.

### File card and configuration

- **File card:** `field`, radius 18, padding 12. A 38 × 46 "file" icon (radius 9, mono 10 600 ".conf"), the filename in mono 13, a 12 px line, and an accent `sm` block button. Inside an inset row it steps up one (*Accordion → Inset variant*).
- **Configuration:** `pre` 12/18 mono, max-height 16 rem, scrolls (no scrollbar, as the sheet).
  - colours: section headers in accent, keys in `text`, values in `text-2`;
  - **keys are masked** (`••••` in `text-3`, letter-spaced 1 px) until "Show key". The mask and the key share one place and cross-fade; the one at rest is out of sight.

### Glass icon catalogue · `ui/glass.ts`

`phone, mobile, tablet, computer, router, other, plus, globe, home, both (the internet with the home behind it: an access that reaches both), shield, chart, calendar, clock, pause, server (a terminal's prompt and the mark of the core it runs on, AmneziaWG's today), link, key, lock, check, trash, refresh, browser (a page in a browser window), file, lan (three devices joined: a network)`.

On the portal each stands for one thing: `link` a link (the row that opens yours on the device, the card of a link that no longer works), `key` the connection's key, `browser` the page or a browser (the page that could not load, «open this page in Safari or Chrome»), `server` the server (it is off, there is none yet), `home`, `globe` and `both` what an access reaches, `chart` data, `calendar` the term, `pause` a pause, `lan` LAN Bypass, `lock` the secure view, `file` the configuration, `trash` a removal. The line icons the same: the server's end of the way while a device connects is `terminal`, the server in a line.

A pane may carry a filled mark instead of strokes, or beside them (`m`, its size on the pane `ms`, its centre `mc` where strokes share the pane; `markShape(name)` is a product's mark on the square pane, each at the size it reads alike at: the set-up sheet's «Add the connection» row wears the mark of the app picked, AmneziaVPN's at .385, AmneziaWG's and WireGuard's at .46, V2RayTun's at .42, and changes with the pick; the admin's at about half the box, `dawnline`, Dawnline's sun over the horizon from `shared/mark.ts`, and `amneziawg`, AmneziaWG's, which comes with the stylesheet's module so it is there when the page stands). In Settings › Updates a component's row wears its own mark, in the tone of where it stands (the owner, 2026-11-12: «если версия последняя то синяя, если новая то другим цветом»): blue on its latest version (or a build newer than the release), orange when a newer one is out, grey before it was ever checked, and red for AmneziaWG when it is not installed. The section's head says nothing after its title when everything is on its latest version: the marks say it (it still names a job under way, AmneziaWG missing, what is available, package updates).

**What a picture stands for** (the owner, 2026-11-12: «для Network иконки должен быть не домик а буквально иконка сети», and «это пример сути, а не конкретно эдж кейс»). An icon draws the thing its row, section or tab names, never something near it; one picture has one meaning across the admin; a named product wears its own mark. Before an icon is chosen, the object is named, and that is what is drawn.

**The admin's shapes** (`admin/ui/glass-shapes.ts`, and those with a mark in `admin/ui/glass.ts`), each with its one meaning:

| Shape | Stands for | Where |
|---|---|---|
| `server` (the portal's: a terminal's prompt and the mark of its core, AmneziaWG's today) | a Dawnline server | the server's page head and its card on Overview, «General» on its rail, the «Server» section and its switch, Health's group, the notices and questions about a server, the first run's step |
| `core` (a chip) | a tunnel core in general, whichever it is | «Core» on the server's rail; the core's own row wears its product's mark |
| `amneziawg`, `wireguard`, `openwrt`, `github`, `dawnline` (marks) | the product itself | Updates' rows (Dawnline, AmneziaWG, the system packages as OpenWrt's) and their questions, the builds of AmneziaWG, «GitHub mirrors», the first run's card and its AmneziaWG step, a router's own WireGuard or AmneziaWG interface among the home networks, what Dawnline did itself in the log |
| `settings` (two sliders) | settings as a whole | the Settings page's head |
| `lan` (three nodes joined, the portal's) | a network | «Network» on the server's rail, «Auto-detect LAN», «Device hostnames», an Ethernet interface |
| `portal` (the portal's `browser`: a page in a browser window) | the personal portal | its rail item, section, switch (Settings and the new server's sheet), Health's group, the first run's step |
| `newperson` (a person with a plus) | a person to come | «New people» |
| `storage` (a store of records) | what is kept on flash | «History and storage» |
| `entry` (an arrow through a door), `out` (the arrow out) | the way in: the address and port devices connect to; leaving a page | the «Way in» / «Address» section; «Leave without applying?» |
| `tunnel` (a tunnel's mouth) | a tunnel | the «Tunnel» section; a router's VPN interface of another protocol |
| `key`, `lock`, `link` (the portal's) | a key; encryption; a link | «Interface and key», new keys; HTTPS; a new link, an invitation, the portal's address by a name |
| `cert` (a sheet with its seal) | a certificate | ACME: its packages, its notice, its question |
| `pin` | a place on the map | «Where people connect from», the location cache, the map's empty state |
| `wifi` | a Wi-Fi interface | the home networks |
| `service` (a machine in a rack) | a service at home | the home services' rows |
| `mask` | the disguise | its section |
| `route` | a path | «Check a path» |
| `update` | an update | Updates' rail item, section and «is out» notice; the stage of a check of every component |
| `backup` (an archive box) | a kept copy | Backups, «Keep the previous version», the stage of a restore or an import |
| `chart` (the portal's) | traffic | the questions that reset it |
| `refresh` (the portal's) | devices fetch their configuration again; a repair | the rollout's notices and questions, the watchdog, a job under way |
| `pulse` | a problem | notices, checks that did not pass |
| `person`, `people`, `log` | a person, people or a circle, the log | their heads, rows and empty states |

The line icons follow the same rule (`admin/ui/line-icons.ts` beside `shared/icons.ts`): a server in a menu or a filter is the shared `terminal` (a line that small cannot hold a mark), a core `chip`, people `people` and one person `person` (never `admin`, a person with a shield), settings `sliders`, a server's Overview `dashboard`, the portal `window`, a connection `plug`, a filter `filter`, the people's views `cards` and `map`, what Dawnline did itself `sunrise`. A rail item's glass and its line in the jump menu are the same picture.

The admin's shapes and line icons, and the marks a page draws as soon as it stands, come with the stylesheet's module (`admin/style-module.ts`, added in `shell/style.ts`): the pages' module is close to its size budget.

### Admin kit · `admin/ui`, `admin/widgets` (`styles/shadow/kit.css`, `widgets.css`)

The admin's own parts, on this file's tokens (no colour, radius or curve of their own). Where they stand and how the pages use them: `rules/ui-design.md`, `rules/frontend.md`.

- **Filter bar** (`ui/filter-bar.ts`). The search field (48, `/` reaches it, Escape empties it); under it chips, pills 32 high: offered on `knob` with a plus, its name in `text-2` and its count in `text-3`; active on `accent-soft` in the accent with × (30 × 32 target); «Reset» in `text-2` while anything narrows the list; the count «12 of 24» Meta at the row's end. A press scales the chip to .96. A phone: one row that scrolls sideways, its end fading 18 px.
- **A list and the page of one thing in it** (`ui/subpage.ts`). Opening a person or a device gives its page the whole column; the list waits under it with the page's head, bar, scroll and filters. A page: the way back «‹ People» (or «‹ Dima» from a device) and × (36; gone under 480), the head a size down (24/30), blocks 28 px apart, each a section head over a raised card. It comes in as a page does, and so does the list on the way back (*Motion › 16*); Escape brings the list back at once. The item opened from wears a 1.5 px accent ring inside, fading over 1800 ms (ease-out), and is scrolled to the middle when it is out of sight. Escape goes back at once.
- **A server's page** (`pages/server`, `server.css`). Everything of one server behind one door. Under the admin's row: the way back («‹ All servers»; «‹ Overview» with one server), the page head (the server's glass: blue while it runs, red when it should and does not, grey when off; its name; its state in the state's tone, the address devices connect to as a mono key that copies it, its core), then ONE track across the page's whole width (the labelled track with icons, 20 under the head, 20 over the part): Overview · People with their count · Places · Settings, a 14 px alert in warn or bad after «Settings» while a part of it is not fine; on a phone the icons alone, the picked one with its word. Overview, People and Places take the page's whole width; inside Settings the Section rail names its three parts (General · Core with the core's name under it · Network; no group name) and a part's sections stand beside it, the first with no space over it. The server's own Overview is the page Overview's blocks of this server, a section's distance (28) apart: «now», the rollout strip while devices fetch, who waits for a decision, Health (what did not pass, each row ending in a pill «Settings › Network» that leads to the part it is fixed in; else one green row), the path check. Core opens with the core's own card: one component row (the card's 24 − 8 = 16 radius inside padding 8) and a note under it, 14 in. People inside the frame loses its own row, its title and its Cards · Map track (the server's track is People · Places).
- **A device as a dialog** (`pages/server/device-dialog.ts`, `server.css` `.dv`). A device opens over its person's page, never in its place. Up to 1000 wide from 760 px of the window (the sheet glides between widths, `ui/sheet-width.ts`), the portal's drawer at the window's height on a phone. The head stays while the blocks scroll under it (12 px fades at both ends): the glass 36, the name as the Sheet title 20/28 (changed where it stands, as the portal's device card: `ui/rename-title.ts`), its facts 13/18, and its actions on ×'s line as keys of ×'s size (32, 8 apart): «Show set-up» (its icon alone on a phone), ⋯, ×. «Connection» opens the dialog across both columns, a field tile with no title over it (its state names it; the heading stays for a screen reader): online or not and since when (17/24 500 in the state's tone), under it what broke when something did as a line of its own (13/18 500 in warn, or bad with a bad state: the diagnosis' first break, «Needs a new configuration»), then the period's sums, the period's track at the state's end (over it on a phone) and the strip. The connection's way, the diagnosis' steps and a fix button are not drawn in the dialog (the owner, 2026-11-11: «сделай это заместо панели выше с подключением», «убери текст связь»); where it connects from is Places'. Under it two columns (1.12fr : 1fr, 24 apart; one on a phone), both beginning with a block head on one line: on the left what the device does (Traffic; Places), on the right what it is set up with (its own MTU and keep-alive under a head that says when its configuration was given out, its addresses) and its latest events. On the sheet's `raised` surface every block is ONE tone, `field` (radius 20 for a tile, 16 for a row), with no card around tiles; block heads are Card titles (16/22) centred in a head 34 high (its tallest control's height) that stands 6 over its tile: the words are 12 over their own tile and 26 under the tile above, so a head reads as its block's, never halfway between two. One fact, one place: the state is «Connection»'s alone (not in the head's facts), and the configuration is «Show set-up»'s alone (no file card in the blocks). «Map and replay» and «Show set-up» are steps of the same dialog with the way back in their head; a question asked from it is a step too, whose Cancel leads back.
- **Usage and its limit month** (`widgets/limit-meter.ts`; the router: `core.limit_month`). The block is «Usage», not «Limit». A month here is never the calendar's. *The limit month* is the person's own: it begins with their first traffic and ends a month later, to the minute (31 Jan → 28 Feb); the next one begins only when they connect again, so time away uses up none of it. *Charts and sums* that used to say a month show the last 30 days, today last («30 days», never a month's name; no empty days to come). The block, top to bottom: the 30 days' bars with their down and up; «50.3 GB of 50 GB» with the limit edited in place; the 6 px bar; under it one Meta line as a usage page says it, when it starts again at the left («Resets in 12 d · 20 Nov»; «The month begins when they next connect» while none runs; «For the whole term: it does not reset») and the share used at the right («93%», warn from 90, bad at the limit); the pace; then the actions as chips: «+10 GB until the reset» (from 80 %; extra data lasts until the limit month ends, and a button that gives it names that day: «+20 GB until 20 Nov») and «Reset usage» (asked first: the count is let go and a new month begins with their next traffic; their traffic history stays). The portal says the same of its own month: «Resets on 20 Nov, in 12 d. Your month began with your first connection.»
- **A person's page** (`pages/people/person`, `panel.css`), the portal's columns (*Layout › Columns and order*) by the page's own width: the head across; under it, from 760 px of the column, the main column (fluid) and the access column (`clamp(320px, 38%, 384px)`, 28 apart; ~347 beside a 537 main column in LuCI at 1440). Main: «Devices 3 of − 4 +» with the cards two across from 480 px of the column (one under it, 8 apart under 420; a card keeps its week at every width), the card that adds one a 60 px row when it stands alone in its row, a single card alone the whole row; Traffic, the device page's card with their devices summed (the week's bars, This month · Total · Now in one row from 440 px of the column, Now only while online: the person's speed lives here, not in the head); Places (rows with strips); Latest (the short feed). Access: one stack under a section head «Access» as high as the devices' head beside it, so the first cards line up: Term, Usage (see *Usage and its limit month* below), What they reach, each a raised card 10 apart with its head inside (16/22 500, the aside Meta in `text-2`, its controls at the end, 36 high), nothing folded. Without an end date the term is its head («Term · No end date») over the moves. The column sticks 16 px under the scroller's top (`--md-top`) and, taller than the window, scrolls on its own (`max-height: 100dvh − 92`, a thin scrollbar). Narrower than 760: one column, the access stack first.
- **Person card** (People, `pages/people/card.ts`; its parts are `people/card.ts`). The device card itself (`.dev`: raised, radius 28, padding 8, gap 8). Head: the face 32 (blue ring while online; red or orange only in «Needs a decision»), the name 16/22 500, up to three device tiles and «+N» at the end of the name's row (26 round on `field`, the kind 16 in `text-3`, `text` with a 7 px `ok` dot while online, warn for a fault or a configuration to fetch, 50 % when off; the tooltip names the device), ⋯. Under the name the one state line 13/18 in its tone with «· N more» in `text-2` (a decision and a long absence wrap to two balanced lines). Then, by state: presence (`field`, radius 20: «Online for 2 d» in `ok` or «Offline for 3 h · Krasnodar» 17/24 over the week's hours Meta, both a duration in ONE short unit (5 min, 3 h, 2 d) so the line never wraps beside the speed; since when exactly is the line's title; the speed 15/22 500 over a 22 px live line, 100 wide, while online), traffic (the week and the month as Label over Value beside the week's bars; the limit's 6 px bar from half of it, «of 100 GB» after the month below that), the action as the card's block button (tint; soft for resume and a link). A grid of 264 px or wider, 10 apart (one column under 560); rows stand by their tops, except «Needs a decision», whose cards stretch to one height with the button at the foot. Groups from seven people: Needs a decision · Online («7 · 3 more above») · Everyone else · Paused (50 %). Over the list a notice per thing that stops many (a server turned off with «Turn on», a rollout with «Who waits»); on a phone two or more fold into one warn line (56 high, radius 24, two lines at most) that unfolds on a tap.

  | State | Line (tone) | Presence · traffic | Action | Group |
  |---|---|---|---|---|
  | No server | «No server» (bad), no tiles | — | Choose a server | Needs a decision |
  | Access ended / limit reached | «Access ended 3 Nov», «Limit reached · 50.3 of 50 GB» (bad) | — | Extend to … / +20 GB until … | Needs a decision |
  | A device fails | «ThinkPad does not connect» (warn) | — | Advice / Set-up · device | Needs a decision |
  | End near (its last three days), limit nearly | «Access until 10 Nov · 3 days» (warn) | — | Extend / +10 GB | Needs a decision |
  | Online | — | both, with the speed | — | Online |
  | Offline up to 7 days | — | both | — | Everyone else |
  | Long away | «Not connected for 12 days · Krasnodar» (where they were last, when known) | traffic only: the week and the 30 days as everyone's (the owner, 2026-11-12: «офлайн устройство должно показывать last 7 days 30 days как в онлайн устройствах»); no presence, the line says it | — | Everyone else |
  | Never connected / no devices | «Not connected yet» / «No devices yet» | — | Link (soft) / Invite | Everyone else |
  | Server turned off | «Server Dacha is turned off» (`text-2`) | — | — (the notice) | Everyone else |
  | Paused | «Paused since 3 Nov», the card at 50 % | — | Resume (soft) | Paused |

  A configuration to fetch is a rollout, not a decision: its tile in warn, «Show set-up» in ⋯, the notice over the list. Read-only: no action, no ⋯. Picking several: the face gives way to the round mark (24, ringed 1.5 px; accent when picked), a picked card tints accent 8 %, a held one deepens linearly over 450 ms.
- **Tooltip** (`ui/tip.ts`). A pill in the toast's colours (12/16 500, padding 5 10, the glass edge and the pop shadow), one line, above what it names, or under it where a heading stands over the thing; on the other side when the window has no room; it comes up as the connection keys' tooltip does (`in, y∓3, s.96, b3 → 0`, 220 EASE_OUT) and fades where it stands (120 ease-out); from one thing to the next it glides over from where it stands (SMOOTH) as its words morph and its width glides; while said it keeps to its thing as the page moves, and fades where it stands when a repaint takes the thing away (see *16. Admin*). A mouse shows it on hover, the keyboard on focus; a finger's first tap shows it, the second follows the link. On a control that acts a finger presses at once with no tooltip, and a press puts it away. It never covers a heading.
- **Term** (`widgets/term.ts`). With no end date there is no block: the part's head says «No end date» and the moves are the card. With one, the portal's «Access until» block (`field`, radius 20): days as Display in warn in its last three days, bad when over, the calendar of weeks with today in the accent and the last day ringed; past ten weeks the same cells one a week under the word «weeks» (to 28 weeks; further, the number alone), so an extension never leaves the block half empty; an extension brings its cells in one by one (360 / 7·i). Under it the moves, two rows that keep their places whatever the term is (6 apart, a row's chips sharing it evenly, one alone taking it whole; `knob`, radius 14): the extensions «+1 month» and «+3 months», 48 high, each with where it leads («until 10 Dec», 12/16 `text-2`) as its second line, then «Date» and «No end date», 40 high. No tooltip on them (under a chip it would land on the chip below), and no chip ever crosses another on a change. Nothing else: when the date comes access stops, as a pause does, until the date is moved, and the last three days flag the person for everyone alike (no choice of what happens, no days of warning to set).
- **Limit meter** (`widgets/limit-meter.ts`). `field`, radius 20: the month as the portal's bars (64 high), «used of limit» in Value 17/24, the limit a value with a 16 px pencil edited where it stands (a 30 px field in the value's type, Return and Escape, a refusal in bad 12/16 with the shake), a 6 px meter (accent, warn from 90 %, bad at the limit), the pace 12/16 under it, then all they used since they came (Meta, `text-2`). The head: Month / Whole term as segments. Under 500 px of its column the month stands over the numbers.
- **What they reach** (`widgets/reach.ts`). Two switch rows (the portal's `.swrow`: a 28 px glass, grey at 55 % while off, the name 15/22 500, what it means now as Meta `text-2`, the switch): «Internet» (through your router / their own connection) and «Home network» (N networks / no access); 8 apart, radius `--r-row`. The last one on will not turn off: it goes back, shakes, and a line in bad says why. While home is on, what of it sits in home's own field block under its row after a 1 px `line` hairline (14 in from the sides): rows of chips that are switches (32, radius 10, mono for names, a check in `ok`, on the nested fill), the label beside them (over them for a segmented track under 440, for all under 300). Where the server uses circles, «Circle» is a row of the same shape under the block (glass people, blue in a circle), its pill with the circle's colour at the end. No diagram: the way devices → server is the same for everyone and said nothing.
- **A device's set-up block** (`widgets/config-card.ts`, in the device's dialog). Its head: «Set-up», when the configuration was given out as its aside, the one ⟳N of its values at its end. Under it the device's own values written into its configuration (MTU, keep-alive) as edit rows, then its addresses as name chips that copy. No file stands here: the configuration is «Show set-up» in the dialog's head (one way to one thing). No LAN Bypass either: it is chosen where a configuration is made (adding a device, new keys, the portal).
- **Place rows** (`widgets/place-rows.ts`). A row of the stack with a 6 px strip of when the device was there over the period (`--live` while it is there now, `--past` otherwise).
- **Map stage** (`ui/split.ts`, People › Map in `pages/people/map-view.ts`). One card (padding 8): the map and a 360 px inspector side by side from 840 px of the column, as high as the window leaves under the page's head (440–860), so the page stops there and the map alone takes the wheel; narrower, a 320 px map over the inspector, which goes on with the page. The inspector's head: «N places» (15/20 500) with «N devices online» (Meta), the scope's chip (a person or a device, × lets go) at the end, the period track across (Now · 24h · 7 days · 30 days). Its body scrolls inside, its edges fading 28 px only where rows are hidden past them. Level one: a row a city, the place rows' recipe (title, «N now» or how long ago at the end; 24 px faces overlapping 4 px, live ones ringed in `--live`, «+N» past four, then «N devices · networks»; one 6 px strip of when anyone was there). A row under the pointer or focus brings its city's markers forward and fades the rest with their arcs. A row or a marker opens level two in its place: «‹ All places», the city 17/22 500, «country · networks · now», its strip, then its devices as place rows, each the way to the device's page; the camera eases to the city on SMOOTH and holds there. Back: everyone framed again, the list where it was left with the city's row in sight and focused.
- **Empty state** (`ui/empty.ts`). A grey glass 44, the title 18/24 500, one balanced line 14/20 `text-2` up to 34 characters wide, one button (accent to make the first, soft to take filters off).
- **List of choices** (`ui/list-drop.ts`). The dropdown glass with the ⋯ menu's rows (a second line in `text-2`), the picked one with a check in the accent; 248–320 wide, it grows to 420 (a page's sections: 640) and then scrolls inside the glass; the arrows walk it. Chips that pick from several (a person, a device, a server in the Log), a value picked from a few, Settings' sections on a phone.
- **Section rail** (`ui/rail.ts`). 196 wide beside the sections from 840 px of the column (36 apart), sticky. A group: its name Meta 13/18 500 in `text-2`, then links 44 high (52 with a second line), radius 14: a 22 px glass at 60 % (full when current or not fine), the title 15/22 500, the state Meta under it, a 14 px alert in warn or bad at the end. One highlight on `raised` stands on the current link and glides to the next (GLIDE; `ui/rail.ts`: it stays in the page while the links are drawn again, or it could not). A rail of one group gives it no name (Settings and a server's Settings: the page's head or the track over it says «Settings»; the owner, 2026-11-12, of «Router and Dawnline» over the first link: «первая вкладка ниже уровня заголовка»), so the first link stands at the top of the column, and the first section's head stands level with it, their middles on one line (the head 6 px down). A pick swaps the section on screen; nothing follows the scroll. Narrower: a sticky pill «the current section ⚠ 2 ▾» (40, `knob`, press .96) that opens the list of choices with every section.
- **Section** (`ui/section.ts`). 40 above it; the head: a 22 px glass in the state's tone, the title 20/28 500 −0.025em, then quiet Meta 13/18 (a ⟳N mark, «2 checks passed» with a 14 px check in `ok`, what did not pass in warn or bad), one action at the end. Its parts are raised cards 10 apart (radius 24, padding 8, blocks inside 10 apart on `field`, radius 16); a caption 14/20 500 over a part with its buttons at the end (min 40 high), a note Meta 13/18 `text-2` under it. Nothing in a section folds. A check that did not pass stands first in the section's first card: a note on `field` tinted 9 % warn (bad for an error), a 28 px glass, its words, and its fix as a 36 px button (tint for an error, soft for a warning).
- **Option tiles** (`ui/option-tiles.ts`). A choice of two or three whose options are drawn, not described. A tile: `field`, radius 16 (the Settings card's 24 − 8), padding 14/16; a picture of what the option does, its name 15/22 500, one sentence at most (Meta 13/18), facts as pills (24 high, radius 12, 12/16 500, on `knob` 65 % over `field`; on the picked tile `knob` + text 7 %). The one in use: its fill a step up (`knob`), its picture in colour, a 20 px accent mark with a check in its corner; the others an empty 1.5 px ring and a grey picture. Waiting to be applied: the mark in warn, the one still running a dot in an accent ring, and the page's line under the tiles says «Not applied yet. Now: …». No ring around a tile and no word «now». A tile the router cannot run: 55 %. Hover `knob` 50 %, press .98; arrows move between them. Two pictures so far: **a way** (the portal's: 34 px boxes with a line icon, 1.4 px dots every 9 between them, a word 11/14 under each; the stop an option adds on `accent-soft`), for how internet traffic leaves; **a level** (an icon of what is measured, three 12 × 5 pips, what the level means in words), two a tile, for the disguise (how hidden, how fast), with the apps that take it as pills (`widgets/disguise-levels.ts`).
- **A value on a scale** (`ui/range.ts`). A 6 px track on `knob` + text 6 %, the accent to the knob, a 20 px white knob that follows the pointer 1:1 (a handle: one of the things that move), steps of its own and a hold onto a mark within 8 px; the values worth knowing as dots on the track, named under it (the number 12/16 500, a word 11/14 `text-3`). Automatic is the scale's own state: the knob hollow where automatic stands, a smaller ghost where it differs for phones, the fill `text-3`. Arrows step, Page keys five steps, Home and End the ends.
- **A server's link values** (`widgets/link-values.ts`, Settings › Devices). MTU: a `field` block (radius 20) with its name, ⟳N and an «Auto» key at the head's end (lit on `accent-soft` while the router picks), the number as its own field in Display 28/34 600 (no frame until pointed at), what it applies to beside it, the scale 1280–1500 with «mobile networks · auto · WireGuard · Ethernet», one line of what MTU is. Keep-alive: a track «Off · 15 s · 25 s · 60 s · Own» (a small field under «Own»), one line of what the picked one means. Both wait for «Apply».
- **A server's way in** (`widgets/entry.ts`, Settings › Address). A `field` block: «Address» and «UDP port» as two named cells of one address in mono 17/24 500 with a `:` between, each edited where it stands, ⟳N and the copy knob at the block's right; under a hairline the router's verdicts as rows (a 20 px mark: check on `ok-soft`, alert on warn or bad, a quiet dot for a plain fact; the fact 14/20 500; its proof at the row's end in `text-2`): where the address points, whether anyone reached it from the internet and when, what the port means. The first row follows what is typed. On a phone the address takes a line of its own. No state dot.
- **A network with its switch** (`widgets/net-switches.ts`, Settings › Home network). Rows touching on one `field` list with shared round ends: the interface's glass (blue while home access leads there, orange with no firewall zone), its name, its subnet in mono and its zone as the line under it, the portal's switch. The LAN found by itself is on and locked, «Auto» beside its switch. Not tiles: a tile says «one of», a switch «this one too». The interfaces that cannot be home networks fold under the list behind a pill «N interfaces are not offered» (its chevron turns), **by reason** (the owner, 2026-11-12, of the old run-on list: «сейчас сломано»): rows touching on one `field` list (radius 16, 2 apart, padding `11 14 11 16`), the reason once as the row's name (14/20 500), the interfaces it holds for in mono `text-2` at the row's end, wrapping under it where they do not fit; six ports of one bridge are one row.
- **Who sees whom** (`widgets/visibility.ts`). The rule on a track (Nobody · Everyone · In circles), its meaning in one line, and under it the rule drawn with the server's own people: every group whose devices reach each other a tile with their faces (a circle: its colour dot, its name, the count, a pencil; the last tile makes a new one); people in no circle and people with internet only as quiet lines.
- **A list of people to tick** (`flows/circle.ts`). Rows 44 high on one `field` box (radius 16) that scrolls inside from seven: the face, the name 15/20 500, a second line only when it matters (another circle with its dot, «moves from …» once ticked), the option tiles' round mark at the end; a search over it from nine people; the head counts the ticked; who the choice does nothing for stand last under one line that says why.
- **Measure with its limit** (`ui/measure.ts`). `field`, radius 16, padding 12/14/12/16: the label Meta, «used of limit unit» in Value 17/24 500 (the small words Meta in `text-2`), a 6 px bar (accent; warn from 90 %, bad at the limit; its width on SMOOTH), a line 12/16 under it. The limit is changed where it stands: a value with a 16 px pencil that opens the list of choices, or an inline edit. Two measures stand side by side from 560.
- **Inline edit** (`ui/inline-edit.ts`). A value pressed becomes its own field in the value's type and place, as wide as what is typed; Return takes it (a refusal: the reason in bad where the part says things, the shake), Escape, a press elsewhere or the focus gone put it back. On a touch screen the field is 16 px (no zoom).
- **A week of traffic** (`widgets/week-use.ts`). «Last 7 days» over what was downloaded and uploaded in them (`↓ … ↑ …`), beside the days as the portal's bars. A day under the pointer, picked by a tap or with ← → on the bars, puts its own name («Today», «3 days ago») and numbers in the sum's place, at once (a hover readout never morphs). One part wherever a week is shown: a device's card on its person's page, the Traffic card of a device and of a person (the owner, 2026-11-12: «в девайсе трафик last 7 days должен работать по такому же принципу как в карточке устройства в персоне, и при наведении на бары»).
- **Row of a thing** (`ui/comp-row.ts`). The Updates block's component row for other lists (home services, circles, the portal's addresses, backups): a 28 px glass (or a circle's colour dot), the name 15/22 500, a state line Meta (mono for an address or a file), its actions in sight at the end (a button, 36 px knobs). Rows touch on `field` and share round ends.
- **Dock** (`.kt-dock`). The glass at the window's foot, in the layer: up to 520 wide (Settings' changes: 560), 60 high, radius 30, 20 from the edge plus the safe area; it rises from under the edge on a transform alone (SMOOTH) and leaves on EASE_IN (180). People's selection, and a server's changes that wait: «3 changes» 15/20 500 over «39 devices will fetch the configuration» Meta, Cancel (soft on the glass) and Apply (accent); the counts morph.
- **A chip that toggles** (`.chipb[aria-pressed]`: a choice row's chips, the ports found at home). On: a fill one step up (`knob` + text 10 %), the words in `text`, a 14 px check in the accent before them; off: `knob`, `text-2`. The option tiles' language. No ring (the owner, 2026-11-11: «вот такие пиллы надо заредизайнить», then «исправь» for an accent fill): a ring on a pill reads as a focus outline, an accent fill as a button.
- **What the log records** (Settings › History). Three independent yes / no, so three switch tiles in a row (one column under 640): the kind's name, how many events of it the log holds now, the portal's switch. Not chips.
- **Automatic updates** (Settings › Updates, `router/updates-policy.ts policyPanel`; a panel of its own under the components, the owner, 2026-11-12: «заредизайни это и отдели в отдельную панель»). A caption, then the choices as lines touching on one list (`field`, radius 16, 2 apart, padding `14 14 14 16`): a name 15/22 500 with a Meta note under it, and the control that makes the choice at the line's end, standing open (no row that folds): how often it checks and whether it installs as pills that open a list (`valuePick`; tracks of five intervals did not fit beside the name in Russian and squeezed it to a word a line: the owner, «лучше сделать а-ля дроп-даун»), the words never getting less than half the line; the time of a scheduled run in mono inside its own sentence, edited where it stands (how to finish, or why not, on a line under it); what it installs as chips that toggle on a line of their own, the note turning warn once AmneziaWG is among them. Then «Keep the previous version» and «GitHub mirrors» as switch rows.
- **Latest updates** (Settings › Updates, `router/updates-policy.ts`; a panel of its own, last in the section). A caption with the way to the Log as a pill at its end, then rows touching on one `field` list (radius 16, 52 high): a 20 px mark in its tone (check, a download for what a check found, × in bad), what it was about as the row's name 14/20 500 (a component with its versions in mono, the one it left in `text-2`; what was found), how it came about under it in Meta (by you or by itself, how long, in bad why it failed), how long ago at the row's end in `text-3`. Not sentences.
- **A device's set-up in the admin** (`flows/setup.ts`). Two tracks of one width under the lead: the app (AmneziaWG · AmneziaVPN), then the form it is handed over in (QR · .conf · Text; AmneziaVPN's key has no file: QR · Key), the code first for a phone or a tablet, the file for a computer or a router. Under them the form itself (the QR card, the file card, the configuration's text in the portal's `.conf` block: sections in the accent, key names in `text`, scrolling inside from 15 rem; a key wraps) and Copy and Download (.conf only). «Show set-up» shows this and nothing else (the owner, 2026-11-11): the wait for a first connection belongs to Add and New keys, where the portal's way stands under the head. Showing it marks nothing: a configuration counts as given out when it is made (a new device, new keys) or fetched on the portal, never because the admin looked at it; the lead says only whose device it is.
- **Release notes** (`flows/whats-new.ts`). Under the head one row: the date (a pre-release as a warn pill), then two quiet 36 px keys on `field` at its end (copy, the page on GitHub; their names are tooltips, so the row never wraps). The notes: a point a row with its own 4 px dot in `text-3`, 8 between points; code on `field`. Notes that could not be read: why on a `field` block (radius 16, Meta in `text-2`) with «Try again» (soft, 40) at its end, in the notes' place. The same view is a version's page among Dawnline's other versions: a step with the way back, the version as its title, and one block button 20 under the notes.
- **A job's stage** (`flows/job-stage.ts`; an updater job in `flows/operation.ts`: Dawnline itself, AmneziaWG, the system packages, a check, a translation, installing what a feature misses; a restore or an import in `flows/restore.ts`). One view from the job's start to its end, in the question's own anatomy (*Sheet › Question view*), so the question, the work and what came of it are one shape and nothing is laid over anything (the owner, 2026-11-12: «переработать модалку с обновлением… там сейчас наслоплено»: the old one was a head, a line, a track, a lone clock and a text fold, with the end put into its middle under a second title). **The top:** the picture of what the job is about, 64 px (a component's own mark; `update` for a check of all of them, `backup` for a restore) in the tone of where the job stands (blue under way, green done, red failed, orange when a check found something newer or the router stopped answering), the title 20/28 500 (the job in words, then what came of it, wrapping freely), one line 15/21 `text-2` under it (that it may be closed; then why it failed or what happens next; none when the title says it all). No view head: × stands at the sheet's corner and the top is the drag handle (`.vgrab`). **The steps**, 18 under the top: one `field` block (radius 16, padding `14 14 14 12`), a step a row 10 apart: a 20 px round mark and its words 14/20. Done: an `ok-soft` check, the words in `text-2`. Under way: a 6 px accent dot that breathes on `accent-soft` (1.8 s, still with less motion), the words in `text` 500, and the job's time at the row's end (Meta, tabular): it is where the job is, not a warning, so not orange. Where it failed: × on `bad-soft`, the words in `bad` 500. Not reached yet (a restore's steps are known ahead): a `text-3` dot on `knob`. **The log**, 8 under them: the portal's inset accordion row («Operation log», the `log` glass), its Copy key beside the chevron while it is open, the lines in mono 12/17 on `knob 65% + field` (radius 12, at most 240 high, scrolling inside), as the set-up's `.conf` (*Accordion › Inset variant*). **The actions**, 20 under, at the foot and only once there is something to decide: «Done» (accent) after what went well, «Close» (soft) after what did not, «Close» and «Update» after a check of one component that found a newer one. **The end** changes the same parts in place: after an install the steps go (the title says it: «AmneziaWG 1.0.20251101 is installed»; the packages' names as the line); after a failure or a silence they stay, so the step it stopped at is in sight, and the line says why and that nothing else was changed; after a check they give way to what it found. **What a check found:** the components as rows of one list (`.checks`), each as its row in Settings › Updates: its mark in the same tone (blue: nothing newer, orange: a newer one is out, red: its check failed, grey: not installed), its name, and under it its version or its move in mono («0.18.0 → 0.18.1»), the count of package updates, or the router's reason; a 20 px round mark at the row's end (check on `ok-soft`, an arrow pointing up on warn 14 %, an alert on `bad-soft`). The title says the whole once («Everything is up to date», «There are updates», «Not everything was checked», «The check failed»); one component whose check failed has its reason as the line and no list. **Dawnline's own job** runs here as every other (it was a notice of its own with its own progress, failure and log sheet). Installed, it has no button: the line says the router is restarting its services and the page reads itself again once the router answers with the new version (the owner, 2026-11-12: «предлагаю сделать автоматический релоад страницы»); «Reload now» comes only when 45 s passed without that answer. A translation's job ends the same way, the page reloading by itself after 4 s. Closing the sheet leaves the job running: its row in Updates says «Updating…» and opens the stage again, titled by the job (`updater/jobs.ts jobTitle`). The «is out» notice over the components only announces a version that waits (What's new, Update now) and steps aside while any job runs.
- **Dawnline's versions** (`flows/versions.ts`). A lead (which one is installed), then the releases as rows of one list (`.checks`, each row a button 52 high): the version in mono 13 with its marks beside it (pills 11/16 500: «Installed» on `accent-soft`, «Pre-release» on warn 14 %), its date under it in Meta, a 16 px chevron in `text-2` at the end. A row opens the version's own page in the same sheet (*Release notes*) with «Install 0.18.1» at its foot: accent for a newer one, `warn` for an older one, which then asks about the backup first; none for the one installed, while another job runs (the lead says so) and for a read-only login. No button in the rows and no pager (there were a notes knob and «Install» in each of five rows under «Newer · Page 1 · Older»): «Show older» (soft, 40, centred, 8 under the list) adds the next five. A list that could not be read: the notes' block of why with «Try again». Last, 20 under: «A version by its tag», the name 13/18 500 over the portal's field, whose go button is at rest until something is typed.
- **Packages and versions** (`flows/packages.ts`). A block a feature on `field` (radius 16, 8 apart): its head as a row of a thing (a 28 px glass, the name, what it is for), then a row a package under the head's words: the name in mono 12 on the left, its version in mono `text-2` at the right end, in warn with its move when the feeds have a newer one («6.11.0-r1 → 6.11.0-r2»), «not installed» in words. A version that does not fit beside its name goes under it, still at the right.
- **Paddings, checked** (the whole admin; the owner, 2026-11-11: «каждый элемент интерфейса должен корректно следовать правилам»). A surface is anything with its own fill and round corners (a card, a tile, a row). Its content stands at least 8 px from every edge; words 12 from the left; words that begin or end a card 14 from that edge (the card's 8 and 6 of their own); a single row's content in the middle of its height; a surface nested in another's corner has the outer radius less the gap between them (a Settings card is 24 round with 8 of padding: its tiles are 16; a portal card is 28: its tiles 20); a line of words never touches a tile (4 px at the least, 6 by the rule below). The concept's `tools/ia3-pads.mjs` measures every surface of every page and sheet at 1440 and 390 against these and must print «0 findings» before a change of the admin's look ships. **Controls are measured too** (its second pass; the owner, 2026-11-12, of a track whose pill sat low: «линтер паддингов, отступов, закруглений и прочего нужен»): nothing in a control is taller than its inside (a 32 px tab in a track 28 high inside is a finding: a lower track sets its tabs' height with it); a track's pill is as far from the top as from the foot, by the track's own padding, and concentric with it (the track's radius less that padding); the picked words stand in the pill's middle, and a one-line control's words in its own (1.5 px of slack); a filled part in a control's corner is concentric with it. The stand-in must draw the pages for any of this to count: it answers the backend's stream from its fixtures (`src/ia3/stream-stub.ts`), and a run over pages that did not open measures nothing.
- **A name, a value, a note** (the whole admin; the owner, 2026-11-11: «подписи у айтема визуально накладываются вместе с остальными ноутами… нет чёткого разделения или отношения одного к другому»). Three voices that never share a look, and nearness that says what belongs to what. **A name** (a field's label in a sheet, a caption in a card) is the text's colour with a weight: 13/18 500 over a field, 14/20 500 over a card's block. **A note** (what explains the thing over it) is `text-2`, regular, 13/18. **A lead** (what a step or a sheet is for) is `text-2` 14/20, once, under the head. A note stands 6 px under what it explains and at least 16 px (20 in a sheet) before the next name, and starts on the left edge of the words it explains (in a card: 14 in from the tile's edge, where a row's name starts; a caption starts 8 in). One note a thing: a second sentence joins the first, goes to the lead, or is dropped when the router's own verdict says it. A verdict is not a note: it carries a mark or a tone. A note that belongs to a tile lives inside the tile.
- **A sheet's rhythm** (the admin's sheets, `styles/shadow/sheets.css` › «The sheet's rhythm»). One set of gaps for every view, whatever flow builds it: the lead tucked under the head, 18 to the first group; a name 6 over its control and a note 6 under it (one group), groups 20 apart; a footnote 12 under the actions; 20 over the actions and 8 between them; 24 at the foot. A flow does not set these itself; a new kind of block at a view's top level is named in that rule set. The concept's `tools/ia3-sheets.mjs` opens every sheet and prints the gaps between its blocks (under 6 and over 26 are flagged).
- **⟳N** (`ui/edit-rows.ts reMark`: how many devices fetch their configuration again after a change). A 22 px pill on warn 14 %. It stands at the right end of what it belongs to (the owner, 2026-11-11: «не нравится что 37 находится не по правой стороне»): before a row's value or its switch, with the copy knob at an address row's end, at the end of a section's head, of a card's caption, of a measure's label line, of a block's head. Never between a name and its value.
- **A field that picks as it is typed in** (`ui/combo.ts`). The portal's field (48, radius 16) with its name inside in `text-2` 13/18, the picked thing's icon in a 28 px box on `knob`, the words 15/22 500 and a 40 px chevron key at the end. Under it the list of choices' glass and rows, as wide as the field (248–420), narrowed to what is typed (a row's second line counts: a device is found by its person); the keyboard stays in the field: arrows walk the rows, Return takes the one they stand on (a still `glass-hl` highlight), Escape shuts the list; what is typed and is no row is taken as it is (an address, mono). The picked one says more than its row where the row alone is ambiguous («iPad · Vika»). Never a browser datalist. Used by Settings › Check a path (from a device, to a home service).
- **The portal's port and unknown links** (Settings › Personal portal). The port is a part of the link: a tile draws the main link in mono with the port in its place on a nested fill, edited there, and one line of what the port means (or why a typed one is refused). What an unknown link opens is a choice of two on a track («Not found» · «Another address») with the address row under the second and one line of what the picked one does. The certificate's card stands under them (it follows from the address and the port).
- **A value that waits to be applied** (Settings, a person's page: nothing that changes how a server works or what a person may do is made by one press; «Apply» in the dock makes it, asking once first only when devices fetch their configuration again). On a person's page the part's head carries «not applied» (the ⟳N pill's shape, 12 px) and the part is drawn as it would be. In Settings its field shows the new value in warn, with «Not applied yet. Now: …» under it (Meta, warn); a tile picked next wears the warn mark; an address row's chip says «not applied». Nothing else on the page changes until Apply.
- **Rollout strip** (`widgets/rollout.ts`). A raised card (radius 24, padding 8): a 32 px round ⟳ mark on warn 14 %, the count 15/22 500 with the change and when under it (Meta), the way to People at the end (no «Remind everyone»: a person is reminded with their own link); one cell a device (radius 3, 16 high, 2 apart; done in `ok` 70 %, waiting in warn; a 6 px meter past 60 devices); then who has not fetched yet, two columns of rows (a glass, «device · person», when it was last seen, a 36 px knob that copies the person's portal link). It comes in softly when devices start waiting (opacity, 6 px, a 4 px blur; 280, EASE_OUT).
- **Feed with a time column** (the Log, `pages/log`). The feed's rows with the time first (46 wide, Meta, tabular), day heads that stay under the top edge while their rows pass (the ground's own colour, fading 12 px), the server a quiet word at a row's end (gone under 700; under 560 the time is at the end again).
- **A server's card on Overview** (`pages/overview/servers.ts`). The door to the server's page, raised, `--r-row`. Its row: a 28 px glass, the name (15/22 500), and under it the server as its page's head names it, on one line: its state in the state's tone, « · », the address devices connect to in mono 12 `text-2` (it ends in «…», the state never). Then its figures as NAMED cells, 96 wide, 20 apart, the name Meta 13/18 `text-2` over the value 15/22 500: People · Waiting for a decision (warn; the column stands on every card while anyone on any server waits) · Now (↓ speed to the devices) · Today; a figure there is none of is «—» in `text-3`. The cells stand in the same columns on every card, so two servers are compared down a column: «Turn on» of a server that is off stands between the name and the figures, never after them. A number with no name beside a grey address in the middle of the row is not a figure (the owner, 2026-11-11). Narrower than 800 px of the page the figures go under the name in as many columns as fit one whole (two by two on a phone).
- **Health as a list** (Overview, `pages/overview/health.ts`). The most pressing check that did not pass is the page's one notice; the other failing ones are rows under it; what passed stays in sight grouped by what it is about, a component row each (`overview/model.ts checkGroups`): the router, each server under its own name, the portal. A row: the subject's glass in the tone of its worst check (green, orange, red; grey for a server turned off), its name, under it the checks that passed in ONE quiet line (Meta, joined by « · », each with its detail as its title, a skipped one in `text-3`), and at the row's end its count («6 of 6» in `text-2` with a 14 px check in `ok`; in warn or bad with an alert when not all did; «off» for a server that does not run, whose row then has no line). A check is named by what it checks, never with the core's or the server's name in it: inside a server's row the « (name)» the router adds is dropped, and a failing check is not named again in its group (the notice and the rows above have it). Never a cloud of ticked phrases (the owner, 2026-11-11: two dozen marks that repeated «AmneziaWG … (Ames Gateway)» told nothing apart). A two-line row keeps 11 px over and under its words. A check a Settings section is about is a link as a whole («Fix in Settings ›» at its end, in `text-2`); only a check no section is about keeps its fix button. The foot: the watchdog in one line with its switch, «Check again».
- **A track of tabs that does not fit** (`ui/tabs.ts`, `tabs.css`). It scrolls, wherever it stands: on a page, in a sheet, in a dialog (a sheet lives outside the page's container, so a rule tied to the page's width never reached it, and on a phone the devices of «Where they have been» were cut off at the sheet's edge). Every tab stays in the track and in the keyboard's order; a finger swipes it; no scrollbar. Each end that has more beyond it fades over 28 px (a mask on the track, driven by the track's own scroll position; where scroll-driven animations are missing the ends are marked by an observer and the fade eases in 200 ms). A pick brings the picked tab whole into view, past the fade, with only the track scrolling (smoothly, unless less motion is asked for), and a track is opened with its picked tab in view.
- **Networks behind routers** (`widgets/net-values.ts`, `flows/behind-ask.ts`, `styles/shadow/behind.css`; classes `nb-*`). A router that is someone's device may bring its own network along (site to site). *Where they are set:* a server's Settings › Network, the card «Networks behind people's routers»: a row a router (the router's glass: blue with networks, grey without, orange while its list waits; its name with its person as a link to the device's dialog, a chevron after the words), and under the name its networks as chips. *A chip* is the name chip's shape a step up (32 high, radius 10, `knob`, mono 13/18) in two parts, as a filter's chip: the address, pressed to change it where it stands (`ui/inline-edit.ts`, the field in the chip's own shape), and its own × (28 × 28). The last chip adds another (dashed outline, «+ Network»). What waits for «Apply» is in the pending tone (warn 14 % with warn text), one taken away is struck until then and a press brings it back; under the list one line says what the router has now («Not applied yet. Now: …»). Why a typed network is refused is a red line under the chips, the row gliding open for it; how to finish stands beside the chips, on their line, so nothing under them moves. A change is one staged change whatever the number of routers, and ⟳N counts only the devices whose configuration names the changed routers' networks. *What a router's owner asked for on their own page* is the admin's to answer, at once, never through the dock: a network asked for is a chip in the accent's tint with its two answers in sight (✓ and ×, 28 × 28; 40 × 40 and 6 px apart under a finger) and one accent line under the chips saying who asks; a router asked for is the whole row's question, its networks read-only chips, «Accept» (tint) and «Decline» (soft) at the row's end on a wide page and under its words on a narrow one, with what the admin should know before taking it as warn lines (a person with Internet access brings the whole place's internet into the tunnel; devices kept apart will not reach it). «Decline» opens a menu at its button: three reasons and «Without a reason»; the owner reads the one picked. Each answer is said in a toast with Undo, which puts the question back. A refusal of the router's (a network that shares addresses with one something has) is said in red where the row says things, and the question stays. *In the device's dialog* the same question is the first block of Set-up (`.nb-ask`: the accent line, the chips, the warnings, ⟳N with its words, the two buttons side by side, each half the block), and a router's networks stand under its addresses as copy chips with a pill link to the Network section; a router that waits has no «Show set-up» in the head and only Rename and Remove in ⋯, and its state reads «Waits for your answer» in the pending tone. *Elsewhere* a card never holds the question: a device's card on its person's page shows «Answer the request» (tint, the clock) where «Show set-up» would stand, and the People list has the line «Asks for the router …» with «Answer»; both open the dialog. A router asked for and turned down leaves the admin's lists. *Adding a router as the admin:* the form's block «Networks behind it» (the option row's shape: the router's glass, the name, what it means, the chips under the words) folds in with the kind «Router» and away with another (`ui/fold.ts`); nothing is asked, the networks are saved with the device. *The rules of people's pages* are the next card, «Routers on people's pages»: two pick rows (pill value picks: Off / On request / At once; On request / At once), the second gone while the first is Off, one line under them for what the pair means, in the pending tone where something is made with no answer of the admin's; both wait for «Apply». *Motion* (`ui/chips-motion.ts`): the page stands still and a press draws the row again, so each chip goes on from where its own stood: one that stays glides to its place (FLIP on SMOOTH), one whose look changed crosses in place through the blur (out 160 ms EASE_IN, in 280 ms EASE_OUT after 60 ms), a typed one takes the field's place, any other new one comes in from nine tenths on SOFT, one that left fades where it stood (160 ms EASE_IN) while the rest close up, and the row glides to its new height; a line that comes or goes under a list unfolds or folds so the cards below travel with it; a request answered folds away where it stood. The device grid of a person's page moves as the portal's: a card removed fades where it stood (180 ms EASE_IN, 4 px blur), the others glide to their places, the grid to its height.

### Demo-only pieces · `demo/` (not in the router build)

- **"Demo" and GitHub, one split pill** just before the language pill (`demo/crumbs.ts`): accent-soft, 32 high as the knobs beside it, "Demo" 14 px 600 with a down chevron, then GitHub's mark (38 wide). The halves are 2 px apart; their outer corners are half the height (16), the inner ones 4. Hover (a mouse only) deepens the tint to accent 20%; a press scales a half to 0.94. Over a card alone (no language) "Demo" stands alone after the place: 26 high, round, 13 px.
- **On a phone (< 560 px) the pill is a dock** at the bottom right, 20 px above the safe area, since the breadcrumb has no room for it. It lives in `<body>`, outside the page: the page's entrance and a scenario's swap move the page with a transform and a filter, which would carry a fixed child along and leave its glass undrawn until they end. Glass (`--glass-bg`, blur 28 saturate 1.8, the glass edge), 36 high, "Demo" with an up chevron, GitHub 40 wide; the halves 2 px apart, corners 18 outside and 5 inside. Over the bottom fade, under the sheets (z 40). It rises from under the screen's edge (620 ms, EASE_OUT, 260 ms into the first wave) on a transform alone: Safari leaves a backdrop blur undrawn while the element's opacity is animating. Hover is a 7% film over the glass, never in place of it.
- A scenario's swap dims and blurs `.page`, not `#app`: a filter on `#app` would carry the fixed edge fades along until it ends.
- Scenario drawer: grouped rows on `field`, 2 px apart inside a radius-20 group, 60 px min, glass 30; the current row in accent with a check.

---

## Do's and Don'ts

**Do**

- Build from the existing classes and tokens (`--bg … --knob`, `--text-2/3`, `.btn` variants, `.knob`, `.acc`, `.field`, `.badge`, `.seg`, glass icons). A new class uses the same tokens.
- Step surfaces up in brightness: a block inside `raised` is `field`, a control on `field` is `knob`.
- Keep the accent for the one primary action and for "you are here". Use tone colours only for their states.
- Say a state once, where it matters, in its colour. One notice per page.
- Put numbers in `.num`, hostnames and links in mono, and one-line names with `title`.
- Make every changing text go through `morphText`, and every appearing block through a blur-in (see *Motion*).
- Check every new string in Russian at 375 px.
- Respect the CSP: no `style=` attributes. Set styles through `el.style` and colours through classes.

**Don't**

- Add borders or dividers to separate surfaces (the "OR" divider and the menu separator are the only lines).
- Add shadows to resting cards, or more than one shadow to a floating layer.
- Use blue text links for actions. Use buttons and pills.
- Put an ellipsis on a button or menu item.
- Use the accent for decoration, or a new hue for anything.
- Animate with ad-hoc durations and curves. Use the springs and the two eases (see *Motion → Curves and durations*).
- Animate in response to the keyboard (Escape), or rely on motion to convey a state.
- Use `--text-3` for text a person needs to read (see *Contrast*).

---

## Motion Design

### Philosophy

Motion in the portal does three jobs:

- **Continuity.** Things move from where they are to where they go: cards glide, sheets glide to their new height, letters slide.
- **Causality.** A response grows out of what caused it: a menu from its button, a dialog from its centre, a toast from below.
- **Calm feedback.** The orb shows waiting, the check shows a copy, the green way shows a connection.

It never decorates, never loops without a reason (the only loops are the busy orb, the way's light, its knock and falling packets, a focused field's caret and the OS alternation, each tied to a real state), and **never blinks**: nothing is torn down and redrawn in sight. The caret's blink is the system's own beat for a field that has focus, not a redraw.

Six rules hold everywhere:

1. **Springs, not durations.** Layout motion runs on physical springs (stiffness, damping, mass 1), sampled into CSS `linear()`, so CSS transitions and script animations share one curve.
2. **Exits are quick, entrances are soft.** Exits use an ease-in curve and run 120–220 ms. Entrances use ease-out or a spring and run 280–572 ms. In a cross-fade the incoming part waits 60–110 ms so the two overlap in the blur.
3. **Blur is the transition medium.** Things appear and disappear through `filter: blur(2–6px)` with opacity and a small scale (`.86–.96`) or a few px of travel. Large travel is reserved for the drawer (`translateY(100% + 40px)`) and the FLIP of cards.
4. **Interruptible from the present.** Every new animation starts from the computed current state (`getComputedStyle`, a morph's live width, the pill's current edges, a live rect) and cancels the old one only after the new one is in place. Turned back half-way (a double click, a quick second pick), nothing starts over from fixed keyframes, and a fade runs only what is left of its way.
5. **The keyboard does not start motion,** but for a sheet's way out. Escape closes a menu instantly and sends a sheet out as its × does (the owner, 2026-11-12: «ESC резко закрывает модалку не как кнопка закрыть»; asked whether the portal should do the same: «Да»).
6. **Reduced motion keeps fades, drops travel.** See *Reduced motion*.

### The engine · `motion.ts`

```ts
spring(k, c, m = 1)   // closed-form damped harmonic oscillator; under-, critically and over-damped branches
                      // duration = time until it stays within 0.15% of the end (sampled every 4 ms, ≤ 3 s)
                      // what is left of the way then is spread over the curve (mostly near its end), so it lands on 1
                      // exactly: a 500 px travel ends without a last-frame step
                      // easing   = CSS linear() with 65 points; at(ms) = progress for script-driven motion
publishSprings(root)  // --spring-{bouncy,smooth,soft,pop,quick,glide} and --spring-*-dur on <html> (the admin's host) for CSS transitions
play(el, frames, o)   // el.animate() with the reduced-motion policy; a large element (> 30 000 px²) fades without its blur
rubber(dist, dim)     // (1 − 1 / (dist·0.55/dim + 1))·dim: resistance that grows with the pull
unrubber(d, dim)      // rubber() undone: the pull that puts an edge d past it (a sheet taken while it settles back)
dismisses(dy, v, h)   // a pulled sheet goes on a flick down (v > 0.4 px/ms) or past h/3; never on a flick back up (v < −0.1)
```

Animations from script go through `play()` (WAAPI). Hover and press states are CSS transitions. Loops and one-shots are CSS keyframes (`orb-converge`, `orb-breathe`, `way-run`, `way-knock`, `way-break`, `way-drop`, `way-dip`, `way-pop`, `caret-blink`, `cal-in`). The field's caret and selection run a per-frame spring of their own, not `spring()` (see *Caret and selection*).

### Springs

Computed from `spring()` and confirmed live: the published CSS variables read 572, 524, 476 and 296 ms.

| Token | k / c | ζ | Settles | Overshoot | 50% at | 90% at | Peak at | Used for |
|---|---|---|---|---|---|---|---|---|
| **BOUNCY** | 300 / 20 | 0.58 | 572 ms | **10.8%** | 78 ms | 133 ms | 222 ms | Toast in, a newly created device card popping in and the way's server icon pop |
| **POP** | 520 / 24 | 0.53 | 544 ms | **14.3%** | 58 ms | 96 ms | 162 ms | Check icon after copy, the OS mark turning in |
| **SOFT** | 380 / 28 | 0.72 | 476 ms | 3.9% | 74 ms | 138 ms | 232 ms | Dropdowns open (⋯ menu, pick pills, page code card), accordion rows and chevron, dialog open (computer) and its scrim |
| **SMOOTH** | 300 / 35 | 1.01 | 524 ms | 0 | 98 ms | 228 ms | — | Widths and heights (morph width, sheet height glide, sheet width, a card's and the notice's height on a repaint, the QR box's size), FLIP of cards and letters, picker pill trailing edge, flex-grow and the picked name's width, folds, tooltip glide, snap-back after a pull and its dim; the switch, the field's focus ring and the go button's colours (via CSS var) |
| **LEAD** | 520 / 46 | 1.01 | 396 ms | 0 | 74 ms | 173 ms | — | Leading edge of the stretching picker pill |
| **QUICK** | 900 / 60 | 1.00 | 296 ms | 0 | 56 ms | 130 ms | — | ⋯ menu highlight following the pointer |

"Settles" is the whole curve, but the motion reads as done at the 90% mark. That is why a 572 ms BOUNCY toast feels like ~200 ms.

### Curves and durations

| Name | Value | Role |
|---|---|---|
| `EASE_OUT` (`--ease-out`) | `cubic-bezier(.23, 1, .32, 1)` | Entrances, hover and press transitions, folds of a finished step |
| `EASE_IN` | `cubic-bezier(.55, 0, 1, .45)` | Exits: menu, toast, dialog close, busy content out, ghosts |
| `DRAWER` | `cubic-bezier(.32, .72, 0, 1)` | The phone drawer, up 500 ms and down 420 ms (Vaul's curve) |
| ad hoc | `cubic-bezier(.2, 0, 0, 1)` | Sheet view swap |
| ad hoc | `cubic-bezier(.25, 1, .5, 1)` | Sheet height on a view swap, 360 ms |
| ad hoc | `cubic-bezier(0, 0, .58, 1)` | Accordion body fade-in, 300 ms |
| `ease-out` / `ease` keywords | — | Drawer scrim (420 in / 320 out), tooltip hide, arrival ring, hover background colours |

The duration ladder in use is **100 · 120 · 140 · 150 · 160 · 180 · 200 · 220 · 240 · 260 · 280 · 300 · 320 · 340 · 360 · 380 · 400 · 420 · 500 · 520 · 700 · 900 · 1200 · 1800 · 2200 ms**, plus springs. Below 200 ms means feedback or exit, 200–400 ms means entrance or cross-fade, ≥ 500 ms means travel or a one-time moment.

### Hover and press (CSS transitions)

A press shrinks a control, but it keeps the footprint it had when pressed: let go anywhere on that and it is the control's click, however far it has shrunk under the pointer (`ui/press.ts`, mouse and trackpad; a touch stays with what it pressed).

| Element | Press | Hover | Timing |
|---|---|---|---|
| `.knob` | `scale(.8)` | bg +6% text | 150 ms ease-out (transform), 150 ms (bg) |
| `.btn` | `scale(.95)` | accent 82% / tint 20% (active 24%) / soft +6% (in a row nested in an inset row: +12%) | 200 ms ease-out (transform, bg, colour) |
| `.go.ready` | `scale(.9)` | — | 200 ms ease-out (transform); colours SMOOTH 524 |
| `.kind` tile | `scale(.94)` | `knob` | 200 ms (bg, transform), ring 220, icon colour 260 |
| `.badge`, `.dev.add` | `scale(.98)` | `knob` / raised+knob 45% | 200 ms |
| `.namechip` | `scale(.96)` | `knob` | 150 ms |
| `.upd-pill`, `.cr-lang`, `.hp-b`, demo chip / GitHub | `scale(.94)` | +6% (`.hp-b`: a `knob` circle) / tone 22% | 150 ms |
| Accordion row | — | raised+knob 40% (inset: field+knob 50%; nested in an inset row: `knob`) | 150 ms |
| `.swrow` (option row) | none | field+knob 50% | 200 ms |
| Switch knob (`.sw`) | held: stretches 20 → 27 px toward where it goes | — | SMOOTH 524 (travel, width, colour) |
| Admin switch that writes (`flipping`) | from the click a ring comes in on the knob as the busy orb does (`in, s.6, b2 → 0`, 340 / 70 EASE_OUT: whole by 410 ms) and rides it (SMOOTH); the change is sent once the knob is over (524); the ring turns (700 ms a turn) until the answer, then stops where it is and goes (`out, s.6, b2`, 180 EASE_IN), carried across the repaint the answer brings | — | as said |
| Picker item | — | `text-3` → `text-2` | 200 ms colour |
| Spark / month bar | — | `--bar` → `text-2` (today: accent+text 25%) | 150 / 120 ms |
| Field | — | focus ring inset 1.5 px | SMOOTH 524 |
| Pick pill chevron | — | turns `90° → −90°` as it opens and on round `−90° → −270°` as it shuts (then 90° again, unseen) | 260 ms ease-out |

### Catalogue: every animation, measured live

Notation:

- `in` and `out` are opacity transitions;
- `b4` means `filter: blur(4px)`;
- `s.9` means `scale(.9)`;
- `y10` means `translateY(10px)`;
- timings are `duration / delay`.

#### 1. Page intro (first paint, once per visit) · `ui/rise.ts`

| What | From → to | Timing |
|---|---|---|
| Each block (crumbs, notice, section heads, each card, the limit note, each access row, the gone card), in the order they stand on screen (top to bottom, then left to right), from the first one on screen | `opacity 0 → its own opacity, y10 → 0, b4 → 0` | 520 / 60 + 40·i, EASE_OUT, fill backwards |
| The sun of the logo | `translateY(7px) → 0`, clipped above the horizon bar: the sun rises | 900 / 150, EASE_OUT |

A disabled card rises to its own 50%, not to 1. On a phone the wave runs from the crumbs through "Your access" and its rows down to "Your devices" and the cards. The first block on screen always rises at 60 ms: a reload that goes back deep into the page starts the wave there, and the blocks above it rise with it. A block still rising is let go on, never begun again (`data-rising`). The admin's pages come in by this same wave (*16*).

#### 2. Repaint choreography (the page after a change)

| What | Motion | Timing |
|---|---|---|
| Cards that stay but moved (FLIP) | `translate(Δx, Δy) → 0` (live: ±315 px sideways, (−315, 154) diagonally), measured before the notice and, on a phone, "Your access" above them change | SMOOTH 524 |
| A card whose height changes (Connect ↔ its week, a row that no longer stretches it) | `height` old → new, what it holds clipped on the way; a bottom of another kind crosses: the old one fades where it stood (`out, b4`, 180 EASE_IN) as the new one blurs in (280 / 60, EASE_OUT) | SMOOTH 524 |
| A device just created (`pop`) | `in, s.9 → 1, b6 → 0` | BOUNCY 572 |
| A card that newly shows (Add card after a removal, the first card) | `in (to own opacity), s.9, b6` | SMOOTH 524 / 60 |
| A card no longer there (Add card once the last slot is taken) | fades where it stood, `out, b4` | 180, EASE_IN |
| A device that just connected (`flash`) | `inset 1.5px var(--ok) →` the card's own ring (this device's accent ring, else none); a repaint while it fades carries it on | 1800, ease-out |
| Changed texts on cards and access rows (`data-t` keys) | letter morph (see 3); a status that takes another colour: the old letters keep the old one, the new turn from it | colour 280, EASE_OUT |
| The count "3 of 4 → 4 of 4" | letter morph | — |
| Limit note appears | `in, y6 → 0, b4 → 0` | 420, EASE_OUT |
| Limit note leaves (a slot freed) | `out, b4` from where it stands while its space folds (`height, margin-top → 0`), then `hidden`; with less motion it fades, then goes with its space | 200, EASE_IN; the fold SMOOTH 524 |
| Limit note that stays | glides with the cards when one came in above it | SMOOTH 524 |
| A removed card leaves (before the repaint) | `out, s.9, b6` | 220, EASE_IN, then the repaint glides the rest |
| The notice | comes: blurs in (280 / 60, EASE_OUT); goes: fades where it stood (`out, b4`, 180 EASE_IN); changes: morphs in place (see 3). Its slot glides to the new height and clips it on the way. | SMOOTH 524 |
| "Your access" rows | stay on the page: keyed values morph (one already turning into the same words goes on), a head swaps only what changed, and an open body refills in place (`morphInto`: a value that crosses fades with its old words, the new one blurs in) while its row glides to its new height (a row still opening or folding heads for it instead). The calendar's days don't come in again; a body whose days are still coming in changes once they are in. | SMOOTH 524 |

#### 3. Text morph · `ui/morph.ts`

Every text that changes in place while visible morphs. Hover readouts over chart bars are the deliberate exception and swap instantly.

**Letter mode** (default):

- **Kept letters slide.** The letters both texts share stay and slide to their new places (SMOOTH 524). They are the common prefix and suffix plus the longest common subsequence in between.
- **Old letters lift away:** `out, y −0.45em, b4`, 220 ms EASE_IN, stagger `min(12, 160/n)` ms.
- **New letters rise in:** `in, y +0.45em → 0, b4 → 0`, 380 ms EASE_OUT, delay `120 + i·min(22, 260/n)` ms.
- **Width glides** from the old text's width to the new one's on SMOOTH, so what follows never steps. The old letters are pinned to the edge that stays put: the start, the end of a right-aligned value, or the middle of a centred line.
- **Kerning correction:** each letter is nudged onto the plain text's kerned position, so the last frame lands exactly on the final text.
- **Done:** at the end the element holds plain text again, and an ellipsis box keeps its ellipsis.

**Whole mode** (`whole: true`, for words in a flowing sentence, app names, menu paths, and the rename hint and refusals standing in for a card's status: `data-whole` on the line, so the repaint after a save blurs the status back too): old words `out, b4` 180 ms EASE_IN, new words `in, b4 → 0` 280 / 60 EASE_OUT.

**Colour** (`morphChanged` after a repaint): a text that takes another colour with its words (a status turning green) keeps the old colour on the words that leave, and the new words turn from it (280 ms EASE_OUT).

**`morphInto(box, kids)`** refills a whole box without a blink:

- unchanged pieces stay still;
- a piece with new words morphs where it stands (whole mode, up to 40 characters);
- a keyed text (`data-t`) with new words is letter-morphed;
- a piece that changed kind, height or drawing crosses: the old one is pinned where it stood and fades `b4` over 180 ms, from how it showed, while the new one blurs in (280 / 60); what came in whole is not morphed again;
- pieces that only moved glide on SMOOTH.

**Interrupting:** a morph under way is not cut short. The next one starts from what shows: the words that were coming in leave from as far as they came (a letter both texts keep slides on from where it is), the words still leaving go on leaving, and the width carries on from its on-screen width. Asked again for what it is already turning into, the morph just goes on. A `morphInto` refilled again half-way does the same: what was fading goes on fading where it is, and what was still coming in goes on from as far as it came. No morph runs for reduced motion or for an element that is not on screen.

Live examples:

| Change | What ran |
|---|---|
| "iPhone 16" → "iPhone 16 Pro" | 4 letters rise at 120, 142, 164 and 186 ms |
| "Connected" → "Not set up yet" | 5 kept letters slide, the rest lift and rise |
| "Waiting for the connection" → "iPad Air connected" | 14 out at 11.4 ms steps, 11 in, width 168 → 156 px |
| Tooltip "Download …" → "Copy … config" | 19 kept letters slide ≈ 12–15 px |

#### 4. Accordion

| What | Motion | Timing |
|---|---|---|
| Every row whose shape changes | `height, margin-top/bottom, four radii` from the measured "before" to the "after" | SOFT 476 |
| Body of the opening row | from where it stands (`opacity 0, b2` when shut) → `1, b0` | 300 × what is left of the way, `cubic-bezier(0,0,.58,1)` |
| Body of the closing row | from where it stands → `opacity 0, b2`, kept displayed (`.closing`) until the row finishes, also when another row is clicked meanwhile | 160 × what is left, EASE_IN |
| Chevron | `rotate(90°) → rotate(−90°)` | SOFT 476 (CSS var) |
| Head value (`valHide`) | `out, b4, translateX(8px)` | 200 (opacity, blur), 260 (transform), EASE_OUT |
| Calendar cells when "Access until" opens | `cal-in`: `opacity 0, scale .4 → 1`; a row opened again before it has shut carries on its cascade | 360 / 7·i ms (49 cells ≈ 700 ms total), EASE_OUT |

On open the neighbours' facing corners round at the same time, so the open row lifts out of the stack rather than splitting it. Inside the sheet the accordion plans the sheet's width first, so a dense code that comes into view gets its width on the same frame. On the page a fold near the foot takes the page down with it (see *Layout → Scroll*).

A click mid-way (a double click) turns every row and body back from where it stands. When content changes under a height glide that is still heading for an old end (a row inside a row, a pick while its row opens, a fold inside a row), that glide is re-aimed from where it stands to the new end on its own curve. The sheet needs none of this: its height follows its view (see *5. Sheet → Content glide*).

#### 5. Sheet

**Open and close:**

| Context | Element | Motion | Timing |
|---|---|---|---|
| Computer (≥ 760) open | sheet | `in, s.9 → 1, b4 → 0` from its centre | SOFT 476 |
| | scrim | `in` | SOFT 476 |
| Computer close | sheet | from its present fade, blur and scale: `out, s.96, b3` into its centre | 120, EASE_IN |
| | scrim | `out` | 120, EASE_IN |
| Phone open | sheet | `translateY(calc(100% + 40px)) → 0` | 500, DRAWER |
| | scrim | `in` | 420, ease-out |
| Phone close | sheet | from its current transform → `translateY(100% + 40px)` | 420, DRAWER |
| | scrim | from its current opacity → 0 | 320, ease-out |
| Escape | sheet and scrim | as the × closes it, above (a menu over it: gone at once, first) | as above |

**View swap:**

| Element | Motion | Timing |
|---|---|---|
| Old view (pinned absolutely where it stands, inert; one already leaving keeps its fade) | from how it shows (one still coming in, from as far as it came) → `out, s.96, b2` | 200 × its opacity, `cubic-bezier(.2,0,0,1)` |
| New view | `in, s.96 → 1, b4 → 0` | 280 / 110, same curve |
| Viewport height | old → new, following the view (live: 297 → 830, 430 → 638) | 360, `cubic-bezier(.25,1,.5,1)` |
| Sheet width | 400 → 448 for a dense key | SMOOTH 524 |
| Pinned keys | old out `s.9, b3` 180; new in `s.9 → 1, b3 → 0` | 260 / 110 |
| Clicks on the new view | ignored for 320 ms, so a tap meant for the old button doesn't press the new one | — |

**Content glide** (a change inside a view):

- the viewport height glides on SMOOTH, as a gap (or overhang) under the view that closes, so whatever changes inside meanwhile (a row opening, a fold) carries the sheet's edge along;
- every element that moved inside glides from its old place (outermost only) on SMOOTH, added to a glide still under way, so a quick second pick takes it on from where it is;
- blocks named as changed blur in (280, EASE_OUT).

**Pull to close** (phone, by the head):

- downward drag follows the finger 1:1, and the scrim fades by `1 − dy/420`;
- taken while it still rises or settles back, it is caught where it stands, the dim with it;
- upward drag resists by `rubber()`;
- release closes on a flick (> 0.4 px/ms) or past a third of the height. Live, a 250 px pull closed from scrim .40, and a fast 50 px flick closed from scrim .88.
- otherwise the sheet and its dim go back on SMOOTH (a touch that never moved only lets it settle).

**Arrived** (`.arrived`) and question (`.asks`): × goes `out, b3, scale .9` over 240 ms EASE_OUT and stop taking clicks; they come back the same way.

#### 6. ⋯ Menu

| What | Motion | Timing |
|---|---|---|
| Open | `in, s.5 → 1, b6 → 0`, origin at the button's side (see *Dropdowns*) | SOFT 476 |
| Close | from where it stands (one still opening included) → `out, s.7, b4` | 110, EASE_IN |
| Highlight appears | opacity at the hovered item | 160, EASE_OUT |
| Highlight moves | place, size and corners to the next item | GLIDE |
| Highlight leaves | opacity 0 when the pointer leaves the menu; back on an item while it still shows, it turns back and glides from where it stands | 160 |

POP (14% over) used to open every dropdown: from `scale .5` it overshot to about 1.07 and read as a wobble; SOFT tops out near 1.02.

#### 7. Toast

| What | Motion | Timing |
|---|---|---|
| In | `in, translateY(18px) scale(.9) → 0, b6 → 0` | BOUNCY 572 |
| Dwell | — | 2400 ms |
| Out | `out, translateY(6px) scale(.96), b4` | 180, EASE_IN |
| Replaced by a new toast | from where it stands (one still rising included) → `out, s.96, b4`, while the new one comes in over it | 140, EASE_IN |

#### 8. Busy orb · `ui/busy.ts`, `controls.css`

The orb is aicss.dev's **Orbs B4 Converge** at its 28 px stage, twice its speed, drawn in the button's own colour.

| What | Motion | Timing |
|---|---|---|
| Click: content out | `out, s.86, b5` | 180, EASE_IN |
| Orb in | `in, s.6 → 1, b5 → 0` | 340 / 70, EASE_OUT |
| Minimum hold | a quick answer waits until the orb is fully in (`BUSY_IN` = 410 ms), so it never flickers | — |
| Answer: orb out / content back | mirror of the above, starting from where each stands | 180 / 340 + 70 |
| Pressed again while the orb leaves | the orb turns back from where it stands, at once | 340, EASE_OUT |
| Orb loop: front dot (7 px) | walks a triangle (top → bottom right → bottom left). It rests 10% at each corner, leaves ease-in (`.55,0,1,.45`), arrives ease-out (`.33,1,.68,1`), and is `scale .72, blur .8` between corners. | 1.8 s, linear keyframe timeline |
| Orb loop: back dot | breathes in the centre: opacity .16 ↔ .32, blur 2.4 ↔ 1.6, scale 1.2 ↔ .98 | 1.8 s, ease-in-out |

The orb starts on the click itself (a 250 ms "only if slow" delay was tried and rejected). `contain: strict` keeps the loop off layout.

#### 9. Copy feedback

The control that copied says so for 1.6 s:

- its icon swaps to a check (POP 544, from `s.6, b3`), and back the same way;
- its "Copy…" label morphs to "Copied" and back;
- a toast says what was copied;
- in the connection keys, the tooltip glides and rewords to "Copied" (SMOOTH).

#### 10. App picker stretch

On a pick:

- **Edges:** the pill's two edges are driven per frame by `spring.at(t)`. The leading edge (toward the new item) runs on LEAD (396 ms) and the trailing edge on SMOOTH (524 ms), so the pill stretches toward the target and then contracts.
- **Width shares:** items change `flex-grow` 0 ↔ 1 on SMOOTH. Shares of the track, not pixels, so they stay right while the sheet's width changes.
- **Labels:** the old label collapses (`max-width → 0, margin-left −8, out`, 220 ease-out) while the new one opens to its width with its item's share (SMOOTH) and blurs in (280 / 70, EASE_OUT), always inside the pill. Picked again half-way, each name goes on from where it stands, one still folding included, over what is left of its way.
- **What follows:** everything the pick changes morphs in place (`morphInto`) and the sheet glides.

#### 11. Kinds picker

The ring does not travel: the old tile's ring fades and the new tile's ring draws in place (box-shadow 220 ms). The icon desaturates or saturates (260 ms) and the label colour changes (200 ms). A name that follows the pick changes without motion.

#### 12. Codes and words

| What | Motion | Timing |
|---|---|---|
| A new QR in the same box | new `in` under them all first (200, EASE_OUT); old laid over it goes `out` (220 / 110, EASE_IN); each from where it stands. Nothing changes its place in the stack: a code turned back to fades up again where it lies (200 × what is left), what lies over it goes, and what lies under it goes once it shows whole | the box is never empty |
| A code of the other size (dense ↔ not, e.g. the stand-in) | the box scales from its size on screen to its own (from its top left, corners kept), the codes with it; the words glide to their new place | SMOOTH 524 |
| The same code under other words | only the words change | — |
| Words beside a code | new `in, b3 → 0` 220 EASE_OUT; old `out, b3` from where they stand, 200 / 90 EASE_IN | — |
| Scan line, another app | app name and each path part morph whole; the OS mark grows or shrinks (`width 0 ↔ 1.05em`, `b3`) | SMOOTH; mark out 220 × the width it has left, from where it stands |
| Scan line, OS alternation (every 3000 ms while on screen) | the differing word letter-morphs; the old mark `out, scale .5 rotate −40°, b3` (200, EASE_IN); the new one turns in from `scale .5 rotate 40°` | POP 544 / 80 |

#### 13. Waiting for the first connection · `flows/wait.ts`

**Waiting:** the way's light (`way-run`) is a gradient band masked to the dots. It travels from −70% to +70% in the first 72% of a 2 s loop (`cubic-bezier(.45,0,.55,1)`) and rests for the last 28% (≈ 560 ms).

**Can't finish:** the light turns warn and knocks (`way-knock`, 1.8 s, the same curve): −70% → +34% at 48%, back to +26% at 62% as if turned away, then home to −70%, fading out by 86% and resting to the end. The break at the router flashes on the same beat (`way-break`, 1.8 s): `opacity .25, scaleY .7`, up to `1, 1.15` at 50%, back by 70%. The router's end turns warn over 400 ms. Both loops (the run and the knock) and the break run from the way's first frame; each state fades its own in and the others out over 200 ms (ease-out) where they stand, so none starts over in sight.

**No data:** the green fills the dots as on arrival (700 / 80, EASE_OUT) and the ends turn green (400; the router's 600 later, with no pop). Two packets take turns (`way-drop`, 2.2 s, the same curve, the second 1.1 s behind): each fades in by 8%, runs to 48% of the track at 46%, then drops 16 px past the middle (to 54%), shrinking to `.5` and fading out by 66%. Leaving no data, each packet fades out where it is as it falls on (200, EASE_IN), then goes; back to no data while they fade, a fresh pair sets off.

**Arrival timeline**, measured live (t = 0 at arrival):

| t (ms) | What |
|---|---|
| 0 | The line morphs to "<device> connected" (width glides on SMOOTH, letters lift and rise). Its colour turns green (300 ms). |
| 0 | × steps away (`out, b3, s.9`, 240 ms). The sheet scrolls to the top. |
| 0 → 380 | The sub line folds away, if it still shows (see below). |
| 0 → 200 | The light fades out (200 ms). |
| 80 → 780 | The green fills the dots from the device's end (`clip-path inset(0 100% 0 0) → inset(0)`, 700 / 80 ms, EASE_OUT). The device's end turns green (400 ms). |
| 480 → 1172 | The server's end turns green (400 / 600). Its icon dips to .6 (`way-dip`, 120 / 480, the way's curve) and springs back (`way-pop`, BOUNCY 572 / 600): it starts and ends at its own size. |
| 410 → 930 | Everything under the way folds shut: height → 0, `out, b4` (520 ms, EASE_OUT), and the way's bottom margin goes 18 → 0. |
| 410 → 2810 | **2.4 s of reading time.** Unchanged with reduced motion: it is not motion. |
| 2810 | The sheet closes (120 ms on a computer, 420 on a phone). |
| ≈ 2950 | The page repaints: the card glides to its new place (SMOOTH), its status morphs to "Connected", and its **green ring fades** over 1.8 s. |

**Changes of state**, each starting from where things stand on screen, so one turned round half-way never jumps:

| What | Motion | Timing |
|---|---|---|
| The line | letter morph to the new state's words (see 3); its colour 300 ms | — |
| Second line in | `in, b4 → 0`, while the block's height glides open and both lines FLIP to their new centre together | 300 / 60 EASE_OUT; height and FLIP 340 EASE_OUT (the FLIP measured on the glide's first frame) |
| Second line replaced | whole-word morph in place (old `out, b4` 180 EASE_IN, new `in, b4 → 0` 280 / 60 EASE_OUT) as the block glides to the new height | 340 EASE_OUT |
| Second line out | `out, b4` from its current opacity, then the block closes the same way | 180 EASE_OUT, the close from 170 ms, 340 EASE_OUT |
| Sub line folds and comes back | `height, margin-top/bottom → 0, out, b4` | 380, EASE_OUT |
| Steps regroup (into one inset row, and back) | `.setup` height from where it stands to the new one; `opacity .4, b2 → none` | 420, EASE_OUT; 320, EASE_OUT |
| Leaving connected | × and the keys come back (240); what folded unfolds straight into the new shape, the way's 18 px gap with it | 520, EASE_OUT |
| Given up | the line morphs; the second line comes in, or morphs from the one shown; the sub line folds away if it still shows | as above |

#### 14. Caret and selection · `ui/caret.ts`

| What | Motion | Timing |
|---|---|---|
| Caret, typing and the arrows | glides to its place on a per-frame spring of its own: per 16.67 ms frame `v += (target − x)·0.12`, `v ·= 0.62`, `x += v` (90% in ≈ 134 ms, ≈ 2% over, no stretch). At most 2.5 frames per step; after a gap of over 15 frames it is simply there. | one rAF loop |
| Caret, a click | where clicked at once, as macOS does | 0 |
| Caret blink | solid while it moves or they type; 0.5 s after the last key, 0.6 s on / 0.6 s off with soft fades (`caret-blink`); its on/off fade | 1200 ease-in-out loop; 100 linear |
| Selection | grows out of the caret: both edges start where the caret is and ride the caret's spring; the wash and handles fade in. A wash still fading from the last selection turns back instead and glides from its old ends to the new ones. | 140 linear |
| Selection collapses | the wash fades where it stands (no slide), then its ends rejoin the caret | 140 linear, the ends at 160 ms |
| The page's selection (`ui/selection.ts`) | as a field's: each line's ends ride the caret's spring; a new selection grows out of where it started, a line it reaches grows from the side it is reached from; on collapse it fades where it stands. Checked every frame while it shows: when the text moves or goes with no event (a scroll, a fold, a sheet's view or the sheet shut) it goes along at once, or fades where none of it shows | 140 linear, gone at 160 ms |

#### 15. Other moments

| What | Motion | Timing |
|---|---|---|
| Error under a field in a sheet | in: `in, y−4 → 0, b4 → 0` as the sheet glides open (see 5, *Content glide*); out: `out, y−4, b4` where it stands, then the sheet glides shut; a second error morphs its words; each turns back from where it stands | 220, EASE_OUT; out 180, EASE_IN, the glide from 170 ms |
| Show key / Hide key | the mask and the key cross-fade in place, each from where it stands: in → `none, 1` (320, EASE_OUT); out → `0, b4` (200, EASE_IN), then out of sight. The icon (key ↔ ×) turns the same way, out through `s.6, b3`; the label morphs | 320 / 200 |
| Steps fold (an inset row above them opening) | `height, opacity, blur(0 ↔ 4px)` from where it stands (a double click turns it back); a row still opening around it heads for the new height | SMOOTH 524 |
| Top edge fade | opacity 0 ↔ 1 at `scrollY > 2` | 200 ms |
| Demo scenario switch | page `out, b4` 160 EASE_OUT → repaint → `in, y6, b4 → 0` 420 EASE_OUT | demo only |

#### 16. Admin: the pages stand still (`portal/motion.ts` `standStill`, set in `admin/main.ts`)

The admin's pages are drawn again from data on every change, and they are too many and too dense to move piece by piece on each answer from the router without something tearing (chips crossing, a tooltip left behind, a number shrinking for the length of its morph). So the admin does not animate a repaint's blocks at all: **a change is drawn in place at once**, and only a page or a view coming in, what the person opens or presses, and **the words of a value that changed** move. `standStill()` turns the repaint vocabulary off in one place (`morphInto`, `appear`, `fadeAway`, `fold`; `reshape`, `refill`, `unfold`; the pages' own FLIPs ask `still()`); `morphText` is not part of it (it asks only for reduced motion): a value changing where it stands is one small thing, not a block rebuilt. The portal never calls `standStill()` and moves as this file says.

| What | Motion |
|---|---|
| A block drawn again (a person's or a device's blocks, Overview, a Settings section, the Log, a head's facts, the filter chips, the people's cards, a list that is reordered) | none: the new content stands in its place |
| A number or a line that changes (a live speed, a count of bytes, «Running for 16d 4h», a tile's line, a head's state, the MTU's number under its slider) | its words morph as *Text morph* says (the owner, 2026-11-12: «имплементируй лайв обновление и добавь анимацию морфа текста, также морф текста нужен на элементах где изменяются данные по типу MTU числа при изменении слайдера»): the letters both texts keep stay, the others lift away and rise in, so «30.4 GB» after «28.1 GB» moves three digits and nothing else. A repaint puts the new block in and then morphs the values in it that say something else (`ui/reshape.ts valuesOf`/`morphValues`, called by `refill`, by `state/regions.ts rows` and by the people's cards): a value is `.num`, a keyed text (`data-t`), a tile's line (`.stat-sub`), a head's state (`.ph-state`) or what a build marks `data-live`; a keyed one is paired by its key, the others by their order when the block still has as many. A live speed's words change every third second (they are the mean of those three) and a server's «Now» on its Overview card with them, read from the same meter. The MTU's number is an input, which cannot change by the letter: at rest the same number stands over it as words and those morph while the slider moves; typed in, the field shows its own text (`widgets/link-values.ts`). A readout under the pointer (a chart's day, a week's bar) never morphs |
| A fold somebody opens («N interfaces are not offered», a choice row's options, an event's details in the Log, the notices' fold on a phone) | as *4. Accordion* (`ui/reshape.ts unfold`; the owner, 2026-11-12: «для аккордионов и выпадающих компонентов такую же анимацию как на портале»): height from where it stands on SOFT 476, clipped (shutting on SMOOTH 524: a height cannot go under nothing, and a spring with give stops dead at the floor); its own margins and paddings fold with it and the gap its parent keeps over it is taken back, so the block loses no pixels at a stroke when the body is hidden (the owner: «в конце анимирования снап происходит», 10 px of a column's gap; measured after: the last steps are 0.1 px); the body `in, b2 → 0` over what is left of 300 ms (`cubic-bezier(0,0,.58,1)`), `out, b2` over what is left of 160 (EASE_IN); its chevron turns on SOFT. A part that comes or goes by itself («Now» in Traffic, a notice, the term's block): none, there or not |
| A view that swaps (cards ↔ map, a person's page ↔ the list, a server's part, a Settings section) | comes in as a page does (below); the view that goes is gone at once. The list comes back where it was, the item opened from ringed (the ring fades over 1800 ms: a mark, not a move); Escape brings it back at once. Inside a view: the map's places ↔ a city, a period on a timeline: none |
| The rail's highlight | glides from link to link on GLIDE (the stylesheet); the first time it stands on a link (the rail just came on screen) it fades in there (320 / 100 EASE_OUT), with its link's rise: what is laid over the flow (a highlight, a pill, a mark in a corner) is no block of the entrance's wave (`ui/entrance.ts`), or it rose to its own nothing and stood there at a stroke; the section row's pill as a track's |
| A move from one page of Dawnline's to another (the section row, the way back, a link to a server or to Settings, Back and Forward between them) | the row stays the node it is and never blinks (`shell/pages.ts`; the owner, 2026-11-12: «мне не нравится то, что это мигает при переходах»): the page under it is changed in place, without the theme's navigation, the address pushed; the row's pill stretches to the section as a track's does (`shell/nav.ts`); the row's track is a card's surface (`raised`, as the panels under it: the owner, «сделай у нава фон как на втором скрине») and its pill `raised` with 7 % of `text` (`--page-pill`), a step off it in either theme; a server's track of parts under it is drawn the same («и это»), so a page's own tracks and its panels are one surface, while a track inside a card keeps `on-ground`, and the new page comes in as every page (above). A reload, a bookmark and a link from outside open the section's own view |
| A device's dialog | opens whole (`pages/server/device-dialog.ts`; the owner, 2026-11-12: «может чтобы не анимировать все по отдельности подождать пока все внутри модалки прогрузится?»): its panel reads its log, its configuration and its places first and the dialog opens with all of it in place, so nothing lands in it after; it opens by 700 ms whatever is still on its way, and what is late then goes to its place as the row below says |
| What lands in a block a moment after it stood (a device's panel that had to open before its data, in its first seconds: the latest events, the set-up's lines, the Places' rows) or changes whole on a pick (the Places' period) | the block goes to its new height from the one it has (`ui/reshape.ts grown`: `height` on SMOOTH, what it holds clipped on the way), so what stands under it travels with its edge and a dialog follows by itself; rows that are new blur in (280 / 60), a block that stood there already does not fade, and nothing is slid apart from its block (the owner, 2026-11-12, of a first try that brought whole blocks into focus and slid the next one over: «появляются со странным фейдом и накладываются друг на друга»). Heights are the layout's (`offsetHeight`), never read off the screen: a dialog still opening is drawn at nine tenths. The form of a set-up (QR, .conf, text) changes through the sheet's own glide (*5. Sheet › Content glide*); a view is whole the moment it is put in a sheet, which measures it then |
| A page opened (every opening asks the router: until it answers the section row stands alone, then the page is drawn whole) | its blocks rise as the portal's page does (*1. Page intro*): `opacity 0 → own, y10, b4`, 520 / 60 + 40·i, EASE_OUT, at most 14 steps, only what stands within 1.25 windows of the top. A repaint after that stands still as every other |
| A sheet or a dialog (open, close, a step and Back, its height and width between views) | as *5. Sheet*, unchanged |
| A ⋯ menu, a list of choices, a field's list (`ui/list-drop.ts`, `ui/combo.ts`), a tooltip, a toast, the dock at the window's foot | as their own sections, unchanged: a dropdown opens `in, s.5 → 1, b6 → 0` on SOFT from its button's side and shuts in 110 ms (*6*) |
| A switch, a checkbox, a segmented track's pill, hover and press on any control, a meter's bar | their own CSS transitions, unchanged |
| A control a pick draws again (the part it stands in is rebuilt from data: a server's track, a track of presets, the MTU's knob, a chip that toggles) | goes on from where the one it replaces stood (`ui/carry.ts`; the owner, 2026-11-12: «нужно добавить анимации на компоненты»): a track's pill stretches to the picked tab as *10* (leading edge LEAD, trailing SMOOTH) from where the last pill is, mid-way included; the MTU's knob moves as a slider of iOS does (`ui/range.ts`; the owner: «сделай в стиле ios анимации движения», after a knob that floated to a press on a transition): its place is a spring worked out every frame, taken on from where it stands with the speed it has; under the pointer a stiff one with no give (1400 / 75: on the finger within a frame or two, the steps between values smoothed), a value set from outside («Auto», a number typed) on SMOOTH's (300 / 35); it never goes past where it is headed (the owner: «убери у слайдера овершут»): neither spring has give, and a knob let go while it still moves stops on its value instead of crossing it (measured: 0 px past the end, 0 px backwards); the keyboard puts it there at once; its look turns in 200 ms; a chip's check opens its width on SMOOTH and comes in as the copy check does (POP from `s.6, b3`), its fill and words turning in 200 ms. A control names itself (`keep`), one name a control on screen; a part drawn again in the background has the same state, so nothing moves. A switch, a tile, a chip without a name of its own is carried with its region (`carryControls`, where a standing page draws a region again: Settings' parts, `ui/reshape.ts`): paired with the old one by its kind and title, it starts as that one stood and turns to its own state. A switch moves its knob at the press, before it asks (`flippedNow`), and a staged change draws its part again in the same task: the new switch starts from the other state and is put as far into the move as the old one was, so the knob goes on, not again and not from its end (the owner, 2026-11-12: «у чекбоксов/свитчей нет больше анимаций как на портале»; measured in both engines: the knob at 14.1 px in the old node and 14.1 in the new one a frame later). The turn is made in the task that puts the control in the page, so no frame shows where it started from |
| The map (camera, markers, the replay) and the live line under a speed | unchanged. A map comes in, it does not strike (`map.ts mount`; the owner, 2026-11-12: «сделай чтобы карты появлялись плавно»): its canvas and markers stay unseen until the first whole frame is drawn, then fade in together (420 ms EASE_OUT; 160 with less motion), in every place a map stands (People › Map, a device's «Map and replay», the close-up); its box is there from the first frame |
| A step's check on a job's stage, the selection's pause/play icon | as the copy check: POP from `s.6, b3` (a restore's four steps fill one after another, 60 ms apart) |
| A job's stage (a step that comes, the line under the title, the job's end) | nothing is slid to a new place: its three parts (the top, the steps or what stands in their place, the foot with the actions) each go to their new height where they stand (`portal/ui/grown.ts`: `height` on SMOOTH, clipped on the way), so the log's row and the actions travel with the edge of what is over them; what changed (the picture in its new tone, the title, the line, what a check found, the actions) comes into focus as the sheet's own glide brings a changed block in (`in, b4 → 0`, 280 EASE_OUT). The sheet's FLIP was tried first and is not used here: the log's row, still on its way up from under the steps, crossed the button that had just come (the owner, 2026-11-12: «журнал операций плавает под кнопкой») |
| Escape | shuts a sheet or a dialog as its × does (*5. Sheet*, the same on the portal; `shell/layer.ts`); a menu, a field's edit and a person's page going back to the list answer it at once |
| Typing in a search | at once, as everywhere |

What the stylesheet glides on its own when a class or a size changes (a switch's knob, a bar's width) still runs; nothing is choreographed around it.

**How a page of the admin comes in** (`admin/ui/entrance.ts enter`; the owner, 2026-11-12: «убрать скелетон загрузку с админки и сделать анимацию появления и перехода по страницам как на портале»). There is no skeleton and no sample: the page waits under its section row (known without the router, it stands from the first frame and never rises). An answer that takes longer than 600 ms is said there, never left as a black page (`shell/waiting.ts`; the owner, 2026-11-12: «нужно сделать чтобы было видно что бекенд поднимается а не была черная страница»): the portal's one card under the row (*Single card mode*: `.gone`'s 400 px, radius 36, padding `32 24 28`, 12vh down; the owner: «сделай его в стиле дизайн мд»): Dawnline's mark at 48 px in `text` (`shared/mark.ts`, the portal's crumbs' own; its sun rises from behind the line as the card comes in, 900 / 150 EASE_OUT), a 22 px title, a 14/20 `text-2` line of what the start is doing, and its three steps as a track of three parts (6 high, 6 apart, 168 wide, `knob`, filling in the accent; orange while the router does not answer). No «Step N of 3» (the owner: «убрать step n of n»): the parts say it. The steps are what the page really sees (`state/stream.ts startPhase`): «Waiting for the backend» (its `hello` not answered), «Reading the router» (it answered, the router's state is not in hand), «Opening the page» (it is, the page asks the rest). The track is one progress drawn over the three parts, per frame: within a step it goes toward 86% of the step's part, a third of what is left every 3 s (never there); a step done moves it on; what is drawn follows it with a 420 ms lag (140 ms at the end), so a step done glides and nothing snaps (the owner of the first try: «полоски прогресса резко снапают»; measured, at most 1.1% of the track a frame). It goes on with less motion asked for: it tells, it does not travel. The line rolls when it changes (the owner: «не морф а скролл блюр фейд»): the old words go up into a blur (`out, y −0.6em, b4`, 180 EASE_IN, from where they stand), the new come up out of one (`in, y +0.6em → 0, b4 → 0`, 280 / 60 EASE_OUT), both in one cell while they cross; a reason from the router rolls in the same way. The title does not move (the owner: «заголовок не анимировать»): it changes in place. The card comes in as a page's block rises (*1*); when the answer comes the track runs full, the card fades where it stood (`out, b4`, 180 EASE_IN) and the page comes in. Its title is «Dawnline is starting» while the backend does not answer its `hello` (an update or a deploy restarted it), «Waiting for the router» otherwise, «Dawnline is starting» over «Trying again in a moment» once a question failed (asked again every 3 s until the page comes in; a refusal of the bus is never shown as words, the owner: «в лоадере в тексте появилась RPC ошибка»), and «The router is not answering yet» in orange after three in a row. The page is then drawn whole from the router's answer (its regions painted at once, the 30 days' chart drawn in the frame it is put in, the live line from the meter's two minutes asked with the status), and then comes in. Its blocks are found, not listed: from the page down, a block is what reads as one thing (a painted surface: a card, a tile, a field; anything 64 px high or lower: a head, a caption, a row of chips; a heading; a leaf), and a box that only lays others out is gone through, eight levels deep at most. They rise in the order they stand, top to bottom and then left to right. A view swapped in on the page rises the same way, measured once it is drawn and scrolled to; a view inside a block that is still rising comes in with it. Health and a server's interfaces, which come a moment after the page, fill in place.

### Shimmer · `ui/shimmer.ts`

Words being saved (a name on its card) shimmer as an assistant's "thinking" line does. A copy of the words is laid exactly over them (same font, clipped to the input and scrolled as it is) and the input's own go transparent. The copy is the words' colour (`text`) over a muted base (`text` 38% into `raised`), painted as a gradient clipped to the text: a band 2.2 em either side with a bell falloff (0, .5, .9, 1, .9, .5, 0) crosses it from left to right in 1.8 s, linear, then rests 0.58 s and goes again. It starts solid (the swap shows nothing), dims in 240 ms; stopping, the band holds where it is and the words fade back to their colour around it (480 ms, standard curve), and only then does the copy go. With less motion asked for there is no band: it only dims and comes back.

### Choreographies, end to end (live, demo latency ~0.5–0.75 s)

**Rename (on the card):**

- 0: Return; the words' copy laid over them dims to the muted base (240, standard curve), the caret steps aside;
- +120: the first sweep sets off (1.8 s across, linear), then again after a 0.58 s rest, until the answer;
- answer: the band holds where it is and the words fade back to their colour (480, standard curve);
- then: the input gives way to the name (identical, nothing moves), the card is drawn again and its status blurs back from the hint (whole words), words and colour.

**Reconnect:**

- 0: busy;
- +720: answer. Under the sheet the cards FLIP (iPhone and MacBook swap places, ±315 px) and the status morphs to "Not set up yet";
- +795: view swap to set-up. Old out 200, new in 280 / 110, height 297 → 830 (360), width 400 → 448 (SMOOTH), × back (240), the light starts.

**Add:**

- 0: go button busy;
- +460: the new card pops (BOUNCY) under the sheet, the count morphs "3 of 4 → 4 of 4", the limit note rises (420);
- +509: view swap to set-up.

**Remove:**

- 0: busy;
- +750: answer, sheet out 120;
- +877: the card leaves (220, EASE_IN, `s.9, b6`);
- +1103: repaint. The neighbour glides (−315, 154), the Add card blurs in (SMOOTH / 60), the limit note fades (200), "Device removed" toast.

### Reduced motion (`prefers-reduced-motion: reduce`)

`play()` keeps only the opacity of an animation that fades, at ≤ 160 ms ease-out. An animation that only moves or resizes jumps to its end (0 ms).

| Piece | Behaviour |
|---|---|
| Text morph, `morphInto` | Plain text swap, no letters |
| Picker pill | Jumps (uses SMOOTH and t = end) |
| Busy | No 410 ms hold; orb shown as a still frame (front dot sharp, halo behind) |
| Accordion chevron, calendar cascade, way light (its knock too), way fill, server pop, falling packets | Off (CSS `@media` blocks); the break at the router stands still |
| Caret and selection edges | Jump to their places; the caret stands still (no blink) |
| Second line, steps regroup | Fade only; the heights jump |
| Sub line fold, what folds on arrival, the limit note leaving | Fade out, then gone with their space (back at once, fading in): the way still moves up under the head |
| OS mark alternation | Marks swap instantly (the word still changes) |
| Sheets, menus, toasts | Fade only |
| Arrival reading time (2.4 s) | Unchanged |
| Admin: a deep refill, the tooltip's glide, the Traffic tiles' glide, folds | Put in at once (a refill), jumps (glides), fades only (what blurs in, what fades out, a fold's opacity, the docks) |
| Admin: the switch's waiting ring | Fades in and out (160), stands still |
| Admin: a page or a view coming in | Each block fades in (160), no travel, no blur, no wave |

CSS hover and press transitions (`scale(.8–.98)`, colours, the switch) are not reduced. They are small, direct responses to input.

### Performance notes

- Animated properties are `transform`, `opacity` and `filter: blur` almost everywhere. Layout properties animate only where the layout must truly change: `height`, `width`, `max-width`, margins and radii (sheet height, accordion rows, morph width, folds), `flex-grow` (picker) and `clip-path` (way fill).
- Morphs skip elements that are not on screen. A layer of many small pieces (a strip's stays) is marked `data-flat`: a deep refill reads, keeps or crosses it as one piece and never goes into it. The OS alternation skips while folded.
- The caret runs one `requestAnimationFrame` loop for itself and both selection edges, writes only `transform` (and the wash's width), and stops once all three rest. Its measuring copy of the text sits out of sight with the input's font, and several events in one frame make one measure.
- Blur radii stay at ≤ 6 px; the edge fade's 12 px backdrop blur is the only large one.
- One animation per property per element at a time: new runs cancel old ones after starting from their computed state. The exception is a FLIP inside the sheet, which adds to one still under way (`composite: 'add'`).

### Motion do's and don'ts

- **Do** use a spring token for anything that moves or resizes. Use EASE_IN for exits and EASE_OUT for blur-ins.
- **Do** make the entering part wait 60–110 ms in a cross-fade, and keep exits under 220 ms.
- **Do** start from the current computed state and cancel after.
- **Do** keep loops tied to a real wait: a request, a connection, an alternation the person reads.
- **Do** let a page with nothing to show yet wait, and come in whole once it has (*1. Page intro*, *16*); **don't** stand a sample or a placeholder in for the router's answer.
- **Don't** animate a language change or a reload, or what Escape does to a menu or a field; a sheet it closes goes as its × sends it.
- **Don't** morph a hover readout: it follows the pointer and must be instant.
- **Don't** use `transition: all`, bounces on exits, or travel over ~20 px except the drawer and the FLIP.
- **Do** let an admin repaint change in place (`admin/ui/reshape.ts`, *16. Admin*): deep refill, never a whole block crossing because its height changed. Nothing appears or vanishes at once: home's details under «Home network», a diagnosis, a notice, the Traffic card's «Now».
- **Do** let a switch that writes to the router finish its move first (`flipping`): the knob goes over with its ring coming in, the change is sent, the ring turns until the answer and goes from where it stands; refused, the knob goes back.
- **Don't** re-run an entrance animation on a repaint the person didn't cause: the calendar's days come in when its row is opened, not when a repaint keeps it open.

---

## Content & Voice

- **Short, plain and whole.** "Your devices can't connect until it's resumed." A sentence that adds to a title never repeats it. Full rules for strings and Russian: `rules/i18n.md`.
- **Buttons are verbs, with no ellipsis:** Connect, Update, Add device, Reconnect, Remove, Cancel, Open securely, Show key, Copy.
- **Statuses are short and fit one line.** The full wording goes in the tooltip: "Settings changed, update needed".
- **Other apps are quoted word for word, in each language:** "+ › Insert › Continue" for AmneziaVPN, "Import Tunnel(s) from File…" for WireGuard, "+ › Import config from Clipboard" for V2RayTun on Android, "+ › Import from clipboard" on Windows.
- **Honest warnings sit where the choice is made**, said once: one line where space is short, the why in `title`.
- **Numbers, sizes and dates** follow the page's language.
- **The language pill switches in place.**

---

## Accessibility

- **Focus:** `:focus-visible` draws a 2 px outline in accent at 65% with a 2 px offset, only while the keyboard is moving focus: `main.ts` sets `.kbd` on `<html>` at Tab or an arrow key and drops it at any press. Focus a script moves, or one left after a click or a touch, shows nothing.
- **Keyboard:** Escape closes the menu (at once), then the sheet (as its × does).
- **Words only on hover:** a device card's status stays one line, so a longer reason sits in `title` for a pointer and in hidden text right after the status for a screen reader (`.offscreen`). A touch screen shows neither: the trade-off for cards of one height.
- **Hidden decoration:** icons and glass icons are `aria-hidden`. Morph overlays and ghosts are `aria-hidden` and click-through. A field's drawn caret, selection and handles are click-through, and its measuring copy is `aria-hidden`; the input underneath stays the browser's own (typing, IME, its real selection).
- **Contrast:** see the table in *Colors*. `--text-3` and white-on-accent are below AA.
- **Targets:** buttons and fields are 48 px, menu items 40 px. Knobs, pills and the connection keys are 32 px, calendar cells 10 px (not interactive). The 32 px controls are below the 44 px touch guideline.
- **Reduced motion:** see *Motion → Reduced motion*.
