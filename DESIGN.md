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
  ok: "#57d64b"
  ok-soft: "rgba(87, 214, 75, 0.14)"
  warn: "#ff8a3d"
  bad: "#ff5c5c"
  bad-soft: "rgba(255, 92, 92, 0.13)"
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
  light-ok: "#33a328"
  light-ok-soft: "rgba(51, 163, 40, 0.12)"
  light-warn: "#ee6a12"
  light-bad: "#e5484d"
  light-bad-soft: "rgba(229, 72, 77, 0.1)"
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
    backgroundColor: "rgba(255, 138, 61, 0.14)"
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
    padding: 0 8px 0 12px
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

This file describes the **personal portal** (`web/src/portal`, plus the parts of `web/src/shared` it uses): its look, its components and, in its own part, its motion. The admin pages inside LuCI follow `rules/ui-design.md` and the LuCI theme and are not covered here.

The front matter follows the [DESIGN.md](https://github.com/google-labs-code/design.md) draft format (alpha). The prose sections come in that format's order. **Motion Design**, **Content & Voice**, **Accessibility**, **Live audit** and **Source map** are extra sections after them.

**How this was researched (2026-10-20, Dawnline 0.11.0).** Two passes:

1. **The code.** Every stylesheet in `web/src/portal/styles`, the motion engine (`motion.ts`), every UI module (`ui/`), the page (`page/`) and the flows (`flows/`).
2. **The live demo** ([dawnline-demo.vercel.app](https://dawnline-demo.vercel.app), the real portal over an in-page router). I went through every scenario, sheet, menu, picker and button at desktop width (1138 px) and phone width (375 px), in dark and in light, in English and in Russian. A recorder hooked `Element.prototype.animate`, `transitionrun` and `animationstart`, so every duration, delay and easing in this file was seen running, not only read. Spring durations and overshoot were computed from the same function the portal uses (see *Motion → Springs*).

Where code, older plans and the live page disagree, the live page wins. The disagreements are listed in *Live audit*.

---

## Overview

The portal is one person's page on a router. It opens from a personal link with no account and no cookie, and it has three jobs:

- show the person's **devices**;
- show their **access** (what it reaches, how much data, until when);
- **set up** a new device in about a minute.

The router serves it as a CGI process under a strict CSP, which forbids inline scripts and `style=` attributes. It is plain TypeScript, with no framework, and it does not poll.

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
8. **Honest states.** Paused, out of data, outside the hours, a plain-HTTP link: each is said once, where it matters, in the state's colour.

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
| `--accent` | `#4eafff` | `#2b9dff` | Primary action, "this device", today, links in hints, the selection ring |
| `--accent-ink` | `#ffffff` | `#ffffff` | Text on a filled accent button |
| `--accent-soft` | `blue @ 13%` | `blue @ 12%` | Tinted "Connect", the Demo chip, a primary badge's icon tile |
| `--ok` / `--ok-soft` | `#57d64b` / 14% | `#33a328` / 12% | Connected, included, the way filling green, the arrival ring |
| `--warn` | `#ff8a3d` | `#ee6a12` | Not set up yet, settings changed, outside hours, Reconnect, ends soon |
| `--bad` / `--bad-soft` | `#ff5c5c` / 13% | `#e5484d` / 10% | Out of data, access ended, Remove, errors |
| `--sel-bg` / `--sel-fg` | `rgba(131,209,255,.25)` / `#64c6ff` | `rgba(78,175,255,.22)` / `#0a76cf` | `::selection` |
| `--bar` | `text @ 13%` | `text @ 11%` | Chart bars, meter and ring tracks |

### Tint recipes (keep them)

All tints come from `color-mix`, never from new hex values:

| Recipe | Where |
|---|---|
| `color-mix(in srgb, var(--knob), var(--text) 6%)` | hover of knob, soft button, language pill, pinned keys |
| `… var(--text) 10%` | pressed or open (`aria-expanded`) knob and language pill |
| `color-mix(in srgb, var(--accent) 82%, transparent)` | hover of the filled accent button |
| `accent 20%` / `24%` over transparent | hover / active of the tinted button |
| `color-mix(in srgb, var(--warn|--bad) 10%, var(--raised))` + `inset 0 0 0 1px tone 22%` | warn / bad notice |
| `warn 14%` → hover `22%` | the Update pill |
| `color-mix(in srgb, var(--raised), var(--knob) 40%)` | hover of an accordion row (inset rows: field + knob 50%) |
| `color-mix(in srgb, var(--accent) 32%, transparent)` inset 1px | ring of the card of "this device" |
| `color-mix(in srgb, var(--text) 16%, transparent)` inset 1.5px | focused field |
| `color-mix(in srgb, var(--accent) 65%, transparent)` 2px outline, offset 2px | `:focus-visible` everywhere |

### Overlays and floating colours

- **Scrim:** dark `rgba(8,8,8,.8)`, light `rgba(236,236,235,.62)`, both with `backdrop-filter: blur(8px)`.
- **Toast and tooltip:** `#232323` on dark. On light they invert to `#0b0b0b` with `#f2f2f1` text.
- **QR card:** `#0a0a0a` "night" (light dots) on dark, `#ffffff` "day" (dark dots) on light, with a 1px `--line` rim in light.

### Glass icon tones

Glass icons (`ui/glass.ts`) draw a tinted back shape, the same shape blurred behind a frosted pane, a rim and white detail strokes. Their colours come only from classes, because the CSP drops `style=`.

| Tone | Dark a → b | Light a → b | Used for |
|---|---|---|---|
| `t-grey` | `#cfcfcd` → `#5a5a59` | `#a9a9a7` → `#3d3d3c` | Device cards (default), access rows, Add |
| `t-blue` | `#a6d9ff` → `#1d84e6` | `#7cc4ff` → `#0a6fd6` | This device, first device, kinds, reach tiles that are on, lock |
| `t-green` | `#a8f29c` → `#3aa32c` | `#82e070` → `#2e8a22` | "Everything works" (demo) |
| `t-orange` | `#ffc08f` → `#ec6a12` | *same as dark* | Warn notices, Reconnect question |
| `t-red` | `#ffadad` → `#dc3a3a` | `#ff9090` → `#c92a2a` | Bad notices, Remove question |

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

These ratios feed the findings in *Live audit*.

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
| Breadcrumb | 15 / 22 | 400 (current 500) | −0.15px | Server › person |
| Question text | 15 / 21 | 400 | — | Remove / Reconnect body |
| Desc / sub / value line | 14 / 20 | 400 | — | Row descriptions, sheet subs, head values |
| Menu item, toast | 14 / 20 | 500 | — | ⋯ menu, toast |
| Meta | 13 / 18 | 400 | — | Card status, usage label, hints, "how to" paths, limit note |
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
- No navbar. The page opens with a **breadcrumb row**: 32 px high and 32 px above the content. The Dawnline mark sits in a 32 px box (logo 24 px), then `server › person`, then on the right the language pill and the QR knob. Without a server name the place reads "Dawnline". The browser tab title is the place too.
- **Edge fades** sit above the page and under every overlay:
  - **top:** 80 px plus the safe area, a `bg → 75% → 0` gradient with `backdrop-filter: blur(12px)`, masked `1 → .88 @44% → 0`. It shows only once `scrollY > 2`, so the breadcrumb at rest stays crisp.
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

When there is nothing else to show (access paused, the link stopped working, the page could not load), the page becomes **one card in the middle of the screen** with the breadcrumb above it.

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
| Inside the sheet: ×, pinned keys | 3; their tooltip 4 |

`html { scrollbar-gutter: stable }` and `body.locked { overflow: hidden }` keep the page from shifting sideways when a sheet locks the scroll.

---

## Elevation & Depth

- **Resting surfaces have no shadow.** Depth comes from the brightness ladder alone, so cards, rows, tiles and fields are all flat.
- **Floating layers get one shadow each:**
  - `--pop-shadow`: dark `0 18px 48px -14px rgba(0,0,0,.75)`, light `0 18px 44px -14px rgba(0,0,0,.2)`. Used on the ⋯ menu (plus `inset 0 0 0 1px var(--line)`), the toast and the tooltip (plus `0 0 0 1px var(--line-glass)`).
  - `--sheet-shadow`: dark `0 24px 64px -16px rgba(0,0,0,.6)`, light `… -18px rgba(0,0,0,.22)`. Used on the sheet.
- **Scrim:** 80% (dark) or 62% (light) plus an 8 px backdrop blur. The page behind a sheet is out of focus, not just darker.
- **Inset rings replace borders.** Every ring is `box-shadow: inset 0 0 0 Npx`:
  - focus: 1.5 px, `text` at 16%;
  - picked kind: 1.5 px accent;
  - this device: 1 px, accent at 32%;
  - notice tone: 1 px, tone at 22%;
  - the arrival flash: 1.5 px `--ok`, fading.
- **Inset context.** Inside the sheet, accordion rows use `--field` (`.acc.inset`), one step above the sheet's `--raised`. Segmented controls inside them step up again (`knob 65% + field`).
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
| 16 | Field, segmented track, reach tile, "until" and "hours" blocks; the pinned keys' outer corners |
| 14 | Kind tile, link row, menu item and highlight, `.conf` block |
| 12 | Go button, segmented pill |
| 11 | Ends of the way |
| 10 | Name chip, badge icon tile, link row knobs |
| 9 | File card icon |
| 6 | Inner corners of the joined pinned keys |
| 2.5–4 | Chart bars (2.5 month, 3 spark, 3 calendar cells), meter and hours bar |
| 999 / 50% | Buttons, pills, chips, toasts, tooltips / knobs, step numbers, reach marks |

### Shape rules

- **Nesting:** inner radius = outer radius − padding. Card 28 − 8 = usage 20. Field 16 − 4 = go button 12. Segmented track 16 − 4 = pill 12.
- **Closed accordion rows touch and share rounded ends.** Only the first row's top and the last row's bottom are round. An open row lifts out with 10 px gaps and gets all four corners, and so do its neighbours' facing corners.
- **Joined key pairs** (Download | Copy beside ×): `16 6 6 16` and `6 16 16 6`, with a 2 px gap.
- **Line icons:** 24 viewBox, `stroke-width 1.8`, round caps and joins, `currentColor`. Shown at 14, 16, 18 or 20 px.
- **Glass icons:** 24 viewBox drawn at 22 (rows), 24, 26 (kinds), 28 (reach), 30 (demo rows), 32 (cards), 36 (notices, add), 44 (first), 56 (gone) and 64 (questions).
- **QR codes:** round dots (r 0.42, 0.48 when dense), eyes drawn whole as rounded squares (2.6 / 1.8 / 1.5), and the Dawnline mark in a rounded tile at the centre (dense codes have none). Light dots on `#0a0a0a` in dark, dark dots on white in light.
- **The mark:** a sun dome over a horizon bar, one colour, `fill: var(--text)`: white on dark, black on light, never the accent. Clipped above the bar so the sun can rise from behind it.

---

## Components

Measurements are CSS pixels, read live at 1138 px and 375 px. Source files are under `web/src/portal/`.

### Breadcrumb · `page/frame.ts`

- **Layout:** a 32 px row with `gap 10`. The mark box is 32 × 32 (logo 24). The path is 15/22 `text-2` with `gap 6` and a 14 px chevron; the current crumb is `text` 500 with `aria-current="page"`.
- **Language pill** (`.cr-lang`): 32 high, pill, `knob` fill, 14 px 500 language code plus a 14 px chevron that points down and turns up while its menu is open.
- **QR knob** (`.cr-qr`): opens "Open on another device".
- **Truncation:** the crumbs truncate independently. At 375 px with the demo chip they become "Dawnlin… › U…". See *Live audit*.

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

- **Field:** 48 high, radius 16, `field` fill, padding `0 4 0 16`. The input is 16/24 500 and the placeholder `text-3`. Focus: inset 1.5 px ring at text 16%.
- **Go button:** 48 × 40, radius 12, at the field's end. Idle: `knob` / `text-3`, `cursor: not-allowed`. Ready: accent / white. Press `.9`.
- Arrow for create, check for save. The field and its go button are the whole form: no label row, no separate Save.

### Notice · `page/notices.ts`

- **Layout:** radius 24, padding `14 18 14 14`, gap 14, a 36 px glass icon, a 15/22 500 title and a 14/20 `text-2` line that adds to the title and never repeats it.
- **Tones:** `warn` (orange) for paused, outside hours, server off, no server and ends soon. `bad` (red) for out of data and access ended.
- **Placement:** one per page, above the columns, 22 px above them. Paused is not a notice: the whole page becomes the single card.

### Section head

- 20/28 500 title with a `text-3` 14 px 500 aside at the baseline: "3 of 4" in the page's numerals, `warn` when the admin let the person go over the limit.
- Under the grid sits a `note-s` (13/18 `text-3`) for "You have reached your limit of N devices. Remove one to add another."

### Device card · `page/devices.ts`

**Anatomy:**

- Card: `raised`, radius 28, padding 8, gap 8.
- Top row (padding `8 6 6 10`, gap 12): a 32 px glass icon (blue on "this device", else grey), the name (16/22 500, one line), the status (13/18, one line, full wording in `title`), and the ⋯ knob.
- Bottom, one of three:
  - **Usage** (`field`, radius 20, padding `12 14 12 16`, min-height 66): "Last 7 days" 13/18 `text-2` over the total 17/24 500 tabular. Spark of 7 bars at the right: 6 px wide, gap 4, ≤ 34 px high, min 3, radius 3, `--bar`, today in accent. Hovering a bar puts that day's name and bytes in place of the label and total instantly, with no morph.
  - **Update pill** (instead of the spark) when the settings changed: 32 high, warn 14%, 13 px 600, refresh icon 14.
  - **Connect** when never set up: a `tint` block button with the QR icon. It disappears when the admin locked the person.

**Order:** "this device" first, then online, then seen, then never set up, then disabled (`byDeviceState`). The grid keeps cards in place across repaints and glides them (FLIP).

**Status line (the full matrix):**

| Condition | Text | Colour |
|---|---|---|
| Page opened through this device's tunnel | This device | accent (and the card gets the accent ring, the icon turns blue) |
| Disabled by the admin | Disabled | text-2, card at 50% opacity |
| Settings changed and it has connected before | Settings changed | warn (+ Update pill) |
| Online while out of data | Connected, no data left | warn |
| Online outside the hours | Connected, outside your hours | warn |
| Online | Connected | ok |
| Never connected | Not set up yet | warn (+ Connect) |
| Otherwise | Last connected 3 h ago (exact time in `title`) | text-2 |

**Menu items** (⋯):

- **Copy IP address** and **Copy local address**, only where the home network can reach the device;
- a separator;
- **Rename**;
- **Reconnect** (warn tone);
- **Remove** (bad tone).

A disabled device has no Rename, Reconnect or Remove. A locked page has no ⋯ at all.

**Add card:** a `button.dev.add`, min-height 144, centred, grey glass plus 36 and "Add device" in `text-2` 500. Hover raised + knob 45%, press `.98`. Gone when no slot is free or the page is locked.

**First card** (no devices yet):

- spans the grid, padding `28 24 24`;
- blue glass plus 44, "Add your first device" 18/24 500;
- one balanced 14/20 line (max 34ch);
- an accent block button, max 320: "Add this phone" on mobile, "Add this device" otherwise.

### Accordion · `ui/accordion.ts`

- **Row:** `raised`, padding `0 8`. Head 52 high, gap 10, with a 22 px glass icon, a 15/22 500 title (ellipsis), an optional chip, an optional value at the end (14 px `text-2`) and a 16 px chevron (pointing down, rotated 90°, and up when open).
- **Body:** padding `0 8 16 40` (inset rows `0 8 16 8`), column, gap 12.
- **One row open at a time.** A **still** row (nothing to open) has no chevron, no hover and no click.
- **`valHide`:** a row whose body shows the same numbers drops its head value while open (blur, fade, slide 8 px right).
- **Inset variant** (inside the sheet): rows on `field`, hover field + knob 50%.

### "Your access" rows · `page/access.ts`

| Row | Head | Body |
|---|---|---|
| **What it reaches** (shield, home or globe glass) | "Home network + Internet" / "Internet" / "Home network" | Two **reach tiles** (radius 16, `field`, padding `12 12 12 14`, glass 28, title 14/20 500, sub 12/16; a 20 px round mark at the top right: ok-soft check or knob minus, the tile dimmed when off). Then a sentence with the hostname pattern in mono, and **name chips** (32 high, radius 10, mono 13, the domain part in `text-3`, a copy icon 14; a click copies). |
| **Data this month** (chart glass; "Data used" for a total limit) | A 16 px **ring** (track `--bar`, arc accent, warn ≥ 90%, bad ≥ 100%) and "38.6 GB / 100 GB" or "· no limit"; hidden while open | The **month**: one bar per day (flex, gap 3, 64 high, radius 2.5, min 3; days to come at 45% bar; today accent), an axis 11 px `text-3` with "Today" in accent under its bar (the month's ends hide when it comes close), the total line ("38.6 GB used" / "61.4 GB left", `bad` when out), a 6 px **meter** (same tone thresholds), and a `.desc` about the reset. Hovering a bar puts "X on 13 Oct" in place of the total instantly. |
| **Access until** (calendar glass) | "30 Nov" plus "42 days" in ok, warn when soon, or "ended" in bad | The **until block** (`field`, radius 16, padding `14 16`): the days left as a 36/40 600 number (warn when soon), "days left", "Ends Mon 30 Nov" in `text-3`, and a **calendar** of the weeks to the end. 7 columns of 10 px cells with gap 5 and radius 3: past at text 5%, left at text 16%, today in accent, the last day ringed 1.5 px accent; warn colours when soon. Under it the **hours bar** when set: 8 px track, the allowed window in ok 70%, a 2 × 16 "now" marker (`text`, warn when outside, with a 2 px field ring), and axis 00/06/12/18/24 at 10 px. Without an end date and hours, the row is still. |

The data row is open by default. A repaint keeps whichever row was open.

### Sheet · `ui/sheet.ts`

**Shape:** `raised`, radius 36, `--sheet-shadow`, `overflow: hidden`.

| Width | Form |
|---|---|
| < 760 | **Drawer** floating 16 px from the left, right and bottom edges (plus safe areas), max-width 400, max-height `100% − 32 − safe areas` |
| ≥ 760 | **Dialog** centred by flex layout (not a transform, so text stays on the pixel grid), width `100% − gutters`, max-width 400 |

**Width plan.** On a computer the sheet widens for a dense QR code (an AmneziaVPN key) until the code gets about **3.2 px per module** (+80 px padding), capped by the viewport. Live: 400 → 448 for a key, 400 → 410–422 for a `.conf`. It then scrolls the code fully into view.

**Inside:**

- **×:** a knob pinned at top 22 / right 22.
- **Pinned keys:** a view's own buttons, pinned at top 22 / right 58.
- **View:** padding `0 24 24`.
- **View head** (`.vhead`): 76 high. Title 20/28 500, centred with a Back knob inside a flow. The head is the drag handle, with `touch-action: none` and a grab cursor.
- **Sub line:** 14/20 `text-2`, pulled up 16 px under the head.

**Behaviour:**

- **Views stack.** `go()` pushes and `back()` pops. The sheet glides to each view's height.
- **Closes by:** ×, the scrim, Escape (instant), the phone's back button (the sheet is a history entry), or a pull down on its head. Focus returns to the opener.
- **Labels:** `role="dialog"` named by the view title, or `alertdialog` for questions.

**Pinned keys** (`.hpill`, a phone or tablet set up from elsewhere): Download and Copy for the picked app's config, each 38 × 32, joined.

- **Tooltip:** one 26 px pill in toast colours under the keys. It appears after 420 ms of hover, then follows the pointer from key to key at once, and says "Copied" after a copy.
- **On arrival:** when the device connects, × and the keys step away (`.arrived`).

**Question view** (`.ask`: Reconnect, Remove):

- left-aligned, as iOS asks now, with 24 px top padding;
- a 64 px glass icon in the action's tone, a 20/28 500 question and a 15/21 `text-2` paragraph;
- two equal buttons: **Cancel** (soft) and the action (accent for Reconnect, red for Remove);
- no × beside them.

**Secure view** (plain HTTP): centred lock glass, "Open securely" (accent, a link to the HTTPS twin in the same tab), and an honest note about the router's own certificate.

### ⋯ Menu · `ui/menu.ts`

**Panel:** `position: fixed`, min-width 224, padding 6, radius 20, `field` fill, `--pop-shadow` plus an inner 1 px `--line`.

**Items:** 40 high, radius 14, padding `0 12`, gap 12, 14 px 500, a 16 px icon in `text-2`. Tones: `warn` (Reconnect) and `bad` (Remove) colour both text and icon. Separators are a 1 px line with `6 12` margin, kept only between items.

**Highlight:** one `knob` pill behind the items that **glides** after the pointer and takes the item's tone (`bad-soft`, `warn 13%`).

**Options:** an option list (language) shows a check on the current item and keeps an invisible check on the others so the names line up.

**Placement:** under its button, right-aligned, 8 px away, or above it where the screen ends. It grows out of the button's corner.

**Closes on:** a press outside, scroll, Escape (instant), its button again, or another menu opening.

### Toast · `ui/feedback.ts`

- Bottom centre, `24px + safe-area` from the bottom, one at a time; a new one replaces the shown one.
- 42 high pill, padding `0 18 0 13`, 14 px 500, an 18 px icon (check in ok, alert in bad).
- 2.4 s on screen. Used for every result and every failure ("Renamed", "Device removed", "Address copied", an error message).

### App picker · `ui/seg.ts`

- **Track:** 48 high, radius 16, `field`, padding `0 4`.
- **Items:** icons only (20 px) at 56 px each. The picked item takes the remaining width (`flex-grow`) and shows its name.
- **Pill:** 40 px, radius 12. It stretches like skiper21's tabs: the leading edge reaches the new item first and the trailing edge follows.
- **Item colours:** idle `text-3`, hover `text-2`, picked `text`.
- **Apps by disguise:** AmneziaVPN and AmneziaWG, plus WireGuard only when the server's disguise is off. Routers never get AmneziaVPN. The last app picked per device is remembered in `localStorage`.

### Kinds picker · `flows/add.ts`

- **Tiles:** four in a grid (`--n` columns, gap 8): PC, Mobile (phones and tablets are one choice), Router, Other. Each is 56 high, radius 14, `field`.
- **Icons and labels:** a 26 px blue glass icon, greyscale at 55% opacity until picked. The label sits under the tile at 12/16 500.
- **Picked:** the tile gets an inset 1.5 px accent ring **in place**, without travelling between tiles. Hover → `knob`, press `.94`.
- **Defaults:** the kind and the name are guessed from the browser (iPhone, iPad, a Samsung model through Client Hints, Mac, Windows PC…), deduplicated with " 2", " 3".

### Badge · `flows/setup-parts.ts`

- 60 high, radius 18, `field`, padding `0 14 0 12`, gap 12.
- A 36 px icon tile, radius 10, **inverted** (`text` fill, `raised` mark).
- Two lines: top 12/16 `text-2`, main 15/20 500.
- A 16 px trailing mark: chevron for an action, "open" for a store page in a new tab.
- `.primary` (the one thing to tap in step 2): the icon tile is accent-soft / accent.
- `.badges2`: two side by side (Android's Google Play beside the APK), no trailing mark.

### Set-up sheet · `flows/setup-view.ts`

The layout follows where the page is open:

| Layout | When | Content |
|---|---|---|
| `same` | The page is on the device being set up | "Not on the X right now?" inset accordion (opening it folds the steps away), then **1 Get <app>** (picker + store badge) and **2 Add the connection** (primary badge: a vpn:// link, the share sheet, a key to copy or a file to download, plus a "how to" path) |
| `away` | A phone or tablet set up from elsewhere | Inset accordion: "Open your link on the phone" (QR of the set-up link + link row) / "Already has the app" (picker + the connection as a QR + scan line), open by default; pinned Download / Copy keys |
| `pc-away` | A computer set up from elsewhere | "Open your link on the computer" / "Copy or save the connection" (picker + two small soft buttons) |
| `router` | A router | **1 Get AmneziaWG on the router** (OpenWrt packages badge), **2 Import the configuration** (file card with Download / Share, plus a "Configuration" inset row with Show key / Copy and the `.conf`, keys masked) |

**Steps:** a 24 px round number (knob, 13 px 600), a 16/24 500 title and a body with gap 10. Steps sit 20 px apart.

**"How to" path:** `Open AmneziaWG › + › Import Tunnel(s) from File…` in 13 px `text-2`, the app's own words in `text` 500, quoted verbatim from each app in each language.

**Scan line:** "In WireGuard: + › Create from QR code". Where iOS and Android name a step differently, that word alternates every 3 s, with the  or Android mark beside it.

**The way** (waiting for the first connection), on top of every layout:

- **Block:** `field`, radius 20, padding `12 14`.
- **Ends:** two 34 px rounded squares (radius 11): the device icon in `knob`, and the server in accent tint.
- **Track:** a dotted line between the ends (1.4 px dots every 9 px, `text-3` at 80%).
- **Waiting:** a light runs along the track and rests a beat.
- **Line under it:** "Waiting for the connection" (14/20 500).
- **On connection:** the track fills green from the device, the line morphs to "<device> connected" in green, and the server end turns green last with a pop.
- **After 10 minutes:** the line reads "No connection yet" with a 13 px hint.

### Code row, QR and link row · `ui/codes.ts`

- **QR:** 148 px (radius 18) beside its words (gap 14). Big: 208 (radius 24). Dense: full width, square, radius 22, words under it.
- **Link row:** 44 high, radius 14, the URL in mono 13 without its scheme (ellipsis, `user-select: all`), then copy and, where the browser has it, share.
- A code that changes **cross-fades in place**: the new one comes in first, so the place is never empty.

### File card and configuration

- **File card:** `field`, radius 18, padding 12. A 38 × 46 "file" icon (radius 9, mono 10 600 ".conf"), the filename in mono 13, "For computers and routers" at 12 px, and an accent `sm` block button.
- **Configuration:** `pre` 12/18 mono, max-height 16 rem, scrolls.
  - colours: section headers in accent, keys in `text`, values in `text-2`;
  - **PrivateKey and PresharedKey are masked** (`••••` in `text-3`, letter-spaced 1 px) until "Show key".

### Glass icon catalogue · `ui/glass.ts`

`phone, mobile, tablet, computer, router, other, plus, globe, home, shield, chart, calendar, clock, pause, server, link, key, lock, check, trash, refresh, app (AmneziaVPN mark), file`. An unknown name falls back to `other`.

### Demo-only pieces · `demo/` (not in the router build)

- "Demo" chip after the crumbs (26 high, accent-soft, 13 px 600).
- GitHub pill before the language pill (hidden below 480 px; a button in the drawer instead).
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
- Translate in the same change and check the Russian at 375 px.
- Respect the CSP: no `style=` attributes. Set styles through `el.style` and colours through classes.

**Don't**

- Add borders or dividers to separate surfaces (the "OR" divider and the menu separator are the only lines).
- Add shadows to resting cards, or more than one shadow to a floating layer.
- Use blue text links for actions. Use buttons and pills.
- Put an ellipsis on a button or menu item.
- Use the accent for decoration, or a new hue for anything.
- Animate with ad-hoc durations and curves. Use the springs and the two eases (see *Motion → Drift*).
- Animate in response to the keyboard (Escape), or rely on motion to convey a state.
- Use `--text-3` for text a person needs to read (see *Contrast*).

---

## Motion Design

### Philosophy

Motion in the portal does three jobs:

- **Continuity.** Things move from where they are to where they go: cards glide, sheets glide to their new height, letters slide.
- **Causality.** A response grows out of what caused it: a menu from its button, a dialog from its centre, a toast from below.
- **Calm feedback.** The orb shows waiting, the check shows a copy, the green way shows a connection.

It never decorates, never loops without a reason (the only loops are the busy orb, the way's light and the OS alternation), and **never blinks**: nothing is torn down and redrawn in sight.

Six rules hold everywhere:

1. **Springs, not durations.** Layout motion runs on physical springs (stiffness, damping, mass 1), sampled into CSS `linear()`, so CSS transitions and script animations share one curve.
2. **Exits are quick, entrances are soft.** Exits use an ease-in curve and run 120–220 ms. Entrances use ease-out or a spring and run 280–572 ms. In a cross-fade the incoming part waits 60–110 ms so the two overlap in the blur.
3. **Blur is the transition medium.** Things appear and disappear through `filter: blur(2–6px)` with opacity and a small scale (`.86–.96`) or a few px of travel. Large travel is reserved for the drawer (`translateY(100% + 40px)`) and the FLIP of cards.
4. **Interruptible from the present.** Every new animation starts from the computed current state (`getComputedStyle`, a morph's live width, the pill's current edges) and cancels the old one only after the new one is in place.
5. **The keyboard never animates.** Escape closes menus and sheets instantly.
6. **Reduced motion keeps fades, drops travel.** See *Reduced motion*.

### The engine · `motion.ts`

```ts
spring(k, c, m = 1)   // closed-form damped harmonic oscillator; under-, critically and over-damped branches
                      // duration = time until it stays within 0.15% of the end (sampled every 4 ms, ≤ 3 s)
                      // easing   = CSS linear() with 65 points; at(ms) = progress for script-driven motion
publishSprings(root)  // --spring-{bouncy,smooth,soft,quick} and --spring-*-dur on <html> for CSS transitions
play(el, frames, o)   // el.animate() with the reduced-motion policy
rubber(dist, dim)     // (1 − 1 / (dist·0.55/dim + 1))·dim: resistance that grows with the pull
dismisses(dy, v, h)   // a pulled sheet goes on a flick down (v > 0.4 px/ms) or past h/3; never on a flick back up (v < −0.1)
```

Animations from script go through `play()` (WAAPI). Hover and press states are CSS transitions. Loops and one-shots are CSS keyframes (`orb-converge`, `orb-breathe`, `way-run`, `way-pop`, `cal-in`).

### Springs

Computed from `spring()` and confirmed live: the published CSS variables read 572, 524, 476 and 296 ms.

| Token | k / c | ζ | Settles | Overshoot | 50% at | 90% at | Peak at | Used for |
|---|---|---|---|---|---|---|---|---|
| **BOUNCY** | 300 / 20 | 0.58 | 572 ms | **10.8%** | 78 ms | 133 ms | 222 ms | Toast in, a newly created device card popping in, the way's server icon pop (via CSS var) |
| **POP** | 520 / 24 | 0.53 | 544 ms | **14.3%** | 58 ms | 96 ms | 162 ms | ⋯ menu open, check icon after copy, the OS mark turning in |
| **SOFT** | 380 / 28 | 0.72 | 476 ms | 3.9% | 74 ms | 138 ms | 232 ms | Accordion rows and chevron, dialog open (computer) and its scrim |
| **SMOOTH** | 300 / 35 | 1.01 | 524 ms | 0 | 98 ms | 228 ms | — | Widths and heights (morph width, sheet height glide, sheet width), FLIP of cards and letters, picker pill trailing edge, flex-grow, folds, tooltip glide, snap-back after a pull |
| **LEAD** | 520 / 46 | 1.01 | 396 ms | 0 | 74 ms | 173 ms | — | Leading edge of the stretching picker pill |
| **QUICK** | 900 / 60 | 1.00 | 296 ms | 0 | 56 ms | 130 ms | — | ⋯ menu highlight following the pointer |

"Settles" is the whole curve, but the motion reads as done at the 90% mark. That is why a 572 ms BOUNCY toast feels like ~200 ms.

### Curves and durations

| Name | Value | Role |
|---|---|---|
| `EASE_OUT` (`--ease-out`) | `cubic-bezier(.23, 1, .32, 1)` | Entrances, hover and press transitions, folds of a finished step |
| `EASE_IN` | `cubic-bezier(.55, 0, 1, .45)` | Exits: menu, toast, dialog close, busy content out, ghosts |
| `DRAWER` | `cubic-bezier(.32, .72, 0, 1)` | The phone drawer, up 500 ms and down 420 ms (Vaul's curve) |
| ad hoc | `cubic-bezier(.2, 0, 0, 1)` | Sheet view swap and pinned keys (see *Drift*) |
| ad hoc | `cubic-bezier(.25, 1, .5, 1)` | Sheet height on a view swap, 360 ms (see *Drift*) |
| ad hoc | `cubic-bezier(0, 0, .58, 1)` | Accordion body fade-in, 300 ms |
| `ease-out` / `ease` keywords | — | Drawer scrim (420 in / 320 out), tooltip hide, arrival ring, hover background colours |

The duration ladder in use is **120 · 140 · 150 · 160 · 180 · 200 · 220 · 240 · 260 · 280 · 300 · 320 · 340 · 360 · 380 · 400 · 420 · 500 · 520 · 700 · 900 · 1800 ms**, plus springs. Below 200 ms means feedback or exit, 200–400 ms means entrance or cross-fade, ≥ 500 ms means travel or a one-time moment.

### Hover and press (CSS transitions)

| Element | Press | Hover | Timing |
|---|---|---|---|
| `.knob` | `scale(.8)` | bg +6% text | 150 ms ease-out (transform), 150 ms (bg) |
| `.btn` | `scale(.95)` | accent 82% / tint 20% (active 24%) / soft +6% | 200 ms ease-out (transform, bg, colour) |
| `.go.ready` | `scale(.9)` | — | 200 ms ease-out |
| `.kind` tile | `scale(.94)` | `knob` | 200 ms (bg, transform), ring 220, icon colour 260 |
| `.badge`, `.dev.add` | `scale(.98)` | `knob` / raised+knob 45% | 200 ms |
| `.namechip` | `scale(.96)` | `knob` | 150 ms |
| `.upd-pill`, `.cr-lang`, `.hp-b`, demo chip / GitHub | `scale(.94)` | +6% / tone 22% | 150 ms |
| Accordion row | — | raised+knob 40% (inset: field+knob 50%) | 150 ms |
| Picker item | — | `text-3` → `text-2` | 200 ms colour |
| Spark / month bar | — | `--bar` → `text-2` (today: accent+text 25%) | 150 / 120 ms |
| Field | — | focus ring inset 1.5 px | 200 ms |
| Language chevron | — | rotates `90° → −90°` while open | 200 ms ease-out |

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
| Each block (crumbs, notice, section heads, each card, the limit note, each access row, the gone card), in DOM order | `opacity 0 → its own opacity, y10 → 0, b4 → 0` | 520 / 60 + 40·i, EASE_OUT, fill backwards |
| The sun of the logo | `translateY(7px) → 0`, clipped above the horizon bar: the sun rises | 900 / 150, EASE_OUT |

A disabled card rises to its own 50%, not to 1. Live at 375 px, the wave ran from `crumbs @60` through `devices head @100`, the cards @140–260, `access head @300` and the access rows @340–420. See *Live audit #2*.

#### 2. Repaint choreography (the page after a change)

| What | Motion | Timing |
|---|---|---|
| Cards that stay but moved (FLIP) | `translate(Δx, Δy) → 0` (live: ±315 px sideways, (−315, 154) diagonally) | SMOOTH 524 |
| A device just created (`pop`) | `in, s.9 → 1, b6 → 0` | BOUNCY 572 |
| A card that newly shows (Add card after a removal, the first card) | `in (to own opacity), s.9, b6` | SMOOTH 524 / 60 |
| A device that just connected (`flash`) | `inset 1.5px var(--ok) → transparent` | 1800, ease-out |
| Changed texts on cards and access rows (`data-t` keys) | letter morph (see 3) | — |
| The count "3 of 4 → 4 of 4" | letter morph | — |
| Limit note appears | `in, y6 → 0, b4 → 0` | 420, EASE_OUT |
| Limit note leaves (a slot freed) | `out, b4`, then `hidden` | 200, EASE_IN |
| A removed card leaves (before the repaint) | `out, s.9, b6` | 220, EASE_IN, then the repaint glides the rest |

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

**`morphInto(box, kids)`** refills a whole box without a blink:

- unchanged pieces stay still;
- a piece with new words morphs where it stands (whole mode, up to 40 characters);
- a changed drawing blurs in (280 / 60);
- a piece that changed kind or height crosses: the old one is pinned where it stood and fades `b4` over 180 ms while the new one blurs in;
- pieces that only moved glide on SMOOTH.

**Interrupting:** a morph under way ends where it was going (`finish`), and the width carries on from its on-screen width. No morph runs for reduced motion or for an element that is not on screen.

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
| Body of the opening row | `opacity 0 → 1, b2 → 0` | 300, `cubic-bezier(0,0,.58,1)` |
| Body of the closing row | `opacity 1 → 0, b2`, kept displayed (`.closing`) until the row finishes | 160, EASE_IN |
| Chevron | `rotate(90°) → rotate(−90°)` | SOFT 476 (CSS var) |
| Head value (`valHide`) | `out, b4, translateX(8px)` | 200 (opacity, blur), 260 (transform), EASE_OUT |
| Calendar cells when "Access until" opens | `cal-in`: `opacity 0, scale .4 → 1` | 360 / 7·i ms (49 cells ≈ 700 ms total), EASE_OUT |

On open the neighbours' facing corners round at the same time, so the open row lifts out of the stack rather than splitting it. Inside the sheet the accordion plans the sheet's width first, so a dense code that comes into view gets its width on the same frame.

#### 5. Sheet

**Open and close:**

| Context | Element | Motion | Timing |
|---|---|---|---|
| Computer (≥ 760) open | sheet | `in, s.9 → 1, b4 → 0` from its centre | SOFT 476 |
| | scrim | `in` | SOFT 476 |
| Computer close | sheet | `out, s.96, b3` into its centre | 120, EASE_IN |
| | scrim | `out` | 120, EASE_IN |
| Phone open | sheet | `translateY(calc(100% + 40px)) → 0` | 500, DRAWER |
| | scrim | `in` | 420, ease-out |
| Phone close | sheet | from its current transform → `translateY(100% + 40px)` | 420, DRAWER |
| | scrim | from its current opacity → 0 | 320, ease-out |
| Escape, or a link that stopped working | everything | gone at once | 0 |

**View swap** (`go`, `back`, a new flow in an open sheet):

| Element | Motion | Timing |
|---|---|---|
| Old view (pinned absolutely, inert) | `out, s.96, b2` | 200, `cubic-bezier(.2,0,0,1)` |
| New view | `in, s.96 → 1, b4 → 0` | 280 / 110, same curve |
| Viewport height | old → new (live: 297 → 830, 430 → 638) | 360, `cubic-bezier(.25,1,.5,1)` |
| Sheet width | 400 → 448 for a dense key | SMOOTH 524 |
| Pinned keys | old out `s.9, b3` 180; new in `s.9 → 1, b3 → 0` | 260 / 110 |
| Clicks on the new view | ignored for 320 ms, so a tap meant for the old button doesn't press the new one | — |

**Content glide** (`glide()`, a pick that changes a view):

- the viewport height glides on SMOOTH;
- every element that moved inside glides from its old place (outermost only) on SMOOTH;
- blocks named as changed blur in (280, EASE_OUT).

**Pull to close** (phone, by the head):

- downward drag follows the finger 1:1, and the scrim fades by `1 − dy/420`;
- upward drag resists by `rubber()`;
- release closes on a flick (> 0.4 px/ms) or past a third of the height. Live, a 250 px pull closed from scrim .40, and a fast 50 px flick closed from scrim .88.
- otherwise the sheet snaps back on SMOOTH.

**Arrived** (`.arrived`) and question (`.asks`): × and the pinned keys go `out, b3, scale .9` over 240 ms EASE_OUT and stop taking clicks.

#### 6. ⋯ Menu

| What | Motion | Timing |
|---|---|---|
| Open | `in, s.9 → 1, b4 → 0`, origin at the button's corner (top right, or bottom right when above) | POP 544 |
| Close | `out, s.96, b3` | 120, EASE_IN |
| Highlight appears | opacity at the hovered item | 150, EASE_OUT |
| Highlight moves | `translateY` to the next item; colour to its tone | QUICK 296; bg 150 |
| Highlight leaves | opacity 0 when the pointer leaves the menu | 150 |

QUICK replaced SMOOTH for the highlight because SMOOTH felt late: it reaches 90% at 130 ms against SMOOTH's 228 ms.

#### 7. Toast

| What | Motion | Timing |
|---|---|---|
| In | `in, translateY(18px) scale(.9) → 0, b6 → 0` | BOUNCY 572 |
| Dwell | — | 2400 ms |
| Out | `out, translateY(6px) scale(.96), b4` | 180, EASE_IN |
| Replaced by a new toast | `out, s.96, b4`, while the new one comes in over it | 140, EASE_IN |

#### 8. Busy orb · `ui/busy.ts`, `controls.css`

The orb is aicss.dev's **Orbs B4 Converge** at its 28 px stage, twice its speed, drawn in the button's own colour.

| What | Motion | Timing |
|---|---|---|
| Click: content out | `out, s.86, b5` | 180, EASE_IN |
| Orb in | `in, s.6 → 1, b5 → 0` | 340 / 70, EASE_OUT |
| Minimum hold | a quick answer waits until the orb is fully in (`BUSY_IN` = 410 ms), so it never flickers | — |
| Answer: orb out / content back | mirror of the above, starting from where each stands | 180 / 340 + 70 |
| Orb loop: front dot (7 px) | walks a triangle (top → bottom right → bottom left). It rests 10% at each corner, leaves ease-in (`.55,0,1,.45`), arrives ease-out (`.33,1,.68,1`), and is `scale .72, blur .8` between corners. | 1.8 s, linear keyframe timeline |
| Orb loop: back dot | breathes in the centre: opacity .16 ↔ .32, blur 2.4 ↔ 1.6, scale 1.2 ↔ .98 | 1.8 s, ease-in-out |

The orb starts on the click itself (a 250 ms "only if slow" delay was tried and rejected). The button stays disabled until the answer, which also guards against double submits. `contain: strict` keeps the loop off layout.

#### 9. Copy feedback

The control that copied says so for 1.6 s:

- its icon swaps to a check (POP 544, from `s.6, b3`);
- its "Copy…" label morphs to "Copied" and back;
- a toast says what was copied;
- in the pinned keys, the tooltip glides and rewords to "Copied" (SMOOTH).

#### 10. App picker stretch

On a pick:

- **Edges:** the pill's two edges are driven per frame by `spring.at(t)`. The leading edge (toward the new item) runs on LEAD (396 ms) and the trailing edge on SMOOTH (524 ms), so the pill stretches toward the target and then contracts.
- **Width shares:** items change `flex-grow` 0 ↔ 1 on SMOOTH. Shares of the track, not pixels, so they stay right while the sheet's width changes.
- **Labels:** the old label collapses (`max-width → 0, margin-left −8, out`, 220 ease-out) while the new one blurs in (280 / 70, EASE_OUT), always inside the pill.
- **What follows:** everything the pick changes `morphInto`s in place (step title, store badge, step 2, the code) and the sheet glides.

#### 11. Kinds picker

The ring does not travel: the old tile's ring fades and the new tile's ring draws in place (box-shadow 220 ms). The icon desaturates or saturates (260 ms) and the label colour changes (200 ms). The name field updates without motion while untouched.

#### 12. Codes and words

| What | Motion | Timing |
|---|---|---|
| A new QR in the same box | new `in` first (200, EASE_OUT); old laid over it goes `out` (220 / 110, EASE_IN) | the box is never empty |
| The same code for another app (WireGuard ↔ AmneziaWG take one file) | only the words change | — |
| Words beside a code | new `in, b3 → 0` 220 EASE_OUT; old `out, b3` 200 / 90 EASE_IN | — |
| Scan line, another app | app name and each path part morph whole; the OS mark grows or shrinks (`width 0 ↔ 1.05em`, `b3`) | SMOOTH; mark out 220 |
| Scan line, OS alternation (every 3000 ms while on screen) | the differing word letter-morphs; the old mark `out, scale .5 rotate −40°, b3` (200, EASE_IN); the new one turns in from `scale .5 rotate 40°` | POP 544 / 80 |

#### 13. Waiting for the first connection · `flows/wait.ts`

**While waiting:** the way's light (`way-run`) is a gradient band masked to the dots. It travels from −70% to +70% in the first 72% of a 2 s loop (`cubic-bezier(.45,0,.55,1)`) and rests for the last 28% (≈ 560 ms). Behind it, polls run every 5 s six times, then every 15 s six times, then every 30 s. They skip while the tab is hidden and stop at 10 minutes.

**Arrival timeline**, measured live (t = 0 when the poll sees a fresh handshake):

| t (ms) | What |
|---|---|
| 0 | The line morphs to "<device> connected" (width glides on SMOOTH, letters lift and rise). Its colour turns green (300 ms). |
| 0 | × and the pinned keys step away (`out, b3, s.9`, 240 ms). The sheet scrolls to the top. |
| 0 → 200 | The light fades out (200 ms). |
| 80 → 780 | The green fills the dots from the device's end (`clip-path inset(0 100% 0 0) → inset(0)`, 700 / 80 ms, EASE_OUT). The device's end turns green (400 ms). |
| 600 → 1000 | The server's end turns green (400 / 600). Its icon pops (`way-pop`, scale .6 → 1, 420 / 600, on BOUNCY's curve). |
| 410 → 930 | Everything under the way folds shut: height → 0, `out, b4` (520 ms, EASE_OUT), and the way's bottom margin goes 18 → 0. |
| 410 → 2810 | **2.4 s of reading time.** Unchanged with reduced motion: it is not motion. |
| 2810 | The sheet closes (120 ms on a computer, 420 on a phone). |
| ≈ 2950 | The page repaints: the card glides to its new place (SMOOTH), its status morphs to "Connected", and its **green ring fades** over 1.8 s. |

#### 14. Other moments

| What | Motion | Timing |
|---|---|---|
| Add sheet, error under the field | `in, translateY(−4px) → 0`; a second error morphs its words | 220, EASE_OUT |
| "No connection yet" after 10 min | its line blurs in | 280, EASE_OUT |
| Show key | keys and masks come into focus: `b4, opacity .4 → none` | 320, EASE_OUT |
| Steps fold (same-device layout, the "Not on the X" row) | `height, opacity, blur(0 ↔ 4px)` | SMOOTH 524 |
| Top edge fade | opacity 0 ↔ 1 at `scrollY > 2` | 200 ms |
| Demo scenario switch | page `out, b4` 160 EASE_OUT → repaint → `in, y6, b4 → 0` 420 EASE_OUT | demo only |

### Choreographies, end to end (live, demo latency ~0.5–0.75 s)

**Rename:**

- 0: busy (content out 180, orb in 70 + 340);
- +513: answer, sheet out 120, orb out;
- +645: repaint, the name letter-morphs;
- +650: "Renamed" toast (BOUNCY).

**Reconnect:**

- 0: busy;
- +720: answer. Under the sheet the cards FLIP (iPhone and MacBook swap places, ±315 px) and the status morphs to "Not set up yet";
- +795: view swap to set-up. Old out 200, new in 280 / 110, height 297 → 830 (360), width 400 → 448 (SMOOTH), pinned keys in 260 / 110, × back (240), the light starts.

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
| Accordion chevron, calendar cascade, way light, way fill, server pop | Off (CSS `@media` blocks) |
| OS mark alternation | Marks swap instantly (the word still changes) |
| Sheets, menus, toasts | Fade only |
| Arrival reading time (2.4 s) | Unchanged |

CSS hover and press transitions (`scale(.8–.98)`, colours) are not reduced. They are small, direct responses to input.

### Performance notes

- Animated properties are `transform`, `opacity` and `filter: blur` almost everywhere. Layout properties animate only where the layout must truly change: `height`, `width`, `max-width`, margins and radii (sheet height, accordion rows, morph width, folds), `flex-grow` (picker) and `clip-path` (way fill).
- Morphs skip elements that are not on screen. The OS alternation skips while folded. Polls pause in hidden tabs.
- Blur radii stay at ≤ 6 px; the edge fade's 12 px backdrop blur is the only large one.
- One animation per property per element at a time: new runs cancel old ones after starting from their computed state.

### Motion do's and don'ts

- **Do** use a spring token for anything that moves or resizes. Use EASE_IN for exits and EASE_OUT for blur-ins.
- **Do** make the entering part wait 60–110 ms in a cross-fade, and keep exits under 220 ms.
- **Do** start from the current computed state and cancel after.
- **Do** keep loops tied to a real wait: a request, a connection, an alternation the person reads.
- **Don't** animate Escape, a language change or a reload.
- **Don't** morph a hover readout: it follows the pointer and must be instant.
- **Don't** use `transition: all`, bounces on exits, or travel over ~20 px except the drawer and the FLIP.
- **Don't** re-run an entrance animation on a repaint the person didn't cause (see *Live audit #1*).

---

## Content & Voice

- **Short, plain and whole.** "Your devices can't connect until it's resumed." A sentence that adds to a title never repeats it. Full rules for strings and Russian: `rules/i18n.md`.
- **Buttons are verbs, with no ellipsis:** Connect, Update, Add device, Reconnect, Remove, Cancel, Open securely, Show key, Copy.
- **Statuses are short and fit one line.** The full wording goes in the tooltip: "Settings changed, update needed".
- **Other apps are quoted word for word, in each language:** "+ › Insert › Continue" for AmneziaVPN, "Import Tunnel(s) from File…" for WireGuard.
- **Honest warnings sit where the choice is made:** plain HTTP, the router's own certificate, connected but no data left.
- **Numbers, sizes and dates** follow the page's language (`num`, `bytes`, `toLocaleDateString(locale())`). Times are the router's clock, hours shown in the visitor's time when the offset is known.
- **The language pill switches in place.** The page opens in the kept choice, else the browser's language, else English.

---

## Accessibility

- **Focus:** `:focus-visible` draws a 2 px outline in accent at 65% with a 2 px offset. Mouse focus shows nothing.
- **Roles:**
  - the sheet is `dialog`, or `alertdialog` for questions, with `aria-modal` and `aria-label` = the view's title;
  - the menu is `menu` with `menuitem` or `menuitemradio` (`aria-checked`);
  - the picker is a `tablist` of `tab`s (`aria-selected`); the kinds are a `radiogroup` of `radio`s (`aria-checked`);
  - accordion heads are buttons with `aria-expanded`;
  - the way is `role="status"` with `aria-live="polite"`;
  - the menu path has its own `aria-label` naming both systems' words;
  - busy buttons get `aria-busy`.
- **Keyboard:** Escape closes the menu, then the sheet, without animation. The phone's back button closes the sheet. Focus returns to the opener. The rename field selects its text on open.
- **Hidden decoration:** icons and glass icons are `aria-hidden`. Morph overlays and ghosts are `aria-hidden` and click-through. An icon-only button has an `aria-label`.
- **Contrast:** see the table in *Colors*. `--text-3` and white-on-accent are below AA.
- **Targets:** buttons and fields are 48 px, menu items 40 px. Knobs and pills are 32 px, the pinned keys 38 × 32 and calendar cells 10 px (not interactive). The 32 px controls are below the 44 px touch guideline.

---

## Live audit: findings (2026-10-20)

These are observations from the code read and the live run, not changes. Each is cheap to confirm in the demo.

### Motion

1. **The calendar replays on every repaint.** While "Access until" is open, every repaint re-runs `cal-in` on all 49 cells (≈ 700 ms). That includes a Rename, a Reconnect (under the scrim), a device that connects, and a scenario switch. The cells are rebuilt and the CSS rule `.acc-row.open .cal-g i { animation: cal-in … }` fires again. This breaks "nothing blinks". Animate the cells only from the accordion's toggle, or skip when the row was already open.
2. **The phone intro runs out of visual order.** At < 960 px "Your access" is shown first (`order: -1`), but the intro staggers in DOM order. The wave goes crumbs → devices (below) → back up to access. Sort the intro list by on-screen position.
3. **"Show key" ↔ "Hide key" swaps instantly** (`replaceChildren`), against the rule that every in-place text morphs. Same for its icon.
4. **The sheet uses two height animations.** A view swap glides height over 360 ms `cubic-bezier(.25,1,.5,1)` with `cubic-bezier(.2,0,0,1)` cross-fades and pinned keys. In-view changes use SMOOTH (524 ms). Moving the swap onto the spring tokens would make the sheet move the same way however its content changes.
5. **`way-pop` uses BOUNCY's curve over 420 ms** instead of BOUNCY's own 572 ms. The spring is compressed and its 10.8% overshoot comes faster than the token's.
6. **The drawer scrim uses CSS keywords** (`ease-out` 420 / 320) where the dialog's scrim uses SOFT and EASE_IN. Harmless, but it sits outside the token set.
7. **Comments drift from the code.**
   - `motion.ts` says BOUNCY is "the accordion", and `accordion.css` and `accordion.ts` call it "bouncy". The accordion runs on SOFT (476 ms, 3.9%), on purpose since 2026-10-19.
   - `docs/plan-portal-redesign.md` says "one bottom drawer at every width" and "four kinds with a sliding ring". Live, the sheet is a centred dialog from 760 px, and the ring does not travel.
8. **The language switch is a hard cut.** The whole page is rebuilt with no fade. It is consistent with "nothing animates that the person can't follow", but it is the only visible change without a transition.

### Visual and accessibility

9. **White on accent** (every primary button) is 2.4:1 in dark and 2.9:1 in light. It is below AA even for large text. It is the measured skiper21 look, so it is a decision for the user. Options: a deeper accent fill with the same hue (e.g. `#1d84e6`, the glass tone b) or dark ink on the light fill.
10. **`--text-3` carries meaningful text** at 2.2–2.4:1: the limit note ("You have reached your limit…"), "3 of 4", "Ends Mon 30 Nov", axis dates and the "OR" divider. The limit note and the end date carry information and could move to `--text-2`.
11. **Light theme tone text is thin.** Status lines at 13 px in ok, warn or accent are 3.1–3.3:1 on white. Accent text links in hints are 2.9:1.
12. **`--t-orange` has no light override.** The light block redefines the grey, blue, green and red glass tones, but not orange. Orange glass icons keep their dark-theme stops in light.
13. **Breadcrumb at 375 px:** with the demo chip, both crumbs truncate to "Dawnlin… › U…". The router build has no chip, but a long server name will do the same. Consider letting the person's crumb win (`flex-shrink` on the place first).
14. **Quota tone mismatch:** the "Out of data" notice is red (`bad`) while the cards say "Connected, no data left" in orange (`warn`). Intended (the tunnel is up), but the page shows two tones for one state.
15. **"How to" paths wrap with the separator first:** a wrapped line starts with "›" ("› Pick the file and connect").
16. **The `.conf` block has no edge inside its inset row:** both are `--field`. In light especially, the code floats without a container.
17. **The trash glass icon reads as "pause"** at small sizes: two vertical strokes in a rounded body. The lid separates it at 64 px only.

---

## Source map

| Area | Files |
|---|---|
| Tokens, fonts, light theme | `web/src/portal/styles/tokens.css` |
| Reset, type, focus, selection, icons | `styles/base.css` |
| Knob, buttons, orb, field, picker, kinds, badges, hints, link row, QR | `styles/controls.css` |
| Page frame, edge fades, crumbs, columns, notices, single card | `styles/page.css`, `page/frame.ts`, `page/notices.ts` |
| Device cards | `styles/devices.css`, `page/devices.ts` |
| Access rows | `styles/access.css`, `page/access.ts`, `days.ts` |
| Accordion | `styles/accordion.css`, `ui/accordion.ts` |
| Sheet, views, questions | `styles/sheet.css`, `ui/sheet.ts`, `flows/device-actions.ts`, `flows/secure.ts` |
| Set-up | `styles/setup.css`, `flows/setup-view.ts`, `flows/setup-parts.ts`, `flows/wait.ts`, `setup.ts` |
| Menu, toast | `styles/menu-toast.css`, `ui/menu.ts`, `ui/feedback.ts` |
| Motion engine | `motion.ts`; morph `ui/morph.ts` + `styles/morph.css`; busy `ui/busy.ts`; picker `ui/seg.ts` |
| Glass icons, line icons, QR | `ui/glass.ts`, `web/src/shared/icons.ts`, `web/src/shared/qr.ts`, `ui/codes.ts` |
| Demo | `web/src/portal/demo/*` (deployed to dawnline-demo.vercel.app) |
| Rules | `rules/ui-design.md`, `rules/frontend.md`, `rules/i18n.md` |

### Measuring motion live

Paste this into the console of the demo (or the portal) before interacting, then read `__dump()`. Springs show by name because each has a unique duration.

```js
const N = {572:'BOUNCY',524:'SMOOTH',476:'SOFT',296:'QUICK',544:'POP',396:'LEAD'}, L = (window.__log = []);
const d = (e) => e.tagName.toLowerCase() + '.' + String(e.className?.baseVal ?? e.className).trim().replace(/\s+/g, '.');
const ez = (e, t) => (e?.startsWith('linear(') ? N[t] ?? 'spring' : e ?? 'linear');
const A = Element.prototype.animate;
Element.prototype.animate = function (f, o) {
  L.push([d(this), o?.duration, o?.delay ?? 0, ez(o?.easing, o?.duration), JSON.stringify(f).slice(0, 160)].join(' | '));
  return A.call(this, f, o);
};
addEventListener('transitionrun', (e) => L.push(['css', d(e.target), e.propertyName].join(' | ')), true);
addEventListener('animationstart', (e) => L.push(['kf', d(e.target), e.animationName].join(' | ')), true);
window.__dump = () => L.splice(0).join('\n');
```
