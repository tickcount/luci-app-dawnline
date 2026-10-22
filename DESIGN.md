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
    fontFamily: Geist
    fontSize: 15px
    fontWeight: 400
    lineHeight: 22px
    letterSpacing: -0.011em
  display-number:
    fontFamily: Geist
    fontSize: 36px
    fontWeight: 600
    lineHeight: 40px
    letterSpacing: -0.045em
  card-title-alone:
    fontFamily: Geist
    fontSize: 22px
    fontWeight: 500
    lineHeight: 28px
    letterSpacing: -0.03em
  section-title:
    fontFamily: Geist
    fontSize: 20px
    fontWeight: 500
    lineHeight: 28px
    letterSpacing: -0.025em
  sheet-title:
    fontFamily: Geist
    fontSize: 20px
    fontWeight: 500
    lineHeight: 28px
    letterSpacing: -0.5px
  empty-title:
    fontFamily: Geist
    fontSize: 18px
    fontWeight: 500
    lineHeight: 24px
    letterSpacing: -0.02em
  value:
    fontFamily: Geist
    fontSize: 17px
    fontWeight: 500
    lineHeight: 24px
    letterSpacing: -0.02em
    fontFeature: '"tnum"'
  card-title:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: 500
    lineHeight: 22px
    letterSpacing: -0.02em
  button:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: 500
    lineHeight: 22px
    letterSpacing: -0.015em
  button-strong:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: 600
    lineHeight: 22px
    letterSpacing: -0.015em
  input:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: 500
    lineHeight: 24px
    letterSpacing: -0.012em
  step-title:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: 500
    lineHeight: 24px
    letterSpacing: -0.02em
  row-title:
    fontFamily: Geist
    fontSize: 15px
    fontWeight: 500
    lineHeight: 22px
    letterSpacing: -0.02em
  breadcrumb:
    fontFamily: Geist
    fontSize: 15px
    fontWeight: 400
    lineHeight: 22px
    letterSpacing: -0.15px
  question-text:
    fontFamily: Geist
    fontSize: 15px
    fontWeight: 400
    lineHeight: 21px
  desc:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
  menu-item:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: 500
    lineHeight: 20px
  toast:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: 500
    lineHeight: 20px
  meta:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: 400
    lineHeight: 18px
  pill-label:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: 600
    lineHeight: 18px
  label-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: 500
    lineHeight: 16px
  tooltip:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: 500
    lineHeight: 12px
    letterSpacing: -0.1px
  divider-label:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: 500
    lineHeight: 22px
    letterSpacing: 0.06em
  axis:
    fontFamily: Geist
    fontSize: 11px
    fontWeight: 500
    lineHeight: 16px
  axis-xs:
    fontFamily: Geist
    fontSize: 10px
    fontWeight: 500
    lineHeight: 14px
  calendar-head:
    fontFamily: Geist
    fontSize: 9px
    fontWeight: 600
    lineHeight: 10px
  mono-link:
    fontFamily: Geist Mono
    fontSize: 13px
    fontWeight: 400
    lineHeight: 22px
    letterSpacing: 0px
  mono-code:
    fontFamily: Geist Mono
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

This file describes how the **personal portal** (`web/src/portal`, plus the parts of `web/src/shared` it uses) looks and moves: its tokens, its components and, in its own part, its motion. The admin pages inside LuCI follow `rules/ui-design.md` and the LuCI theme and are not covered here.

