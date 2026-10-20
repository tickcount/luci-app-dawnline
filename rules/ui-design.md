# UI design (Dawnline admin, portal and other panels)

The bar is a modern product UI (Linear / Vercel / Raycast level), not a "native" LuCI form. A plain label + input row, a bare radio list, three columns of check marks or a text dump is a first draft, never the result.

**The portal has its own design system, `DESIGN.md`** (repo root): read it before any portal work, mocks included. Build from its tokens, components and spring tokens, follow its Do's and Don'ts, and update it in the same change when the portal's look or motion changes. The admin follows this file and the LuCI theme.

## Approach

- **Mock first.** Any visible change beyond a one-line fix: show a mockup (2–4 genuinely different options when the direction is open) with a recommendation, then build the chosen one. Do not start coding a layout the user has not seen.
- **Think past the obvious.** When an option is rejected as "not it", propose new concepts, not variations of the same layout.
- **Structure over text.** Tiles, segmented controls, pills, round icon buttons, inline status, folded "Advanced" sections. Summaries first ("All 6 checks passed"), details on demand.
- **No duplication.** One place per fact (usage, device count, links). Remove what is repeated elsewhere on the page.
- **Reuse the house patterns** before inventing new ones: `dl-params` folded details with a rotating chevron, `dl-tile2` tiles, round icon buttons with tooltips, `⋯` menus (destructive and Pause inside, Pause in warn colour, "Delete" without an ellipsis), bottom toasts instead of LuCI banners, the same tiles on server and person pages.
- **Alignment and spacing are part of the design.** Shared margins and edges, equal heights in a row, controls pinned consistently (top, not centred, when the user says so), nothing clipped or overflowing, single-line labels where they fit.
- **No ellipsis on buttons or menu items** ("Remove", not "Remove…"), even when they open a dialog. "…" only for progress ("Loading…") and truncated values.
- **Colour means something:** ok = green, warn/pause = orange, danger = red, accent = blue. Icons for states instead of words where obvious.
- **Honest warnings** belong in the UI (e.g. plain HTTP, Cloudflare throttling), shown where the choice is made.

## Mocks look like the real product

A mock is judged against the page it will live on, so it must already look like it. Hand-drawn look-alikes with invented styles get rejected ("выбивается из дизайна").

- **Study the existing pages first** (the section being changed and its neighbours) and build only from their components: `dl-setsec` cards with `dl-setsec-foot`, `dl-setrow` rows with a `dl-need-ic` icon tile and `dl-switch`, `dl-seg` (`sm`, `wide`), `dl-chip` / `dl-chipbtn`, `dl-list` + `dl-row`, `dl-table`, `dl-checks` (the Health check list), `dl-tile2` tiles, `dl-panel`. A new class only when nothing fits, and then in the same tokens (`--dl-*`).
- **Buttons are `cbi-button`**: actions like Edit, Change, Rescan are `neutral` pills (as "Edit in Settings", "+ Add device"); Save and Install are `positive`. No blue text links for actions.
- **Show only what changes.** Do not add existing, unrelated controls (e.g. Devices or Access ends tiles) to a mock; say in the caption that the rest of the page stays.
- **Build it from the real code and CSS**, not from a copy:
  - theme: `scp root@outline.lan:/www/luci-static/outline/{main.css,geist-*.woff2}` into the mock folder, strip `/luci-static/outline/` from the font URLs, `<html data-darkmode="true">`;
  - Dawnline CSS: the files in `web/src/admin/styles/*.css` concatenated in the order of `styles/index.ts` into `dl.css`;
  - markup: a small `mock.ts` that imports the real `admin/e`, `shared/icons`, `admin/ui/*` and `admin/widgets/*` (stub the LuCI globals `window.E`, `dom.content`, `L.url`), bundled with `web/node_modules/.bin/esbuild --bundle --format=iife`.
- Keep mocks outside the product repo, serve them with `python3 -m http.server` started from Bash (the preview server cannot read `~/Documents` on macOS), open them in the built-in browser, and delete the folder when the feature ships.

## Done means seen

Deploy, then look at it in the browser (desktop width, and narrow when layout changes) before reporting. Check modals and drawers stack correctly and long values do not overflow. Look at it in Russian too: a visible change is localized in the same change (`i18n.md`), and Russian text is longer.