The front matter follows the [DESIGN.md](https://github.com/google-labs-code/design.md) draft format (alpha). The prose sections come in that format's order. **Motion Design**, **Content & Voice** and **Accessibility** are extra sections after them.

The styles live in `web/src/portal/styles` (tokens in `tokens.css`), the motion engine in `web/src/portal/motion.ts`.

**Measured live (2026-10-20, Dawnline 0.11.0)** at desktop width (1138 px) and phone width (375 px), in dark and in light, in English and in Russian. Every duration, delay and easing in this file was seen running, not only read. Spring durations and overshoot come from the same function the portal uses (see *Motion → Springs*). Where code and the live page disagree, the live page wins.

---

## Overview

The portal is one person's page on a router.

**Lineage.** The look was approved as a mockup (Oct 2026). It borrows from four places:

- **skiper-ui:** skiper21's palette, accent, highlight and tab pill, and skiper103's bouncy accordion;
- **iconiqui:** the breadcrumb and the edge fades (dia-text);
- **aicss.dev:** the busy orb, "Orbs B4 Converge";
- **Vercel's Geist:** the type.

**Personality.** Calm, dark and tactile. The page is near-black (`#080808`). There are no borders: each layer is a step brighter than the one under it. One sky blue is the only accent. Every other colour means a state. The UI is made of big round shapes (36 px sheets, 28 px cards, pills), and glass icons are the only illustration.

### Principles

1. **Structure over text.** Tiles, rings, bars, calendars and pills say it before a sentence does. Summaries come first ("38.6 GB / 100 GB"), details sit one tap deeper (the accordion).
2. **Depth from brightness, not lines.** Each layer goes bg → raised → field → knob, every step a little lighter. A ring is drawn inset, and only to mean something: focus, the picked tile, this device, a notice's tone.
3. **Colour is meaning.** Accent blue means action or "you are here". Green means fine or connected, orange means attention or paused, red means stopped, out or destructive. Grey is everything else.
4. **One place per fact.** The count sits beside "Your devices", the usage sits on its card, and the access sits in its rows. Nothing is repeated.
5. **Nothing blinks.** A change happens where it is: text morphs letter by letter, cards glide to their new places, a sheet glides to its new height. A repaint never flashes.
6. **Physical, interruptible motion.** Springs are given as stiffness and damping, and each animation starts from where the element stands right now.
7. **The keyboard never animates.** Escape closes a sheet or a menu instantly. Reduced motion keeps fades and drops all travel.
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
| `--text` | `#ededed` | `#0b0b0b` | Titles, values, current crumb, bold steps |
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
| `--warn` | `#ff8d28` | *same* | Not set up yet, settings changed, outside hours, Reconnect, ends soon, a link that fails (the card's line; the way's can't finish and no data) |
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
| `t-orange` | `#ffc08f` → `#ff8d28` | *same as dark* | Warn notices, Reconnect question |
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

**Families:** **Geist** (variable, 100–900) and **Geist Mono**. They are self-hosted as woff2 next to `portal.css` (CSP `font-src 'self'`). Geist ships in Latin and Cyrillic subsets split by `unicode-range`, Geist Mono in Latin. Fallbacks are `-apple-system, system-ui, 'Segoe UI', sans-serif` and `ui-monospace, 'SF Mono', Menlo, monospace`, all with `font-display: swap`.

**Base:** `400 15px/22px`, `letter-spacing: -0.011em`, `-webkit-font-smoothing: antialiased`. Body `cursor: default`, because the page is an app, not a document. Fields, the link and the configuration keep the I-beam.

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
| Breadcrumb | 15 / 22 | 400 (current 500) | −0.15px | Server › person |
| Question text | 15 / 21 | 400 | — | Remove / Reconnect body |
| Desc / sub / value line | 14 / 20 | 400 | — | Row descriptions, sheet subs, head values |
| Menu item, toast | 14 / 20 | 500 | — | ⋯ menu, toast |
| Meta | 13 / 18 | 400 | — | Card status, usage label, hints, "how to" paths, limit note, the option row's line, the way's second line |
| Pill label | 13 | 600 | — | Update pill, Demo chip |
| Small label | 12 / 16 | 500 | — | Kind labels, badge top line, reach tile sub, "Copy…" labels |
| Divider | 12 | 500 | +0.06em | "OR" (the only positive tracking) |
| Axis | 11 (10 for hours) | 500 | — | Month and hours axes |
| Calendar head | 9 / 10 | 600 | — | Weekday initials |
| Mono link | 13 | 400 | 0 | Link rows, name chips |
| Mono code | 12 / 18 | 400 | 0 | `.conf` view; the file card icon is mono 10 / 600 |

### Rules

- **Tracking tightens as size grows:** −0.011em for body, −0.02em at 15–17 px, −0.025em to −0.045em for titles and numbers. Mono is always `0`.
- **Only 400, 500 and 600.** 500 marks a title or a value, 600 marks a filled button, a number on display, a pill or a step number.
- **Numbers that change use `.num`** (`tabular-nums`), so a morph or a hover readout never shifts its neighbours.
- **Mono is for things typed or copied by hand:** addresses, links, hostnames, the configuration. Names stay in Geist.
- **One line where it fits:** names, statuses, crumbs and link rows end in an ellipsis. The full text goes in `title`.
- `text-wrap: balance` for short centred paragraphs (first device, "gone" card, secure sheet). `pretty` for left-aligned question text.
- **No uppercase** except the "OR" divider. **No ellipsis on buttons**: "Remove", never "Remove…". "…" appears only for progress and truncation. The single exception is another app's own menu label quoted verbatim ("Import Tunnel(s) from File…").
- Russian runs 20–30% longer. Every new string is checked at 375 px in Russian (`rules/i18n.md`).

---

## Layout

### Page frame

- `.page`: `max-width: 1072px`, centred. The side gutter is `max(16px, safe-area)`. The top is `40px + safe-area-top` and the bottom `112px`, so the end of the scroll clears the bottom fade.
- No navbar. The page opens with a **breadcrumb row**: 32 px high and 32 px above the content. The Dawnline mark sits in a 32 px box (logo 24 px), then `server › person`, then on the right the language pill and the QR knob.
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
  - the arrival flash: 1.5 px `--ok`, fading.
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
| 16 | Field, segmented track, reach tile, option row, "until" and "hours" blocks |
| 14 | Kind tile, link row, menu item and highlight, `.conf` block |
| 12 | Go button, segmented pill |
| 11 | Ends of the way |
| 10 | Name chip, badge icon tile, link row knobs |
| 9 | File card icon |
| 2.5–4 | Chart bars (2.5 month, 3 spark, 3 calendar cells), meter and hours bar, a field's selection wash (4) |
| 1 | A field's caret and selection handles |
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

- **Layout:** a 32 px row with `gap 10`. The mark box is 32 × 32 (logo 24). The path is 15/22 `text-2` with `gap 6` and a 14 px chevron; the current crumb is `text` 500 with `aria-current="page"`.
- **Language pill** (`.cr-lang`, a pick pill: see below): 32 high, pill, `knob` fill, padding `0 8`, gap 6: the language's 16 px flag disc, its 14 px 500 code and a 14 px chevron. Its popup opens under it, 10 px away.
- **QR knob** (`.cr-qr`): a knob with the QR icon. It opens into the page's code card where it stands (see below).
- **Truncation:** the crumbs truncate independently, each with its own ellipsis.

### Dropdowns · `ui/drop.ts`, `styles/drop.css`

The ⋯ menu, the pick pills' popups and the page code card are one kind of thing, and share every setting; each lays out and fills its own.

- **Glass** (`.drop`): Apple's iOS 26 Liquid Glass, Regular (Figma kit), in `tokens.css` `--glass-*`: on dark black 40% with a white 4% film (the kit's black 60% + white 6% at 67%), on light `rgba(245,245,245,.6)`; backdrop `blur 28, saturate 1.8`; a soft, even 1 px inner edge, no gradient (white 5% / black 4%); a shadow on light only, soft (`0 8 32` black 12%): on dark the edge sets it apart. Its own colours: text `#F5F5F5` / `#1A1A1A`, subtitles `#8A8A8A` / `#727272`, destructive `#FF383C` (`--bad`), separators a touch softer than the edge (white 4% / black 3%); a solid highlight (`raised` + `text` 8% / 11%). Nothing dims around one. Over the page and a sheet alike (z 60).
- **Placement:** its nearest point 8 px from its button, under it where it fits, else over it; centred on it, 12 px inside the screen's edge.
- **Motion:** in, a spring out of where it grows from (`scale .5, blur 6` on POP, a little overshoot); out, back towards it from where it stands (`scale .7, blur 4`, 110 ms EASE_IN): quicker than it came.
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
| `accent` | accent / white | 600 | The one primary action: Add this device, Reconnect, Open securely, Download (router) |
| `tint` | accent 13% / accent | 600 | A card's **Connect** (quiet primary) |
| `soft` | knob / text | 500 | Cancel, "Add it from the device", Show key, Copy, Start over |
| `red` | bad / white | 600 | Remove |

- **Size:** 48 high (`.sm` 40, 15 px), pill, padding 0 20 (`.sm` 0 16), gap 8, `.block` = full width.
- **Press:** `scale(.95)`. No ellipsis, no blue text links for actions.
- **Busy:** the button keeps its size. Its content blurs away and the **orb** comes up through the blur in the button's own colour. See *Motion → Busy orb*.

### Field and go button · `.field`, `.go`

- **Field:** 48 high, radius 16, `field` fill, padding `0 4 0 16`. The input is 16/24 500 and the placeholder `text-3`. Focus: inset 1.5 px ring at text 16%, on SMOOTH.
- **Go button:** 48 × 40, radius 12, at the field's end. Idle: `knob` / `text-3`, `cursor: not-allowed`. Ready: accent / white, the colours changing on SMOOTH. Press `.9`.
- Arrow for create, check for save. The field and its go button are the whole form: no label row, no separate Save.
- **Caret** (`ui/caret.ts`, on name fields, with a mouse or trackpad; a touch screen keeps the system's): the input's own is hidden (`caret-color: transparent`) and the field draws one as macOS does: accent, 2 × 20, radius 1. It glides to where the next letter goes (see *Motion → Caret and selection*), and a click puts it where clicked at once. It blinks 0.6 s on / 0.6 s off with soft fades, stays solid while typing and blinks again 0.5 s after the last key.
- **Selection** (`pointer: fine` only): the native selection is see-through and the text keeps its colour. Under the text sits an accent 26% wash, 22 high, radius 4, with an iOS handle at each end: a 2 × 22 line with a 9 px knob, on top at the start and under it at the end. A selection grows out of the caret and, on collapse, fades in place before its ends rejoin the caret. It never runs past the input's edges, so a long, scrolled name's wash stops before the go button. On a touch screen the field draws neither: the system's caret shows (in the accent) with its own selection and handles.
- **Refusal:** a refused entry makes the field **shake** at once, while a red line under it (`ui/bad-line.ts`) says why in a few words, short enough for one line.
- **Shake** (`shared/shake.ts`): iOS's wrong-passcode shake, a damped swing sideways about four times in 0.52 s (14 px at most, settling by half), linear over its frames. The field's outline goes red with it (a 1.5 px inset ring in `bad`, as the focus ring is drawn), holds 0.7 s and fades back to the ring the field has (focused or not) over 0.8 s on ease-out; another refusal starts it red again. Another one starts from where the field is, never jumping back; only its own animation is touched, so the focus ring's transition goes on. With less motion asked for it doesn't move (the red line or toast still says why).

### Notice · `page/notices.ts`

- **Layout:** radius 24, padding `14 18 14 14`, gap 14, a 36 px glass icon, a 15/22 500 title and a 14/20 `text-2` line that adds to the title and never repeats it.
- **Tones:** `warn` (orange) for attention (outside hours, ends soon). `bad` (red) for an end (out of data, access ended).
- **Placement:** one per page, above the columns, 22 px above them.
- **On a repaint** a notice that comes blurs in, one that goes fades where it stood and one that changes morphs in place, while its slot glides to the new height. The page under it moves instead of jumping.

### Section head

- 20/28 500 title with a `text-3` 14 px 500 aside at the baseline ("3 of 4", in the page's numerals), `warn` when over the limit.
- Under the grid sits a `note-s` (13/18 `text-3`) for the limit note.

### Device card · `page/devices.ts`

**Anatomy:**

- Card: `raised`, radius 28, padding 8, gap 8.
- Top row (padding `8 6 6 10`, gap 12): a 32 px glass icon (blue on "this device", else grey), the name (16/22 500, one line), the status (13/18, one line, full wording in `title`), and the ⋯ knob.
- Bottom, one of three:
  - **Usage** (`field`, radius 20, padding `12 14 12 16`, min-height 66): "Last 7 days" 13/18 `text-2` over the total 17/24 500 tabular. Spark of 7 bars at the right: 6 px wide, gap 4, ≤ 34 px high, min 3, radius 3, `--bar`, today in accent. Hovering a bar puts that day's name and bytes in place of the label and total instantly, with no morph.
  - **Reconnect** (instead of the week): a `tint` block button with the refresh icon.
  - **Connect**: a `tint` block button with the QR icon.
- A status is one line, and Reconnect or Connect takes the week's place. The button is lower than the week (48 against 66), so a card alone in its row is lower too; when its bottom changes, the card glides to its new height (see *Motion → Repaint choreography*).

The grid keeps cards in place across repaints and glides them (FLIP).

**Status line:** one 13/18 line in its state's colour.

| Look | Colour |
|---|---|
| This device | accent; the card gets the accent ring and the icon turns blue |
| Connected | ok |
| Attention (settings changed, outside hours, no data left, a link that fails, not set up yet) | warn, with Reconnect or Connect in the bottom where one applies |
| At rest ("Last connected 3 h ago", the exact time in `title`) | text-2 |
| Disabled | text-2, the card at 50% opacity |

A longer reason sits in `title` and, for a screen reader, in hidden text right after the status.

**Rename on the card** (`flows/rename.ts`): the name is where it is changed.

- **At rest:** an editable name is a button. Under the pointer a faint wash (`raised` + text 6%, radius 8) hugs its words.
- **Editing:** the name gives way to its own input in the same font and place, with no frame or fill: only the field's caret and selection (the name selected). The status line morphs to a hint in `text-2`.
- **Saving:** the words shimmer (see *Motion → Shimmer*), settle to solid, and the status morphs back from the hint, words and colour.
- **Cancelling:** the name it had comes back; the status turns back.
- **Refusal:** the words shake (no red ring here, the field has none) and the status line says why in `bad`, in its one line, in full on hover.

**Add card:** a `button.dev.add`, min-height 144, centred, grey glass plus 36 and "Add device" in `text-2` 500. Hover raised + knob 45%, press `.98`.

**First card** (no devices yet):

- spans the grid, padding `28 24 24`;
- blue glass plus 44, "Add your first device" 18/24 500;
- one balanced 14/20 line (max 34ch);
- an accent block button, max 320.

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
| **What it reaches** (shield, home or globe glass) | Title only | Two **reach tiles** (radius 16, `field`, padding `12 12 12 14`, glass 28, title 14/20 500, sub 12/16; a 20 px round mark at the top right: ok-soft check or knob minus, the tile dimmed when off). Then a sentence with the hostname pattern in mono, and **name chips** (32 high, radius 10, mono 13, the domain part in `text-3`, a copy icon 14). |
| **Data this month** (chart glass) | A 16 px **ring** (track `--bar`, arc accent, warn ≥ 90%, bad ≥ 100%) and "38.6 GB / 100 GB"; hidden while open | The **month**: one bar per day (flex, gap 3, 64 high, radius 2.5, min 3; days to come at 45% bar; today accent), an axis 11 px `text-3` with "Today" in accent under its bar (the month's ends hide when it comes close), the total line (`bad` when out), a 6 px **meter** (same tone thresholds), and a `.desc`. Hovering a bar puts that day's total in place of the total instantly. |
| **Access until** (calendar glass) | "30 Nov" plus "42 days" in ok, warn when soon, or "ended" in bad | The **until block** (`field`, radius 16, padding `14 16`): the days left as a 36/40 600 number (warn when soon), "days left", the end date in `text-3`, and a **calendar** of the weeks to the end. 7 columns of 10 px cells with gap 5 and radius 3: past at text 5%, left at text 16%, today in accent, the last day ringed 1.5 px accent; warn colours when soon. Under it the **hours bar**: 8 px track, the allowed window in ok 70%, a 2 × 16 "now" marker (`text`, warn when outside, with a 2 px field ring), and axis 00/06/12/18/24 at 10 px. With nothing to open, the row is still. |

A repaint keeps the rows on the page and changes what they hold in place, the same row open (see *Motion → Repaint choreography*).

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
- **View head** (`.vhead`): 76 high. Title 20/28 500, centred with a Back knob inside a flow. The head is the drag handle, with `touch-action: none` and a grab cursor.
- **Sub line:** 14/20 `text-2`, pulled up 16 px under the head.

**Movement:**

- **Views stack.** The sheet glides to each view's height.
- **Closes by:** ×, the scrim, Escape (instant), the phone's back button, or a pull down on its head.
- **A sheet asked for while one closes** opens once it is gone. Escape while it closes ends it at once.

**Connection keys** (`.hpill`): Download and Copy on the connection's row, beside its chevron, while the row is open (they fade in with a blur as it opens, the title making room, and go as it shuts): quiet 32 px circles, the icon 16 px in the chevron's `text-2`, a `knob` circle behind one under the pointer, its icon up to `text`.

- **Tooltip:** one 26 px pill in toast colours under the keys. It appears after 420 ms of hover, then follows the pointer (or Tab) from key to key at once, gliding from where it stands, and says "Copied" after a copy. Back on a key while it still fades out, it turns back from there.

**Question view** (`.ask`: Reconnect, Remove):

- left-aligned, as iOS asks now, with 24 px top padding;
- a 64 px glass icon in the action's tone, a 20/28 500 question and a 15/21 `text-2` paragraph;
- two equal buttons: **Cancel** (soft) and the action (accent for Reconnect, red for Remove);
- no × beside them.

**Secure view:** centred lock glass, an accent "Open securely" button and a short note.

### ⋯ Menu · `ui/menu.ts`

Apple's iOS 26 menu (Figma kit, "Menu – iPhone"), made compact: smaller type and tighter rows.

**Surface:** a dropdown (see *Dropdowns*): at least 210 wide, radius 24, padding `6 0`.

**Rows**, 6 px in, in groups (copy actions, then Rename, Reconnect, Remove): 8 px above and below the words (34 high, 50 with a line under the label), radius 18 (concentric); the icon 14 px in from the rounded edge, more than the 10 px from it to the words, so it doesn't crowd the curve; 12 px at the right end: a 16 px icon, a 14 px 400 label (line 18) and an 11.5 px subtitle under it where the item has one (the address it copies, tabular figures), 1 px apart. Reconnect `warn`, Remove destructive.

**Separators** between groups: 13 px high, their 1 px line 16 px in from the edge.

**Highlight:** the dropdowns' (see *Dropdowns*), radius 18 on a row. The row under it grows its icon to 1.08 on the same spring; a press takes the row to 0.97.

**Motion and shutting:** as every dropdown's, growing from the knob's side.

### Toast · `ui/feedback.ts`

- Bottom centre, `24px + safe-area` from the bottom, one at a time; a new one replaces the shown one.
- 42 high pill, padding `0 18 0 13`, 14 px 500, an 18 px icon (check in ok, alert in bad).
- 2.4 s on screen. Used for every result and every failure.

### App picker · `ui/seg.ts`

- **Track:** 48 high, radius 16, `field`, padding `0 4`.
- **Items:** icons only (20 px) at 56 px each. The picked item takes the remaining width (`flex-grow`) and shows its name.
- **Pill:** 40 px, radius 12. It stretches like skiper21's tabs: the leading edge reaches the new item first and the trailing edge follows. At rest it sits on its item by layout alone (4 px and the items before it on the left, the items after it on the right, each 56 or 44 px), so the sheet changing width carries it along with nothing watching.
- **Item colours:** idle `text-3`, hover `text-2`, picked `text`.

### Kinds picker · `flows/add.ts`

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
- `.badges2`: two side by side, no trailing mark.
- Inside an inset row: knob 65% over field, hover `knob`, one step above the row.

### Set-up sheet · `flows/setup-view.ts`

**Structure.** The way sits on top, 18 px above what is under it. Under it come numbered steps, inset accordion rows, or both. A row holds what a step would: a QR with its link row, the app picker with a code and its scan line, small soft buttons, or a file card with a nested inset row for the `.conf`. Pinned Download / Copy keys sit in the head where the view has them.

**Steps:** a 24 px round number (knob, 13 px 600), a 16/24 500 title and a body with gap 10. Steps sit 20 px apart.

**"How to" path:** `Open AmneziaWG › + › Import Tunnel(s) from File…` in 13 px `text-2`, the app's own words in `text` 500.

**Scan line:** "In WireGuard: + › Create from QR code". Where iOS and Android name a step differently, that word alternates every 3 s, with the  or Android mark beside it.

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
- **Configuration:** `pre` 12/18 mono, max-height 16 rem, scrolls.
  - colours: section headers in accent, keys in `text`, values in `text-2`;
  - **keys are masked** (`••••` in `text-3`, letter-spaced 1 px) until "Show key". The mask and the key share one place and cross-fade; the one at rest is out of sight.

### Glass icon catalogue · `ui/glass.ts`

`phone, mobile, tablet, computer, router, other, plus, globe, home, shield, chart, calendar, clock, pause, server, link, key, lock, check, trash, refresh, app (AmneziaVPN mark), file, lan (three devices joined)`.

### Demo-only pieces · `demo/` (not in the router build)

- "Demo" chip after the crumbs (26 high, accent-soft, 13 px 600).
- GitHub knob (its mark only, 32 px, as the QR knob) before the language pill (hidden below 480 px; a button in the drawer instead).
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
5. **The keyboard never animates.** Escape closes menus and sheets instantly.
6. **Reduced motion keeps fades, drops travel.** See *Reduced motion*.

### The engine · `motion.ts`

```ts
spring(k, c, m = 1)   // closed-form damped harmonic oscillator; under-, critically and over-damped branches
                      // duration = time until it stays within 0.15% of the end (sampled every 4 ms, ≤ 3 s)
                      // what is left of the way then is spread over the curve (mostly near its end), so it lands on 1
                      // exactly: a 500 px travel ends without a last-frame step
                      // easing   = CSS linear() with 65 points; at(ms) = progress for script-driven motion
publishSprings(root)  // --spring-{bouncy,smooth,soft,quick} and --spring-*-dur on <html> for CSS transitions
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
| **POP** | 520 / 24 | 0.53 | 544 ms | **14.3%** | 58 ms | 96 ms | 162 ms | ⋯ menu open, check icon after copy, the OS mark turning in |
| **SOFT** | 380 / 28 | 0.72 | 476 ms | 3.9% | 74 ms | 138 ms | 232 ms | Accordion rows and chevron, dialog open (computer) and its scrim |
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

#### 1. Page intro (first paint, once per visit)

| What | From → to | Timing |
|---|---|---|
| Each block (crumbs, notice, section heads, each card, the limit note, each access row, the gone card), in the order they stand on screen (top to bottom, then left to right), from the first one on screen | `opacity 0 → its own opacity, y10 → 0, b4 → 0` | 520 / 60 + 40·i, EASE_OUT, fill backwards |
| The sun of the logo | `translateY(7px) → 0`, clipped above the horizon bar: the sun rises | 900 / 150, EASE_OUT |

A disabled card rises to its own 50%, not to 1. On a phone the wave runs from the crumbs through "Your access" and its rows down to "Your devices" and the cards. The first block on screen always rises at 60 ms: a reload that goes back deep into the page starts the wave there, and the blocks above it rise with it.

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

**Whole mode** (`whole: true`, for words in a flowing sentence, app names, menu paths): old words `out, b4` 180 ms EASE_IN, new words `in, b4 → 0` 280 / 60 EASE_OUT.

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
| Escape | everything | gone at once | 0 |

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
| Open | `in, s.9 → 1, b4 → 0`, origin at the button's corner (top right, or bottom right when above) | POP 544 |
| Close | from where it stands (one still popping in included) → `out, s.96, b3` | 120, EASE_IN |
| Highlight appears | opacity at the hovered item | 150, EASE_OUT |
| Highlight moves | `translateY` to the next item; colour to its tone | QUICK 296; bg 150 |
| Highlight leaves | opacity 0 when the pointer leaves the menu; back on an item while it still shows, it turns back and glides from where it stands | 150 |

QUICK replaced SMOOTH for the highlight because SMOOTH felt late: it reaches 90% at 130 ms against SMOOTH's 228 ms.

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

#### 15. Other moments

| What | Motion | Timing |
|---|---|---|
| Error under a field in a sheet | in: `in, y−4 → 0, b4 → 0` as the sheet glides open (see 5, *Content glide*); out: `out, y−4, b4` where it stands, then the sheet glides shut; a second error morphs its words; each turns back from where it stands | 220, EASE_OUT; out 180, EASE_IN, the glide from 170 ms |
| Show key / Hide key | the mask and the key cross-fade in place, each from where it stands: in → `none, 1` (320, EASE_OUT); out → `0, b4` (200, EASE_IN), then out of sight. The icon (key ↔ ×) turns the same way, out through `s.6, b3`; the label morphs | 320 / 200 |
| Steps fold (an inset row above them opening) | `height, opacity, blur(0 ↔ 4px)` from where it stands (a double click turns it back); a row still opening around it heads for the new height | SMOOTH 524 |
| Top edge fade | opacity 0 ↔ 1 at `scrollY > 2` | 200 ms |
| Demo scenario switch | page `out, b4` 160 EASE_OUT → repaint → `in, y6, b4 → 0` 420 EASE_OUT | demo only |

### Shimmer · `ui/shimmer.ts`

Words being saved (a name on its card) shimmer as an assistant's "thinking" line does. A copy of the words is laid exactly over them (same font, clipped to the input and scrolled as it is) and the input's own go transparent. The copy is the words' colour (`text`) over a muted base (`text` 38% into `raised`), painted as a gradient clipped to the text: a band 2.2 em either side with a bell falloff (0, .5, .9, 1, .9, .5, 0) crosses it from left to right in 1.8 s, linear, then rests 0.58 s and goes again. It starts solid (the swap shows nothing), dims in 240 ms; stopping, the band holds where it is and the words fade back to their colour around it (480 ms, standard curve), and only then does the copy go. With less motion asked for there is no band: it only dims and comes back.

### Choreographies, end to end (live, demo latency ~0.5–0.75 s)

**Rename (on the card):**

- 0: Return; the words' copy laid over them dims to the muted base (240, standard curve), the caret steps aside;
- +120: the first sweep sets off (1.8 s across, linear), then again after a 0.58 s rest, until the answer;
- answer: the band holds where it is and the words fade back to their colour (480, standard curve);
- then: the input gives way to the name (identical, nothing moves), the card is drawn again and its status morphs from the hint, words and colour.

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

CSS hover and press transitions (`scale(.8–.98)`, colours, the switch) are not reduced. They are small, direct responses to input.

### Performance notes

- Animated properties are `transform`, `opacity` and `filter: blur` almost everywhere. Layout properties animate only where the layout must truly change: `height`, `width`, `max-width`, margins and radii (sheet height, accordion rows, morph width, folds), `flex-grow` (picker) and `clip-path` (way fill).
- Morphs skip elements that are not on screen. The OS alternation skips while folded.
- The caret runs one `requestAnimationFrame` loop for itself and both selection edges, writes only `transform` (and the wash's width), and stops once all three rest. Its measuring copy of the text sits out of sight with the input's font, and several events in one frame make one measure.
- Blur radii stay at ≤ 6 px; the edge fade's 12 px backdrop blur is the only large one.
- One animation per property per element at a time: new runs cancel old ones after starting from their computed state. The exception is a FLIP inside the sheet, which adds to one still under way (`composite: 'add'`).

### Motion do's and don'ts

- **Do** use a spring token for anything that moves or resizes. Use EASE_IN for exits and EASE_OUT for blur-ins.
- **Do** make the entering part wait 60–110 ms in a cross-fade, and keep exits under 220 ms.
- **Do** start from the current computed state and cancel after.
- **Do** keep loops tied to a real wait: a request, a connection, an alternation the person reads.
- **Don't** animate Escape, a language change or a reload.
- **Don't** morph a hover readout: it follows the pointer and must be instant.
- **Don't** use `transition: all`, bounces on exits, or travel over ~20 px except the drawer and the FLIP.
- **Don't** re-run an entrance animation on a repaint the person didn't cause: the calendar's days come in when its row is opened, not when a repaint keeps it open.

---

## Content & Voice

- **Short, plain and whole.** "Your devices can't connect until it's resumed." A sentence that adds to a title never repeats it. Full rules for strings and Russian: `rules/i18n.md`.
- **Buttons are verbs, with no ellipsis:** Connect, Update, Add device, Reconnect, Remove, Cancel, Open securely, Show key, Copy.
- **Statuses are short and fit one line.** The full wording goes in the tooltip: "Settings changed, update needed".
- **Other apps are quoted word for word, in each language:** "+ › Insert › Continue" for AmneziaVPN, "Import Tunnel(s) from File…" for WireGuard.
- **Honest warnings sit where the choice is made**, said once: one line where space is short, the why in `title`.
- **Numbers, sizes and dates** follow the page's language.
- **The language pill switches in place.**

---

## Accessibility

- **Focus:** `:focus-visible` draws a 2 px outline in accent at 65% with a 2 px offset, only while the keyboard is moving focus: `main.ts` sets `.kbd` on `<html>` at Tab or an arrow key and drops it at any press. Focus a script moves, or one left after a click or a touch, shows nothing.
- **Keyboard:** Escape closes the menu, then the sheet, without animation.
- **Words only on hover:** a device card's status stays one line, so a longer reason sits in `title` for a pointer and in hidden text right after the status for a screen reader (`.offscreen`). A touch screen shows neither: the trade-off for cards of one height.
- **Hidden decoration:** icons and glass icons are `aria-hidden`. Morph overlays and ghosts are `aria-hidden` and click-through. A field's drawn caret, selection and handles are click-through, and its measuring copy is `aria-hidden`; the input underneath stays the browser's own (typing, IME, its real selection).
- **Contrast:** see the table in *Colors*. `--text-3` and white-on-accent are below AA.
- **Targets:** buttons and fields are 48 px, menu items 40 px. Knobs, pills and the connection keys are 32 px, calendar cells 10 px (not interactive). The 32 px controls are below the 44 px touch guideline.
- **Reduced motion:** see *Motion → Reduced motion*.
