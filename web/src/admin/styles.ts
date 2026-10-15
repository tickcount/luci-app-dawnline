// Dawnline admin styles, built on the Outline theme's design tokens
// (luci-theme-outline: --panel-bg, --border, --muted, --accent, --success-a15,
// …). Every token has a fallback so other themes still get a sane look.
// Outline switches dark mode with html[data-darkmode], and its tokens follow
// it automatically, so nothing here needs a dark variant.
//
// The <style> element is rendered inside each view (not <head>): Outline's
// same-document router treats unknown head styles as a reason to reload.

const CSS = `
:root {
  /* Outline's tokens first, then LuCI Bootstrap's, then something that works anywhere. */
  --dl-card: var(--panel-bg, var(--background-color-high, transparent));
  --dl-elevated: var(--elevated, var(--background-color-high, Canvas));
  --dl-line: var(--border, var(--border-color-medium, color-mix(in srgb, currentColor 14%, transparent)));
  --dl-soft: var(--muted, color-mix(in srgb, currentColor 5%, transparent));
  --dl-soft-hover: var(--soft-hover, color-mix(in srgb, currentColor 10%, transparent));
  --dl-fg: var(--foreground, var(--text-color-highest, inherit));
  --dl-fg-muted: var(--muted-foreground, color-mix(in srgb, currentColor 65%, transparent));
  --dl-fg-faint: var(--text-tertiary, color-mix(in srgb, currentColor 50%, transparent));
  --dl-accent: var(--accent, #3a83f7);
  --dl-ok: var(--success, #00a240);
  --dl-warn: var(--warning, #e25507);
  --dl-bad: var(--danger, #e02e2a);
  --dl-ok-wash: var(--success-a15, color-mix(in srgb, #00a240 15%, transparent));
  --dl-warn-wash: var(--warning-a15, color-mix(in srgb, #e25507 15%, transparent));
  --dl-bad-wash: var(--destructive-a15, color-mix(in srgb, #e02e2a 15%, transparent));
  --dl-info-wash: var(--info-a15, color-mix(in srgb, #3a83f7 15%, transparent));
  --dl-info: var(--info, #2c67c5);
  --dl-track: var(--foreground-a10, color-mix(in srgb, currentColor 10%, transparent));
  --dl-chart-1: var(--chart-blue, #3a83f7);
  --dl-chart-2: var(--chart-green, #00a240);
  --dl-ring: var(--ring, #3a83f7);
  --dl-primary: var(--primary, #0d0d0d);
  --dl-primary-fg: var(--primary-foreground, #fff);
  --dl-mono: var(--font-mono, ui-monospace, Menlo, Consolas, monospace);
  --dl-shadow: var(--shadow-sm, none);
  --dl-radius: 16px;
}

.dl-icon-wrap { display: inline-flex; align-items: center; justify-content: center; line-height: 0; }
.dl-icon { width: 16px; height: 16px; }
.dl-icon-btn { display: inline-flex !important; align-items: center; gap: 6px; }
.dl-muted { color: var(--dl-fg-muted); }
.dl-faint { color: var(--dl-fg-faint); }
.dl-sep { color: var(--dl-fg-faint); }
.dl-nowrap { white-space: nowrap; }
.dl-mono { font-family: var(--dl-mono); font-size: 13px; }
.dl-spacer { flex: 1; }

/* pills: Outline's .label */
.dl-pill { display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 8px; border-radius: 999px;
  font-size: 12px; line-height: 20px; font-weight: 500; white-space: nowrap; background: var(--dl-soft); color: var(--dl-fg-muted); }
.dl-pill.ok { background: var(--dl-ok-wash); color: var(--dl-ok); }
.dl-pill.warn { background: var(--dl-warn-wash); color: var(--dl-warn); }
.dl-pill.bad { background: var(--dl-bad-wash); color: var(--dl-bad); }
.dl-pill.accent { background: var(--dl-info-wash); color: var(--dl-info); }
.dl-pill.off { opacity: .75; }

/* cards (Outline .cbi-section-node look) */
.dl-panel { background: var(--dl-card); border: 1px solid var(--dl-line); border-radius: var(--dl-radius); padding: 16px;
  margin: 0 0 16px; min-width: 0; box-shadow: var(--dl-shadow); }
.dl-panel-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; margin: 0 0 12px; }
.dl-panel-head h3 { margin: 0 !important; padding: 0; font-size: 16px; line-height: 24px; font-weight: 500; border: 0; background: none; }
.dl-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin: 0 0 16px; }
.dl-tile { background: var(--dl-card); border: 1px solid var(--dl-line); border-radius: var(--dl-radius); padding: 14px 16px; min-width: 0; box-shadow: var(--dl-shadow); }
.dl-tile-label { font-size: 12px; line-height: 16px; font-weight: 500; color: var(--dl-fg-faint); }
.dl-tile-value { font-size: 24px; line-height: 32px; font-weight: 500; margin-top: 4px; font-variant-numeric: tabular-nums;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: -.01em; }
.dl-tile-sub { font-size: 12px; line-height: 16px; color: var(--dl-fg-muted); margin-top: 2px; font-variant-numeric: tabular-nums; }
.dl-grid2 { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr); gap: 0 16px; }
@media (max-width: 960px) { .dl-grid2 { grid-template-columns: minmax(0, 1fr); } }

/* chart */
.dl-chart { display: block; width: 100%; height: 120px; }
.dl-bar-down { fill: var(--dl-chart-1); }
.dl-bar-up { fill: var(--dl-chart-2); opacity: .8; }
.dl-legend { display: flex; gap: 16px; font-size: 12px; color: var(--dl-fg-muted); margin-top: 8px; }
.dl-legend i { display: inline-block; width: 8px; height: 8px; border-radius: 999px; margin-right: 6px; vertical-align: 0; }
.dl-legend .down { background: var(--dl-chart-1); } .dl-legend .up { background: var(--dl-chart-2); }

/* activity */
.dl-events { list-style: none; margin: 0; padding: 0; }
.dl-events li { display: flex; gap: 12px; align-items: baseline; padding: 8px 0; border-top: 1px solid var(--dl-line); font-size: 14px; line-height: 20px; min-width: 0; }
.dl-events li:first-child { border-top: 0; padding-top: 0; }
.dl-ev-time { flex: 0 0 88px; color: var(--dl-fg-faint); font-variant-numeric: tabular-nums; white-space: nowrap; font-size: 13px; }
.dl-ev-dot { flex: 0 0 auto; width: 6px; height: 6px; border-radius: 50%; background: var(--dl-fg-faint); transform: translateY(-2px); }
.dl-ev-dot.ok { background: var(--dl-ok); } .dl-ev-dot.warn { background: var(--dl-warn); } .dl-ev-dot.bad { background: var(--dl-bad); }
.dl-ev-dot.accent { background: var(--dl-accent); }
/* The admin's own actions: an icon in the dot's place, taking the same room. */
.dl-row > .dl-ev-dot, .dl-dev-log-row > .dl-ev-dot { margin: 0 4px; }
.dl-ev-tile { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; margin: -2px -4px; border-radius: 7px;
  background: color-mix(in srgb, var(--dl-accent) 16%, transparent); color: var(--dl-accent); align-self: center; }
.dl-ev-tile .dl-icon-wrap { display: inline-flex; } .dl-ev-tile .dl-icon { width: 14px; height: 14px; }
.dl-row.dl-ev-by-admin { background: color-mix(in srgb, var(--dl-accent) 6%, transparent); }
.dl-you { color: var(--dl-accent); font-weight: 500; }
.dl-ev-kind { color: var(--dl-fg-faint); }
.dl-slotbar { display: flex; align-items: center; gap: 8px; margin: 8px 0 0 44px; }
.dl-slotbar-segs { display: flex; gap: 3px; flex: none; max-width: 100%; }
.dl-slotbar-segs i { flex: 1; min-width: 2px; display: block; height: 4px; border-radius: 2px; background: var(--dl-soft-hover); }
.dl-slotbar-segs i.used { background: var(--dl-fg-muted); }
.dl-slotbar-text { font-size: 12px; color: var(--dl-fg-faint); font-variant-numeric: tabular-nums; }
.dl-slotbar-segs i.over { background: color-mix(in srgb, var(--dl-warn) 80%, transparent); }
.dl-ev-srv { flex: none; font-size: 11px; line-height: 18px; padding: 0 8px; border-radius: 999px; background: var(--dl-soft); color: var(--dl-fg-muted); white-space: nowrap; }
/* Service log lines: tile, source name and row tint share one colour, set by the level (--sys). */
.dl-ev-by-system { --sys: var(--dl-fg-muted); }
.dl-ev-by-system.ok { --sys: var(--dl-ok); } .dl-ev-by-system.warn { --sys: var(--dl-warn); } .dl-ev-by-system.bad { --sys: var(--dl-bad); }
.dl-ev-tile.ev { background: var(--dl-soft); color: var(--dl-fg-muted); }
.dl-ev-tile.ev.ok { background: var(--dl-ok-wash); color: var(--dl-ok); }
.dl-ev-tile.ev.warn { background: var(--dl-warn-wash); color: var(--dl-warn); }
.dl-ev-tile.ev.bad { background: var(--dl-bad-wash); color: var(--dl-bad); }
.dl-ev-tile.ev.accent { background: color-mix(in srgb, var(--dl-accent) 16%, transparent); color: var(--dl-accent); }
.dl-ev-tile.sys { background: color-mix(in srgb, var(--sys) 16%, transparent); color: var(--sys); }
.dl-row.dl-ev-by-system { background: color-mix(in srgb, var(--sys) 6%, transparent); }
.dl-sys-src { color: var(--sys); }
.dl-ev-by-system:not(.ok):not(.warn):not(.bad) .dl-sys-src { color: var(--dl-fg); }
.dl-ev-text { min-width: 0; overflow-wrap: anywhere; }

/* server summary */
.dl-server { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; }
.dl-server-name { font-size: 16px; line-height: 24px; font-weight: 500; }
.dl-kv { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 24px; margin: 12px 0 0; font-size: 14px; line-height: 20px; }
.dl-kv dt { color: var(--dl-fg-muted); font-weight: 400; margin: 0; }
.dl-kv dd { margin: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }

/* People: GridSection rows rendered as cards */
.dl-map .cbi-section, .dl-map .cbi-section-node { border: 0 !important; background: none !important; box-shadow: none !important; padding: 0 !important; }
.dl-map .table.cbi-section-table, .dl-map .cbi-section-table > .tbody, .dl-map .cbi-section-table > tbody {
  display: block !important; width: 100%; border: 0 !important; background: none !important; box-shadow: none !important; border-radius: 0 !important; }
.dl-map .cbi-section-table-titles, .dl-map .cbi-section-table-descr, .dl-map .thead { display: none !important; }
.dl-map .cbi-section-table-row { display: flex !important; flex-wrap: wrap; align-items: flex-start; gap: 12px 16px; margin: 0 0 12px;
  padding: 16px !important; background: var(--dl-card) !important; border: 1px solid var(--dl-line) !important; border-radius: var(--dl-radius) !important;
  box-shadow: var(--dl-shadow); }
.dl-map .cbi-section-table-row.dl-filtered { display: none !important; }
.dl-map .cbi-section-table-row:hover { background: var(--dl-card) !important; }
.dl-map .cbi-section-table-row > .td { display: block !important; border: 0 !important; padding: 0 !important; background: none !important; width: auto !important; }
.dl-map .cbi-section-table-row > .td:first-child { flex: 1 1 26em; min-width: 0; }
.dl-map .cbi-section-table-row > .td.cbi-section-actions { flex: 0 0 auto; margin-left: auto; }
.dl-map .cbi-section-table-row > .td.cbi-section-actions > div { display: flex; flex-wrap: nowrap; gap: 6px; justify-content: flex-end; }
.dl-map .cbi-section-table-row > .td.cbi-section-actions > div > * { margin: 0 !important; flex: 0 0 auto; }
.dl-map .cbi-section-table-row > .td::before { display: none !important; }
.dl-map .cbi-section-table-row.placeholder { color: var(--dl-fg-muted); display: flex !important; justify-content: center; align-items: center; min-height: 0 !important; height: auto !important; padding: 28px 16px !important; text-align: center; }
.dl-map .cbi-section-table-row.placeholder > * { position: static !important; padding: 0 !important; margin: 0 !important; border: 0 !important; flex: 0 1 auto !important; }
.dl-map .cbi-section-table-row.dl-off .dl-card-name, .dl-map .cbi-section-table-row.dl-off .dl-avatar { opacity: .6; }
.dl-card-head { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; }
.dl-avatar { flex: 0 0 auto; width: 32px; height: 32px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600; color: var(--dl-fg); background: var(--dl-soft); position: relative; margin-right: 4px; letter-spacing: .02em; }
.dl-avatar.online::after { content: ''; position: absolute; right: -1px; bottom: -1px; width: 9px; height: 9px; border-radius: 50%;
  background: var(--dl-ok); box-shadow: 0 0 0 2px var(--dl-card); }
.dl-card-name { font-size: 16px; line-height: 24px; font-weight: 500; }
.dl-card-slug { font-size: 13px; color: var(--dl-fg-faint); font-family: var(--dl-mono); }
.dl-quota { margin: 8px 0 0 44px; max-width: 320px; height: 6px; border-radius: 999px; background: var(--dl-track); overflow: hidden; }
.dl-quota > i { display: block; height: 100%; background: var(--dl-accent); border-radius: 999px; }
.dl-quota.warn > i { background: var(--dl-warn); } .dl-quota.bad > i { background: var(--dl-bad); }
.dl-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 0 44px; }
.dl-chip { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; max-width: 240px; height: 28px;
  padding: 0 12px 0 10px; border-radius: 999px; font-size: 13px; background: var(--dl-soft); color: var(--dl-fg); transition: background .15s; }
.dl-chip:hover { background: var(--dl-soft-hover); }
.dl-chip:focus-visible { outline: 2px solid var(--dl-ring); outline-offset: 2px; }
.dl-chip .dl-icon { width: 14px; height: 14px; color: var(--dl-fg-muted); }
.dl-chip.add { background: transparent; box-shadow: inset 0 0 0 1px var(--dl-line); color: var(--dl-fg-muted); aspect-ratio: 1; padding: 0; justify-content: center; }
.dl-chip.add:hover { background: var(--dl-soft); color: var(--dl-fg); }
.dl-chip.disabled .dl-chip-name { text-decoration: line-through; color: var(--dl-fg-faint); }
.dl-chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dl-dot { flex: 0 0 auto; width: 6px; height: 6px; border-radius: 50%; background: var(--dl-fg-faint); opacity: .6; }
.dl-dot.online { background: var(--dl-ok); opacity: 1; box-shadow: 0 0 0 3px var(--dl-ok-wash); }
.dl-empty { text-align: center; padding: 40px 16px; background: var(--dl-card); border: 1px solid var(--dl-line); border-radius: var(--dl-radius); }
.dl-empty .dl-icon-wrap { width: 40px; height: 40px; border-radius: 12px; background: var(--dl-soft); margin-bottom: 12px; }
.dl-empty .dl-icon { width: 20px; height: 20px; }
.dl-empty h3 { margin: 0 0 4px !important; font-size: 16px; font-weight: 500; }
.dl-empty p { margin: 0 0 16px; color: var(--dl-fg-muted); font-size: 14px; }
.dl-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 0 0 16px; }
.dl-toolbar .dl-muted { font-size: 13px; }
@media (max-width: 640px) {
  .dl-map .cbi-section-table-row > .td.cbi-section-actions { margin-left: 0; width: 100% !important; }
  .dl-map .cbi-section-table-row > .td.cbi-section-actions > div { justify-content: flex-start; flex-wrap: wrap; }
  .dl-slotbar, .dl-chips, .dl-quota { margin-left: 0; }
  .dl-btn-label { display: none; }
}

/* full-width rows (label above) */
.cbi-value.dl-block { display: block !important; }
.cbi-value.dl-block > .cbi-value-title { display: block; width: auto; float: none; text-align: left; padding: 0 0 8px; }
.cbi-value.dl-block > .cbi-value-field { display: block; width: 100%; margin: 0; }

/* choice cards */
/* LuCI's modal above the device drawer (900); menus above both. */
#modal_overlay { z-index: 1100 !important; }
.dl-dd { position: fixed; z-index: 1200; min-width: 200px; padding: 4px; border-radius: 12px; background: var(--dl-elevated); border: 1px solid var(--dl-line);
  box-shadow: 0 12px 32px #0000004d; display: flex; flex-direction: column; }
.dl-dd button { all: unset; cursor: pointer; display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 8px; font-size: 13px; color: var(--dl-fg); }
.dl-dd button .dl-icon { width: 15px; height: 15px; color: var(--dl-fg-muted); }
.dl-dd button:hover, .dl-dd button:focus-visible { background: var(--dl-soft); }
.dl-dd button.danger, .dl-dd button.danger .dl-icon { color: var(--dl-bad, #e5484d); }
.dl-dd button.warn, .dl-dd button.warn .dl-icon { color: var(--dl-warn); }
.dl-dd hr { border: 0; border-top: 1px solid var(--dl-line); margin: 4px 0; }
.dl-chipbtn b { font-weight: 500; font-size: 11px; margin-left: 6px; opacity: .6; }
.dl-setsub { margin: 20px 0 8px !important; font-size: 13px; font-weight: 500; color: var(--dl-fg); }
.dl-row-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.dl-more-row { display: flex; justify-content: center; padding: 8px 0 16px; }
.dl-dsec-actions { display: flex; align-items: center; gap: 12px; }
.dl-kv-act { display: inline-flex; align-items: center; gap: 12px; flex-wrap: wrap; }
/* Small inline actions (View all, Change, Export, Clear…): quiet buttons, not underlined links. */
.dl-linkbtn, .dl-bento-head a, .dl-bento-foot a, .dl-panel-head a, .dl-dsec-head a, .dl-tile2-foot a {
  all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 9px; margin: -4px -6px;
  border-radius: 8px; font-size: 12px; font-weight: 500; color: var(--dl-fg-muted); text-decoration: none !important; white-space: nowrap; transition: background .12s, color .12s; }
.dl-bento-head a, .dl-bento-foot a, .dl-panel-head a, .dl-dsec-head a, .dl-tile2-foot a { color: var(--dl-accent); }
.dl-linkbtn:hover, .dl-bento-head a:hover, .dl-bento-foot a:hover, .dl-panel-head a:hover, .dl-dsec-head a:hover, .dl-tile2-foot a:hover {
  background: var(--dl-soft); color: var(--dl-fg); text-decoration: none !important; }
.dl-bento-head a:hover, .dl-bento-foot a:hover, .dl-panel-head a:hover, .dl-dsec-head a:hover, .dl-tile2-foot a:hover {
  background: color-mix(in srgb, var(--dl-accent) 12%, transparent); color: var(--dl-accent); }
.dl-linkbtn:focus-visible, .dl-bento-head a:focus-visible, .dl-bento-foot a:focus-visible, .dl-panel-head a:focus-visible { outline: 2px solid var(--dl-ring); outline-offset: 1px; }
.dl-linkbtn.danger:hover { color: var(--dl-bad); background: var(--dl-bad-wash); }
.dl-ifcards { display: flex; flex-direction: column; gap: 20px; margin: 24px 0; }
.dl-ifcard .dl-setsec-body { gap: 14px; }
.dl-iflead { display: flex; flex-direction: column; gap: 2px; padding-top: 14px; border-top: 1px solid var(--dl-line); }
.dl-iflead b { font-size: 14px; font-weight: 500; }
.dl-ifgroup h4 { margin: 0 0 8px !important; padding: 0 !important; font-size: 11px !important; font-weight: 500 !important; letter-spacing: .06em; text-transform: uppercase; color: var(--dl-fg-muted); border: 0 !important; background: none !important; }
.dl-ifgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px; }
.dl-if { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 8px 12px 8px 10px; min-width: 0;
  border: 1px solid var(--dl-line); border-radius: 10px; background: var(--dl-card); transition: background .15s, border-color .15s; }
.dl-if:hover { background: var(--dl-soft); }
.dl-if:focus-visible { outline: 2px solid var(--dl-ring); outline-offset: 2px; }
.dl-if-ic { width: 30px; height: 30px; border-radius: 8px; background: var(--dl-soft); display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; color: var(--dl-fg-muted); }
.dl-if-ic .dl-icon { width: 16px; height: 16px; }
.dl-if-main { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.dl-if-name { font-size: 13.5px; font-weight: 500; color: var(--dl-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dl-if-sub { font: 11px/16px var(--dl-mono); color: var(--dl-fg-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dl-if.sel { border-color: var(--dl-accent); background: color-mix(in srgb, var(--dl-accent) 9%, transparent); }
.dl-if.sel .dl-if-ic { background: color-mix(in srgb, var(--dl-accent) 18%, transparent); color: var(--dl-accent); }
.dl-if-check { color: var(--dl-accent); display: inline-flex; } .dl-if-check .dl-icon { width: 16px; height: 16px; }
.dl-if.auto { border-color: color-mix(in srgb, var(--dl-ok) 55%, transparent); background: var(--dl-ok-wash); cursor: default; }
.dl-if.auto .dl-if-ic { background: color-mix(in srgb, var(--dl-ok) 18%, transparent); color: var(--dl-ok); }
.dl-if-badge { display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; flex: 0 0 auto; }
.dl-if-badge.ok { color: var(--dl-ok); }
.dl-if.off { cursor: default; opacity: .5; }
.dl-if.off:hover { background: var(--dl-card); }
.dl-if.warn { border-color: color-mix(in srgb, var(--dl-warn) 60%, transparent); }
.dl-if-wanctl { gap: 10px; align-items: center; }
.dl-if-wanctl select { max-width: 240px; }
.dl-if-summary { min-width: 0; line-height: 18px; }
.dl-warn { color: var(--dl-warn); }
.dl-w-ip { width: 160px; }
.dl-dnspick { padding-top: 8px; border-top: 1px solid var(--dl-line); }
.dl-dnspick .dl-row-actions { gap: 10px; }
.dl-note { display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border-radius: 10px; font-size: 12.5px; line-height: 18px; margin: 0 0 10px; background: var(--dl-soft); }
.dl-note.warn { background: var(--dl-warn-wash, color-mix(in srgb, var(--dl-warn) 14%, transparent)); }
.dl-note .dl-icon { width: 15px; height: 15px; flex: 0 0 auto; margin-top: 1px; color: var(--dl-warn); }
.dl-stale { align-self: flex-start; margin-top: 4px; font-size: 10.5px; }
.dl-root .cbi-button.dl-btn-warn, .dl-btn-warn.cbi-button { background: var(--dl-warn-wash) !important; color: var(--dl-warn) !important;
  border-color: color-mix(in srgb, var(--dl-warn) 35%, transparent) !important; }
.dl-root .cbi-button.dl-btn-warn:hover, .dl-btn-warn.cbi-button:hover { background: color-mix(in srgb, var(--dl-warn) 24%, transparent) !important; }
.dl-btn-warn .dl-icon { color: var(--dl-warn); }
.dl-srvtabs { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px; margin: 0 0 20px; border-radius: 12px; background: var(--dl-soft); width: fit-content; max-width: 100%; }
.dl-srvtab { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; height: 34px; padding: 0 14px; border-radius: 9px;
  font-size: 13px; color: var(--dl-fg-muted); text-decoration: none !important; white-space: nowrap; }
.dl-srvtab b { font-weight: 500; }
.dl-srvtab i.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dl-fg-faint); flex: 0 0 auto; }
.dl-srvtab i.dot.ok { background: var(--dl-ok); animation: dl-srv-pulse 2s ease-out infinite; } .dl-srvtab i.dot.bad { background: var(--dl-bad); }
/* The one status dot left: a server that is running pulses. */
@keyframes dl-srv-pulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--dl-ok) 55%, transparent); } 70%, 100% { box-shadow: 0 0 0 6px transparent; } }
@media (prefers-reduced-motion: reduce) { .dl-srvtab i.dot.ok { animation: none; } }
.dl-srvtab:hover { color: var(--dl-fg); background: var(--dl-soft-hover); }
.dl-srvtab.on { background: var(--dl-card); color: var(--dl-fg); box-shadow: 0 1px 2px #0000002e, inset 0 0 0 1px var(--dl-line); }
.dl-srvtab:focus-visible { outline: 2px solid var(--dl-ring); outline-offset: 1px; }
.dl-srvtab.add { color: var(--dl-fg-muted); }
.dl-srvtab.add .dl-icon { width: 14px; height: 14px; }
.dl-srvhead { display: flex; flex-direction: column; gap: 14px; margin: 0 0 20px; }
.dl-srvhead .dl-title-row { display: flex; align-items: center; gap: 10px; }
.dl-srvhead .dl-h1 { margin: 0 !important; }
.dl-metrics.compact .dl-metric { padding: 14px 18px; }
.dl-metrics.compact .dl-metric-value { display: flex; align-items: center; gap: 6px; font-size: 18px; line-height: 26px; min-width: 0; }
.dl-metrics.compact .dl-metric-value > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.dl-metrics.compact .dl-metric-value .dl-mono { font-size: 15px; }
.dl-metrics.compact .cbi-button { flex: 0 0 auto; }
.dl-srvsections { margin: 0 0 16px; }
.dl-srvbody > .dl-setsec, .dl-srvbody > .dl-ifcards { margin: 0; }
.dl-srvbody .dl-ifcards { margin: 0; }
.dl-metric-ic { display: inline-flex; align-items: center; gap: 8px; font-size: 16px; }
.dl-metric-ic .dl-icon { width: 18px; height: 18px; color: var(--dl-accent); }
.dl-keyrow { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.dl-keyrow code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; background: none; padding: 0; }
.dl-params { border: 1px solid var(--dl-line); border-radius: 12px; background: var(--dl-card); }
.dl-params > summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 10px 14px; font-size: 13px; color: var(--dl-fg); user-select: none; }
.dl-params > summary::-webkit-details-marker { display: none; }
.dl-params > summary > .dl-icon-wrap { display: inline-flex; color: var(--dl-fg-muted); transition: transform .15s; }
.dl-params > summary > .dl-icon-wrap .dl-icon { width: 15px; height: 15px; }
.dl-params[open] > summary > .dl-icon-wrap { transform: rotate(90deg); }
.dl-params > summary:focus { outline: none; }
.dl-params > summary:focus-visible { outline: 2px solid var(--dl-ring); outline-offset: -2px; border-radius: 12px; }
.dl-params > summary:hover { background: var(--dl-soft); border-radius: 12px; }
.dl-pcount { font-size: 11px; padding: 0 6px; border-radius: 999px; background: var(--dl-soft); color: var(--dl-fg-muted); }
.dl-pgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; padding: 4px 14px 14px; }
.dl-pgroup { display: flex; flex-direction: column; gap: 6px; padding: 12px; border-radius: 10px; background: var(--dl-soft); min-width: 0; }
.dl-pgroup-head { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.dl-pgroup-head b { font-weight: 500; }
.dl-pgroup-head .dl-icon { width: 14px; height: 14px; color: var(--dl-fg-muted); }
.dl-pgroup p { margin: 0 !important; font-size: 12px; line-height: 17px; color: var(--dl-fg-muted); }
.dl-pvals { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
.dl-pv { display: inline-flex; align-items: stretch; max-width: 100%; border-radius: 6px; overflow: hidden; font: 500 11.5px/22px var(--dl-mono);
  box-shadow: inset 0 0 0 1px var(--dl-line); }
.dl-pv i { font-style: normal; padding: 0 6px; background: var(--dl-card); color: var(--dl-fg-faint); }
.dl-pv b { font-weight: 500; padding: 0 7px; color: var(--dl-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
/* Disguise methods */
.dl-methods { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; }
.dl-method { all: unset; box-sizing: border-box; cursor: pointer; display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: 12px;
  border: 1px solid var(--dl-line); background: var(--dl-card); transition: border-color .15s, background .15s; min-width: 0; }
.dl-method:hover { background: var(--dl-soft); }
.dl-method:focus-visible { outline: 2px solid var(--dl-ring); outline-offset: 2px; }
.dl-method.on { border-color: var(--dl-accent); background: color-mix(in srgb, var(--dl-accent) 8%, transparent); box-shadow: inset 0 0 0 1px var(--dl-accent); }
.dl-method.off { cursor: not-allowed; opacity: .55; }
.dl-method.off:hover { background: var(--dl-card); }
.dl-method-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; }
.dl-method-head .dl-pill { flex: none; }
.dl-method-head b { font-weight: 500; font-size: 14.5px; flex: 1; }
.dl-method-ic { width: 32px; height: 32px; border-radius: 9px; background: var(--dl-soft); display: inline-flex; align-items: center; justify-content: center; color: var(--dl-fg-muted); flex: 0 0 auto; }
.dl-method-ic .dl-icon { width: 17px; height: 17px; }
.dl-method.on .dl-method-ic { background: color-mix(in srgb, var(--dl-accent) 18%, transparent); color: var(--dl-accent); }
.dl-method p { margin: 0 !important; font-size: 12.5px; line-height: 18px; color: var(--dl-fg-muted); flex: 1; }
.dl-method-meters { display: flex; gap: 16px; }
.dl-dots { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--dl-fg-faint); }
.dl-dots-row { display: inline-flex; gap: 3px; }
.dl-dots-row i { width: 6px; height: 6px; border-radius: 50%; background: var(--dl-line); }
.dl-dots-row i.on { background: var(--dl-fg-muted); }
.dl-method.on .dl-dots-row i.on { background: var(--dl-accent); }
.dl-method-foot { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--dl-fg-faint); padding-top: 8px; border-top: 1px solid var(--dl-line); }
.dl-method-foot .dl-icon { width: 13px; height: 13px; flex: 0 0 auto; }
.dl-method.off .dl-method-foot { color: var(--dl-warn); }
.dl-ibadge { display: inline-flex; align-items: center; gap: 3px; height: 22px; padding: 0 6px; border-radius: 999px; background: var(--dl-soft); color: var(--dl-fg-muted); flex: 0 0 auto; }
.dl-ibadge .dl-icon { width: 13px; height: 13px; }
.dl-ibadge.warn { background: var(--dl-warn-wash); color: var(--dl-warn); }
.dl-ibadge.bad { background: var(--dl-bad-wash); color: var(--dl-bad); }
.dl-access { display: inline-flex; gap: 4px; flex: 0 0 auto; }
.dl-ibadge.lan { background: color-mix(in srgb, var(--dl-accent) 16%, transparent); color: var(--dl-accent); }
.dl-ibadge.inet { background: var(--dl-ok-wash); color: var(--dl-ok); }
/* Overview: address bar */
.dl-addrbar { display: inline-flex; align-items: stretch; flex-wrap: nowrap; max-width: 100%; margin-top: 4px; border: 1px solid var(--dl-line); border-radius: 10px;
  background: var(--dl-card); overflow: hidden; }
.dl-addrbar-seg { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 7px; padding: 6px 12px; font-size: 13px; color: var(--dl-fg-muted);
  border-left: 1px solid var(--dl-line); white-space: nowrap; min-width: 0; }
.dl-addrbar-seg:first-child { border-left: 0; }
.dl-addrbar-seg .dl-icon { width: 14px; height: 14px; color: var(--dl-fg-faint); flex: 0 0 auto; }
.dl-addrbar-seg .dl-mono { font-size: 12.5px; }
.dl-addrbar-seg.main { cursor: pointer; color: var(--dl-fg); }
.dl-addrbar-seg.main:hover { background: var(--dl-soft); }
.dl-addrbar-seg.main:focus-visible { outline: 2px solid var(--dl-ring); outline-offset: -2px; }
.dl-addrbar-seg.main > .dl-icon-wrap:last-child .dl-icon { opacity: .7; }
/* Overview: bento */
.dl-bento { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-template-rows: auto auto; gap: 10px; margin: 0 0 20px; }
.dl-person-devices { margin-bottom: 16px; }
.dl-person-head { display: flex; flex-direction: column; margin: 0 0 20px; }
.dl-person-head > .dl-pagehead { margin-bottom: 0; align-items: flex-start; }
.dl-pnote { all: unset; box-sizing: border-box; cursor: pointer; align-self: flex-start; display: inline-flex; align-items: flex-start; gap: 6px; margin: 10px 0 0 62px;
  max-width: 60ch; padding: 6px 12px 6px 10px; border-radius: 10px; font-size: 13px; line-height: 18px; white-space: pre-line;
  background: var(--dl-soft); color: var(--dl-fg); box-shadow: inset 0 0 0 1px var(--dl-line); }
.dl-pnote:hover { background: var(--dl-soft-hover); }
.dl-pnote .dl-icon { width: 14px; height: 14px; flex: none; margin-top: 2px; color: var(--dl-fg-muted); }
.dl-note-input { width: 100%; box-sizing: border-box; min-height: 80px; resize: vertical; }
.dl-dcard-trend { display: flex; align-items: flex-end; gap: 12px; min-width: 0; }
.dl-dcard-trend > .dl-stack { flex: none; }
.dl-dcard-trend b { font-size: 16px; font-weight: 500; font-variant-numeric: tabular-nums; }
.dl-dbars { flex: 1; min-width: 0; height: 32px; display: flex; align-items: flex-end; gap: 2px; }
.dl-dbars i { flex: 1; min-width: 0; border-radius: 2px; background: var(--dl-chart-1); opacity: .55; }
.dl-dbars i.zero { background: var(--dl-track); opacity: 1; }
.dl-dbars i.hi { opacity: 1; }
.dl-dbars i:hover { opacity: 1; filter: brightness(1.2); }
.dl-datechip { position: relative; display: inline-flex; }
.dl-date-hidden { position: absolute !important; left: 0; bottom: 0; width: 1px !important; min-width: 0 !important; height: 1px !important; opacity: 0; pointer-events: none; border: 0 !important; padding: 0 !important; margin: 0 !important; }
.dl-chipbtn .dl-icon { width: 13px; height: 13px; }
.dl-chipbtn:has(.dl-icon) { display: inline-flex; align-items: center; gap: 5px; }
.dl-places { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border: 1px solid var(--dl-line); border-radius: var(--dl-radius); background: var(--dl-card); font-size: 14px; }
.dl-places > .dl-icon { width: 18px; height: 18px; color: var(--dl-fg-muted); flex: none; }
.dl-person-live { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
.dl-person-live .dl-bento-head { flex-wrap: nowrap; white-space: nowrap; min-width: 0; }
.dl-person-live .dl-bento-head > * { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.dl-person-live .dl-bento-head > :first-child { flex: none; }
.dl-person-live.solo { grid-template-columns: minmax(0, 1fr); }
.dl-person-live:not(.solo) .dl-bento-tile.month > .dl-bento-head:first-child { flex-wrap: wrap; row-gap: 2px; }
.dl-person-live:not(.solo) .dl-bento-tile.month > .dl-bento-head:first-child > .dl-sub { flex-basis: 100%; }
.dl-person-live > .dl-bento-tile, .dl-person-live > .dl-bento-tile.month { grid-column: auto; grid-row: auto; }
@media (max-width: 760px) { .dl-person-live { grid-template-columns: minmax(0, 1fr); } }
.dl-bento-tile { background: var(--dl-card); border: 1px solid var(--dl-line); border-radius: var(--dl-radius); padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; min-width: 0; box-shadow: var(--dl-shadow); }
.dl-bento-tile.month { grid-column: 1 / -1; }
/* Online: only live connections, as avatars */
.dl-onl-count { font-size: 13px; line-height: 22px; min-width: 22px; padding: 0 8px; border-radius: 999px; background: var(--dl-soft); text-align: center; font-weight: 500; font-variant-numeric: tabular-nums; }
.dl-onl-count.none { color: var(--dl-fg-faint); }
.dl-onl-row { flex: 1; display: flex; align-items: center; justify-content: center; gap: 12px; min-width: 0; }
.dl-onl-p { display: flex; flex-direction: column; align-items: center; gap: 5px; width: 104px; min-width: 0; padding: 6px 2px; border-radius: 12px; color: var(--dl-fg) !important; text-decoration: none !important; }
.dl-onl-p:hover { background: var(--dl-soft); }
.dl-onl-av { position: relative; width: 42px; height: 42px; border-radius: 50%; background: var(--dl-soft); display: inline-flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 500; box-shadow: 0 0 0 2px var(--dl-ok); }
.dl-onl-p.more .dl-onl-av { box-shadow: 0 0 0 1px var(--dl-line); color: var(--dl-fg-muted); }
.dl-onl-dev { position: absolute; right: -5px; bottom: -5px; width: 20px; height: 20px; border-radius: 7px; background: var(--dl-card); box-shadow: 0 0 0 1.5px var(--dl-card);
  display: inline-flex; align-items: center; justify-content: center; font-size: 10px; color: var(--dl-fg-muted); }
.dl-onl-dev .dl-icon-wrap { display: inline-flex; } .dl-onl-dev .dl-icon { width: 12px; height: 12px; }
.dl-onl-name { font-size: 12.5px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dl-onl-p .dl-sub { font-size: 11px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dl-onl-row.grid { flex-wrap: wrap; align-content: center; gap: 10px 8px; max-height: 108px; overflow: hidden; }
.dl-onl-p.sm { width: auto; padding: 4px; }
.dl-onl-p.sm .dl-onl-av { width: 36px; height: 36px; font-size: 11.5px; }
.dl-onl-meta { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; color: var(--dl-fg-faint); max-width: 100%; white-space: nowrap; overflow: hidden; }
.dl-onl-meta .dl-icon-wrap { display: inline-flex; } .dl-onl-meta .dl-icon { width: 12px; height: 12px; }
.dl-onl-av.sm { width: 34px; height: 34px; font-size: 11.5px; }
/* Hover card for a person online */
.dl-tip-float:has(.dl-hc) { padding: 0; white-space: normal; border-radius: 16px; }
.dl-hc { width: 280px; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.dl-hc-head { display: flex; align-items: center; gap: 10px; }
.dl-hc-head .dl-stack { flex: 1; min-width: 0; } .dl-hc-head b { font-size: 14px; font-weight: 500; }
.dl-hc-since { font-size: 11.5px; color: var(--dl-ok); }
.dl-hc-reach { display: inline-flex; gap: 4px; }
.dl-hc-speed { border-radius: 12px; background: var(--dl-soft); padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.dl-hc-speed-row { display: flex; align-items: baseline; gap: 12px; font-size: 13px; font-variant-numeric: tabular-nums; }
.dl-hc-chart { display: block; width: 100%; height: 30px; }
.dl-hc-chart .area { fill: color-mix(in srgb, var(--dl-chart-1) 16%, transparent); }
.dl-hc-chart .dn { fill: none; stroke: var(--dl-chart-1); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.dl-hc-chart .up { fill: none; stroke: var(--dl-ok); stroke-width: 1.2; vector-effect: non-scaling-stroke; }
.dl-hc-devs { display: flex; flex-wrap: wrap; gap: 6px; }
.dl-hc-dev { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 9px; border-radius: 999px; background: var(--dl-soft); font-size: 11.5px; }
.dl-hc-dev .dl-icon-wrap { display: inline-flex; } .dl-hc-dev .dl-icon { width: 12px; height: 12px; color: var(--dl-fg-muted); }
.dl-hc-foot { display: flex; align-items: center; gap: 8px; font-size: 11.5px; }
/* Disguise tile */
.dl-disg-id { display: flex; align-items: center; gap: 10px; }
.dl-disg-id b { font-size: 16px; font-weight: 500; }
.dl-disg-ic { width: 36px; height: 36px; border-radius: 11px; background: color-mix(in srgb, var(--dl-accent) 14%, transparent); color: var(--dl-accent);
  display: inline-flex; align-items: center; justify-content: center; flex: none; }
.dl-disg-ic .dl-icon-wrap { display: inline-flex; } .dl-disg-ic .dl-icon { width: 18px; height: 18px; }
.dl-disg-meters { display: grid; grid-template-columns: auto 1fr; gap: 6px 10px; align-items: center; font-size: 12px; color: var(--dl-fg-muted); }
.dl-segs { display: inline-flex; gap: 3px; } .dl-segs i { width: 18px; height: 5px; border-radius: 3px; background: var(--dl-track); }
.dl-segs.acc i.on { background: var(--dl-accent); } .dl-segs.ok i.on { background: var(--dl-ok); }
.dl-disg-chips { margin-top: auto; display: flex; flex-wrap: wrap; gap: 5px; }
.dl-disg-chips span { font: 11px/20px var(--dl-mono); padding: 0 8px; border-radius: 999px; background: var(--dl-soft); color: var(--dl-fg-muted); white-space: nowrap; }
.dl-onl-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; font-size: 13px; text-align: center; }
.dl-bento-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; }
.dl-bento-head.start { justify-content: flex-start; }
.dl-bento-big { font-family: inherit; font-size: 28px; line-height: 34px; font-weight: 500; letter-spacing: -.01em; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dl-bento-big small { font-size: 13px; font-weight: 400; color: var(--dl-fg-faint); letter-spacing: 0; }
.dl-avstack { display: inline-flex; }
.dl-avstack .dl-avatar { margin-left: -7px; box-shadow: 0 0 0 2px var(--dl-card); }
.dl-avstack .dl-avatar:first-child { margin-left: 0; }
.dl-avatar.more { background: var(--dl-soft); color: var(--dl-fg-muted); }
.dl-bento-list { display: flex; flex-direction: column; gap: 2px; }
.dl-bento-row { display: flex; align-items: center; gap: 10px; padding: 8px; margin: 0 -8px; border-radius: 10px; color: var(--dl-fg) !important;
  text-decoration: none !important; min-width: 0; transition: background .12s; }
.dl-bento-row:hover { background: var(--dl-soft); }
.dl-bento-row:hover b { text-decoration: none; }
.dl-bento-row:focus-visible { outline: 2px solid var(--dl-ring); outline-offset: -2px; }
.dl-bento-row-main { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
.dl-bento-row-main b { font-weight: 500; font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dl-bento-row-main .dl-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dl-bento-row.off b { color: var(--dl-fg-muted); font-weight: 400; }
.dl-bento-row-val { display: flex; flex-direction: column; align-items: flex-end; font-size: 13px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.dl-bento-row-val small { font-size: 11px; color: var(--dl-fg-faint); }
.dl-bento-sep { font-size: 11px; color: var(--dl-fg-faint); padding: 12px 0 4px; }
.dl-bento-devs { display: inline-flex; gap: 3px; color: var(--dl-fg-faint); }
.dl-bento-devs .dl-icon { width: 13px; height: 13px; }
.dl-bento-devs .on { color: var(--dl-ok); }
.dl-bento-foot { display: flex; align-items: center; gap: 10px; margin-top: auto; padding-top: 10px; border-top: 1px solid var(--dl-line); color: var(--dl-fg) !important; text-decoration: none !important; }
.dl-bento-foot.split { justify-content: space-between; }
.dl-bento-foot.end { justify-content: space-between; }
.dl-bento-foot.end > a:only-child { margin-left: auto; }
.dl-bento-empty { display: flex; align-items: center; gap: 10px; padding: 14px 0; font-size: 13.5px; color: var(--dl-fg-muted); }
.dl-bento-empty .dl-icon { width: 18px; height: 18px; }
.dl-split { display: flex; height: 6px; border-radius: 3px; overflow: hidden; background: var(--dl-soft); }
.dl-split i { display: block; height: 100%; }
.dl-split i.dn { background: var(--dl-accent); } .dl-split i.up { background: var(--dl-ok); }
.dl-dn { color: var(--dl-accent); } .dl-up { color: var(--dl-ok); }
.dl-bento-method { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 500; }
.dl-bento-method .dl-icon { width: 20px; height: 20px; color: var(--dl-accent); }
.dl-meter { display: inline-flex; gap: 3px; }
.dl-meter i { width: 16px; height: 4px; border-radius: 2px; background: var(--dl-line); }
.dl-meter i.on { background: var(--dl-accent); }
.dl-bento-total { font-size: 16px; font-weight: 500; margin-left: 8px; }
.dl-bento-bars { display: flex; align-items: flex-end; gap: 3px; height: 54px; }
.dl-bento-bars i { flex: 1; min-width: 0; border-radius: 3px 3px 0 0; background: var(--dl-soft-hover); transition: background .15s; }
.dl-bento-bars i.future { height: 4px; background: var(--dl-soft); }
.dl-bento-bars i:hover { background: var(--dl-fg-faint); }
.dl-bento-bars i.hi { background: var(--dl-accent); }
@media (max-width: 700px) { .dl-addrbar { flex-wrap: wrap; } }
@media (max-width: 900px) { .dl-bento { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .dl-bento-tile.online { grid-column: span 2; } }
@media (max-width: 560px) { .dl-bento { grid-template-columns: minmax(0, 1fr); } .dl-bento-tile.online, .dl-bento-tile.month { grid-column: auto; } }
.dl-srvpagehead { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; margin: 0 0 20px; }
.dl-srvpagehead > .dl-title-row { display: flex; align-items: center; gap: 10px; width: 100%; flex-wrap: wrap; }
.dl-srvpagehead .dl-actions { margin: 0; flex-wrap: wrap; }
.dl-toolbar-end { display: flex; align-items: center; gap: 8px; margin-left: auto; flex-wrap: nowrap; min-width: 0; }
@media (max-width: 640px) { .dl-toolbar-end { flex-wrap: wrap; width: 100%; } }
.dl-healthstrip { display: flex; align-items: center; gap: 8px 16px; flex-wrap: wrap; padding: 9px 14px; margin: 0 0 12px; border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--dl-warn) 45%, transparent); background: var(--dl-warn-wash); font-size: 13px; color: var(--dl-fg-muted); }
.dl-healthstrip.bad { border-color: color-mix(in srgb, var(--dl-bad) 45%, transparent); background: var(--dl-bad-wash); }
.dl-healthstrip-title { display: inline-flex; align-items: center; gap: 6px; font-weight: 500; color: var(--dl-warn); }
.dl-healthstrip.bad .dl-healthstrip-title { color: var(--dl-bad); }
.dl-healthstrip-title .dl-icon { width: 15px; height: 15px; }
.dl-healthstrip-item { cursor: default; }
.dl-healthstrip a { margin-left: auto; font-size: 12px; font-weight: 500; color: var(--dl-fg); text-decoration: none; padding: 3px 9px; border-radius: 8px; }
.dl-healthstrip a:hover { background: var(--dl-soft); }
.dl-speed-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.dl-speed-col { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dl-speed-val { font-size: 20px; line-height: 26px; font-weight: 500; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dl-speed-today { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; color: var(--dl-fg-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.dl-speed-today b { font-weight: 500; color: var(--dl-fg); }
.dl-speed-chart { display: block; width: 100%; height: 44px; }
.dl-speed-chart .area { fill: color-mix(in srgb, var(--dl-accent) 16%, transparent); }
.dl-speed-chart .line { fill: none; stroke: var(--dl-accent); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.dl-speed-chart .line.up { stroke: var(--dl-ok); stroke-width: 1.2; opacity: .85; }
.dl-speed-wait { height: 44px; display: flex; flex-direction: column; justify-content: flex-end; gap: 6px; font-size: 11px; color: var(--dl-fg-faint); }
.dl-speed-wait i { display: block; height: 1px; background: var(--dl-line); order: 2; }
.dl-fld { display: flex; flex-direction: column; gap: 8px; margin: 0 0 16px; }
.dl-fld-label { font-size: 13px; font-weight: 500; color: var(--dl-fg); }
.dl-fld .cbi-input-text { width: 100%; box-sizing: border-box; }
.dl-kinds { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; }
.dl-kinds button { all: unset; box-sizing: border-box; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  height: 68px; border-radius: 10px; border: 1px solid var(--dl-line); color: var(--dl-fg-muted); font-size: 12px; font-weight: 500; text-align: center; min-width: 0; }
.dl-kinds button .dl-icon { width: 20px; height: 20px; }
.dl-kinds button:hover { background: var(--dl-soft); color: var(--dl-fg); }
.dl-kinds button:focus-visible { outline: 2px solid var(--dl-ring); outline-offset: 2px; }
.dl-kinds button.on { border-color: var(--dl-accent); color: var(--dl-fg); background: color-mix(in srgb, var(--dl-accent) 10%, transparent); box-shadow: inset 0 0 0 1px var(--dl-accent); }
.dl-kinds button.on .dl-icon { color: var(--dl-accent); }
.dl-choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 8px; }
.dl-choice { all: unset; box-sizing: border-box; cursor: pointer; display: flex; flex-direction: column; gap: 4px; padding: 12px 14px;
  border-radius: 12px; background: var(--dl-card); box-shadow: inset 0 0 0 1px var(--dl-line); transition: background .15s, box-shadow .15s; }
.dl-choice:hover { background: var(--dl-soft); }
.dl-choice:focus-visible { outline: 2px solid var(--dl-ring); outline-offset: 2px; }
.dl-choice.selected { box-shadow: inset 0 0 0 2px var(--dl-accent); background: var(--accent-a10, color-mix(in srgb, var(--dl-accent) 8%, transparent)); }
.dl-choice-title { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 500; color: var(--dl-fg); }
.dl-choice-text { font-size: 12px; line-height: 16px; color: var(--dl-fg-muted); }

/* wizard steps */
.dl-steps { display: flex; align-items: center; gap: 8px; margin: 0 0 16px; flex-wrap: wrap; }
.dl-step { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 500; color: var(--dl-fg-faint); }
.dl-step b { display: inline-flex; width: 24px; height: 24px; align-items: center; justify-content: center; border-radius: 50%;
  background: var(--dl-soft); font-size: 12px; font-weight: 600; }
.dl-step.current { color: var(--dl-fg); } .dl-step.current b { background: var(--dl-primary); color: var(--dl-primary-fg); }
.dl-step.done { color: var(--dl-fg-muted); } .dl-step.done b { background: var(--dl-ok-wash); color: var(--dl-ok); }
.dl-step + .dl-step::before { content: ''; width: 24px; height: 1px; background: var(--dl-line); }
/* Each step's content: intro, fields and choices with even spacing. */
.dl-wizard .dl-panel > div { display: flex; flex-direction: column; gap: 16px; }
.dl-wizard .dl-panel > div > p { margin: 0 !important; color: var(--dl-fg-muted); }
.dl-wizard .dl-panel > div > .cbi-value { margin: 0; }
.dl-wizard h4 { font-size: 14px; font-weight: 500; margin: 8px 0 -6px !important; }
.dl-wizard h4:first-child { margin-top: 0 !important; }

/* dialogs */
.dl-modal .cbi-tabmenu { margin-bottom: 16px; }
.dl-invite { display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 22px; align-items: start; }
.dl-invite img { display: block; width: 100%; border-radius: 18px; box-shadow: 0 0 0 1px var(--dl-line); }
.dl-invite-side { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.dl-invite-side > p { margin: 0 !important; }
.dl-invite-link { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 10px; min-width: 0;
  padding: 11px 14px; border-radius: 12px; background: var(--dl-soft); font: 13px/18px var(--dl-mono); color: var(--dl-fg); }
.dl-invite-link > span:first-child { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dl-invite-link > .dl-icon-wrap { flex: none; display: inline-flex; }
.dl-invite-link .dl-icon { width: 15px; height: 15px; color: var(--dl-fg-muted); flex: none; }
.dl-invite-link:hover { background: var(--dl-soft-hover); }
.dl-invite-link.alt { padding: 8px 14px; font-size: 12px; color: var(--dl-fg-muted); }
.dl-invite-link > .dl-pill { flex: none; }
.dl-invite-steps { margin: 0; padding-left: 20px; list-style: decimal !important; font-size: 13px; line-height: 24px; color: var(--dl-fg-muted); }
.dl-invite-steps b { color: var(--dl-fg); font-weight: 500; }
.dl-invite-steps li { display: list-item !important; list-style: inherit !important; padding-left: 4px; }
.dl-invite-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.modal:has(.dl-modal.wide) { max-width: min(760px, 94vw) !important; width: 100% !important; }
@media (max-width: 640px) { .dl-invite { grid-template-columns: minmax(0, 1fr); } .dl-invite img { max-width: 260px; margin: 0 auto; } }
.dl-toasts { position: fixed; left: 50%; bottom: max(24px, env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 100000;
  display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none; }
.dl-toast { pointer-events: auto; display: inline-flex; align-items: center; gap: 8px; max-width: min(520px, 92vw); padding: 10px 16px; border-radius: 999px;
  background: var(--dl-fg); color: var(--dl-card); font-size: 13px; line-height: 18px; box-shadow: 0 10px 30px rgba(0, 0, 0, .3);
  opacity: 0; transform: translateY(12px); transition: opacity .18s, transform .18s; }
.dl-toast.show { opacity: 1; transform: none; }
.dl-toast .dl-icon-wrap { display: inline-flex; } .dl-toast .dl-icon { width: 15px; height: 15px; }
.dl-toast.success .dl-icon { color: var(--dl-ok); }
.dl-toast.error { background: var(--dl-bad); color: #fff; } .dl-toast.error .dl-icon { color: #fff; }
.dl-toast.warning { background: var(--dl-warn); color: #111; } .dl-toast.warning .dl-icon { color: #111; }
.dl-toast button { all: unset; cursor: pointer; display: inline-flex; margin-left: 4px; opacity: .8; } .dl-toast button:hover { opacity: 1; }
/* Settings: portal address picker, link preview, readiness */
.dl-setblock { display: flex; flex-direction: column; gap: 8px; margin: 0; }
.dl-addr-opts { display: flex; flex-direction: column; gap: 6px; }
.dl-addr-opt { all: unset; box-sizing: border-box; cursor: pointer; display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; gap: 12px; align-items: center;
  padding: 10px 14px; border-radius: 12px; box-shadow: inset 0 0 0 1px var(--dl-line); min-width: 0; }
.dl-addr-opt:hover { background: var(--dl-soft); }
.dl-addr-opt.on { box-shadow: inset 0 0 0 1.5px var(--dl-accent); background: color-mix(in srgb, var(--dl-accent) 7%, transparent); }
.dl-addr-opt .dl-mono { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dl-addr-opt .dl-stack { min-width: 0; }
.dl-addr-opt input { width: 100%; }
.dl-addr-opt.other { cursor: default; } .dl-addr-opt.other:hover { background: none; }
.dl-addr-opt.other input { width: 100%; }
.dl-addr-check { width: 16px; height: 16px; border-radius: 5px; box-shadow: inset 0 0 0 1.5px var(--dl-fg-faint); display: inline-flex; align-items: center; justify-content: center; }
.dl-addr-check .dl-icon-wrap { display: inline-flex; } .dl-addr-check .dl-icon { width: 12px; height: 12px; }
.dl-addr-opt.on .dl-addr-check { background: var(--dl-accent); box-shadow: none; color: #fff; }
.dl-addr-opt.other .dl-addr-check { box-shadow: none; color: var(--dl-fg-muted); }
.dl-addr-warn { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; line-height: 17px; color: var(--dl-warn); }
.dl-addr-warn .dl-icon-wrap { display: inline-flex; } .dl-addr-warn .dl-icon { width: 13px; height: 13px; }
.dl-pill.info { background: color-mix(in srgb, var(--dl-accent) 14%, transparent); color: var(--dl-accent); }
.dl-links { border-radius: 12px; background: var(--dl-soft); overflow: hidden; }
.dl-link-row { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 11px 14px; }
.dl-link-row + .dl-link-row { border-top: 1px solid var(--dl-line); }
.dl-link-ic { display: inline-flex; } .dl-link-ic .dl-icon { width: 15px; height: 15px; }
.dl-link-ic.ok .dl-icon { color: var(--dl-ok); } .dl-link-ic.warn .dl-icon { color: var(--dl-warn); }
.dl-link-url { font-size: 13px; color: var(--dl-fg-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dl-link-url b { font-weight: 500; color: var(--dl-accent); }
/* Phones: show the whole link, wrapped, instead of cutting it */
@media (max-width: 640px) { .dl-link-url, .dl-addr-opt .dl-mono, .dl-filecard .dl-ellipsis, .dl-invite-link > span:first-child { white-space: normal; overflow-wrap: anywhere; } }
.dl-ready-sum { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 12px; }
.dl-ready-sum > .dl-icon-wrap { display: inline-flex; } .dl-ready-sum > .dl-icon-wrap .dl-icon { width: 18px; height: 18px; }
.dl-ready-sum .dl-stack { flex: 1; min-width: 0; } .dl-ready-sum b { font-weight: 500; font-size: 13px; }
.dl-ready-sum.ok { background: var(--dl-ok-wash); } .dl-ready-sum.ok b, .dl-ready-sum.ok .dl-icon { color: var(--dl-ok); }
.dl-ready-sum.warn { background: var(--dl-warn-wash); } .dl-ready-sum.warn b, .dl-ready-sum.warn .dl-icon { color: var(--dl-warn); }
.dl-ready-sum.error { background: var(--dl-bad-wash); } .dl-ready-sum.error b, .dl-ready-sum.error .dl-icon { color: var(--dl-bad); }
.dl-check-chip { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 10px; border-radius: 999px; background: var(--dl-soft); font-size: 12px; color: var(--dl-fg-muted); }
.dl-check-chip .dl-icon-wrap { display: inline-flex; } .dl-check-chip .dl-icon { width: 13px; height: 13px; color: var(--dl-ok); }
.dl-check-chip.warn { background: var(--dl-warn-wash); color: var(--dl-warn); } .dl-check-chip.warn .dl-icon { color: var(--dl-warn); }
.dl-check-chip.error { background: var(--dl-bad-wash); color: var(--dl-bad); } .dl-check-chip.error .dl-icon { color: var(--dl-bad); }
.dl-ready-details { display: flex; flex-direction: column; gap: 8px; padding: 4px 2px; }
.dl-ready-details[hidden] { display: none; }
.dl-ready-item { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; line-height: 18px; min-width: 0; }
.dl-ready-item .dl-icon-wrap { display: inline-flex; margin-top: 1px; } .dl-ready-item .dl-icon { width: 15px; height: 15px; }
.dl-ready-item.ok .dl-icon { color: var(--dl-ok); } .dl-ready-item.warn .dl-icon { color: var(--dl-warn); } .dl-ready-item.error .dl-icon { color: var(--dl-bad); }
.dl-params-body { display: flex; flex-direction: column; gap: 14px; padding: 6px 14px 14px; }
.dl-params-body > .dl-setrow { margin: 0; padding: 0; }
.dl-pgrid.flush { padding: 0; grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (max-width: 640px) { .dl-pgrid.flush { grid-template-columns: minmax(0, 1fr); } }
.dl-qr-pane { display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; }
.dl-qr { width: min(280px, 72vw); aspect-ratio: 1; background: #fff; padding: 8px; border-radius: 12px; box-shadow: inset 0 0 0 1px var(--dl-line); }
.dl-qr svg { display: block; width: 100%; height: 100%; }
.dl-filecard { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 14px; background: var(--dl-soft); min-width: 0; }
.dl-filecard > .dl-stack { flex: 1; min-width: 0; }
.dl-filecard-ic { width: 40px; height: 46px; border-radius: 8px; flex: none; display: inline-flex; align-items: center; justify-content: center;
  font: 10px var(--dl-mono); color: var(--dl-fg-muted); background: var(--dl-card); box-shadow: inset 0 0 0 1px var(--dl-line); }
.dl-params > .dl-conf { margin: 0; border-top: 1px solid var(--dl-line); border-radius: 0 0 12px 12px; background: none; }
.dl-conf-sec { color: var(--dl-accent); }
.dl-conf-k { color: var(--dl-fg-faint); }
.dl-conf-mask { padding: 0 6px; border-radius: 4px; background: var(--dl-soft); color: var(--dl-fg-muted); }
.dl-params > summary .dl-chipbtn { height: 26px; font-size: 12px; }
.dl-conf { white-space: pre-wrap; word-break: break-all; max-height: 22em; overflow: auto; font-family: var(--dl-mono); font-size: 12px;
  line-height: 18px; margin: 0; padding: 12px; border-radius: 12px; background: var(--dl-soft); }
.dl-key { width: 100%; box-sizing: border-box; font-family: var(--dl-mono); font-size: 12px; word-break: break-all; min-height: 7em; }
.dl-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 12px 0 0; }
.dl-link-box { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.dl-link-box input { flex: 1 1 18em; min-width: 0; font-family: var(--dl-mono); font-size: 12px; }
.dl-hint { font-size: 12px; line-height: 16px; color: var(--dl-fg-muted); margin: 8px 0; }
.dl-divider { border: 0; border-top: 1px solid var(--dl-line); margin: 16px 0; }

/* health */
.dl-checks { list-style: none; margin: 0; padding: 0; }
.dl-checks li { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid var(--dl-line); }
.dl-checks li:first-child { border-top: 0; padding-top: 0; }
.dl-checks li:last-child { padding-bottom: 0; }
.dl-check-icon { flex: 0 0 auto; width: 28px; height: 28px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; }
.dl-check-icon .dl-icon { width: 14px; height: 14px; }
.dl-check-icon.ok { background: var(--dl-ok-wash); color: var(--dl-ok); }
.dl-check-icon.warn { background: var(--dl-warn-wash); color: var(--dl-warn); }
.dl-check-icon.error { background: var(--dl-bad-wash); color: var(--dl-bad); }
.dl-check-icon.skip { background: var(--dl-soft); color: var(--dl-fg-faint); }
.dl-check-body { flex: 1; min-width: 0; }
.dl-check-title { font-size: 14px; line-height: 20px; font-weight: 500; }
.dl-check-detail { font-size: 12px; line-height: 16px; color: var(--dl-fg-muted); overflow-wrap: anywhere; }
.dl-check-repaired { margin-top: 2px; font-size: 12px; line-height: 16px; color: var(--dl-warn); }

/* Health: watchdog card, then checks and the service log side by side. */
.dl-wd { margin: 0 0 16px; display: flex; flex-direction: column; gap: 14px; }
.dl-wd-head { display: flex; align-items: center; gap: 12px; min-width: 0; }
.dl-wd-head > .dl-stack { min-width: 0; }
.dl-wd-title { font-size: 16px; line-height: 24px; font-weight: 500; }
.dl-wd-tile { flex: none; width: 36px; height: 36px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; background: var(--dl-ok-wash); color: var(--dl-ok); }
.dl-wd-tile.off { background: var(--dl-soft); color: var(--dl-fg-faint); }
.dl-wd-tile .dl-icon { width: 18px; height: 18px; }
.dl-wd-foot { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 16px; padding-top: 14px; border-top: 1px solid var(--dl-line); }
.dl-wd-chips { display: flex; flex-wrap: wrap; gap: 6px; flex: 1 1 auto; min-width: 0; }
.dl-wd-chips .dl-check-chip.error .dl-icon { color: var(--dl-bad); }
.dl-warn-text { color: var(--dl-warn) !important; }
.dl-health-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(440px, 100%), 1fr)); gap: 16px; align-items: start; }
.dl-health-cols > .dl-panel { margin: 0; min-width: 0; }
.dl-recent { display: flex; flex-direction: column; }
.dl-recent .dl-panel-head a { font-size: 13px; }
.dl-recent-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 32px 16px; color: var(--dl-fg-muted); font-size: 13px; border-top: 1px solid var(--dl-line); }
.dl-loading { margin: 0; font-size: 13px; }
.dl-diag-tabs { margin: 0 0 16px; }
.dl-row.dl-slog-row { align-items: baseline; }
.dl-slog-row .dl-ev-tile { align-self: flex-start; margin-top: -1px; }
.dl-slog-row.has-detail { cursor: pointer; }
.dl-row.dl-slog-row.has-detail:hover { background: color-mix(in srgb, var(--sys) 11%, transparent); }
.dl-slog-more { display: inline-flex; vertical-align: -2px; margin-left: 6px; color: var(--dl-fg-faint); transform: rotate(90deg); transition: transform .15s; }
.dl-slog-more .dl-icon { width: 14px; height: 14px; }
.dl-slog-more.open { transform: rotate(-90deg); }
.dl-slog-detail { margin: 8px 0 2px; padding: 8px 10px; border-radius: 8px; background: var(--dl-soft); font-family: var(--dl-mono); font-size: 12px; line-height: 17px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--dl-fg-muted); cursor: text; }
}

/* tables inside panels */
.dl-table { width: 100%; border-collapse: collapse; font-size: 14px; line-height: 20px; }
.dl-table th { text-align: left; font-weight: 500; color: var(--dl-fg-faint); padding: 0 8px 8px; border-bottom: 1px solid var(--dl-line); }
.dl-table td { padding: 10px 8px; border-bottom: 1px solid var(--dl-line); vertical-align: middle; }
.dl-table th:first-child, .dl-table td:first-child { padding-left: 0; }
.dl-table th:last-child, .dl-table td:last-child { padding-right: 0; }
.dl-table tr:last-child td { border-bottom: 0; }
.dl-table .dl-right { text-align: right; white-space: nowrap; }
.dl-log { max-height: 18em; overflow: auto; font-family: var(--dl-mono); font-size: 12px; line-height: 18px; margin: 8px 0 0; padding: 12px;
  white-space: pre-wrap; border-radius: 12px; background: var(--dl-soft); }
/* ===== page structure ===== */
.dl-pagehead { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin: 0 0 20px; }
.dl-h1 { margin: 0 !important; padding: 0 !important; font-size: 24px !important; line-height: 32px !important; font-weight: 500 !important; border: 0 !important; }
.dl-title-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dl-stack { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dl-stack.gap4 { gap: 4px; } .dl-stack.gap8 { gap: 8px; }
.dl-sub { font-size: 12px; line-height: 16px; color: var(--dl-fg-muted); }
.dl-ok { color: var(--dl-ok); } .dl-warn { color: var(--dl-warn); } .dl-bad { color: var(--dl-bad); }
/* Icon-only buttons are circles: width follows the theme's button height. */
.dl-icon-only { width: auto !important; min-width: 0 !important; aspect-ratio: 1 / 1; padding: 0 !important; justify-content: center; display: inline-flex !important; align-items: center; border-radius: 999px !important; }
.dl-panel.flush { padding: 0; overflow: hidden; }
.dl-panel-head.pad { padding: 16px 16px 12px; margin: 0; }
.dl-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.dl-col > .dl-panel, .dl-col > section.dl-panel { margin: 0; }
.dl-crumbs { display: flex; gap: 8px; align-items: center; font-size: 14px; margin: 0 0 16px; color: var(--dl-fg-faint); }
.dl-crumbs a { color: var(--dl-fg-faint); } .dl-crumbs a:hover { color: var(--dl-fg); }
.dl-crumbs span:last-child { color: var(--dl-fg); }

/* metrics strip */
.dl-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); background: var(--dl-card); border: 1px solid var(--dl-line);
  border-radius: var(--dl-radius); margin: 0 0 16px; box-shadow: var(--dl-shadow); }
.dl-metric { display: flex; flex-direction: column; gap: 4px; padding: 16px 20px; min-width: 0; }
.dl-metric + .dl-metric { border-left: 1px solid var(--dl-line); }
.dl-metric-label { font-size: 12px; font-weight: 500; color: var(--dl-fg-faint); }
.dl-metric-value { font-size: 28px; line-height: 36px; font-weight: 500; letter-spacing: -.01em; font-variant-numeric: tabular-nums; white-space: nowrap; }
.dl-metric-value .dl-faint { font-size: 16px; }
.dl-metric-sub { font-size: 12px; color: var(--dl-fg-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 900px) { .dl-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dl-metric:nth-child(3) { border-left: 0; } .dl-metric:nth-child(n+3) { border-top: 1px solid var(--dl-line); } }

/* segmented control */
.dl-seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px; background: var(--dl-soft); flex-wrap: wrap; }
.dl-seg button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px;
  font-size: 13px; font-weight: 500; color: var(--dl-fg-muted); white-space: nowrap; }
.dl-seg button:hover { color: var(--dl-fg); }
.dl-seg button.on { background: var(--dl-soft-hover); color: var(--dl-fg); }
/* Server sections: one row that scrolls sideways on narrow screens */
.dl-seg.dl-srvsections { flex-wrap: nowrap; max-width: 100%; overflow-x: auto; scrollbar-width: none; }
.dl-seg.dl-srvsections::-webkit-scrollbar { display: none; }
.dl-seg.dl-srvsections button { flex: none; white-space: nowrap; }
.dl-seg button:focus-visible { outline: 2px solid var(--dl-ring); }
.dl-seg button b { font-weight: 500; font-size: 11px; padding: 0 6px; border-radius: 999px; background: var(--dl-soft); }
.dl-seg button b.warn { background: var(--dl-warn-wash); color: var(--dl-warn); }
.dl-seg.sm button { padding: 2px 9px; font-size: 11px; }
.dl-seg.wide { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-radius: 12px; padding: 4px; }
.dl-seg.wide button { flex-direction: column; justify-content: center; padding: 8px 6px; border-radius: 9px; gap: 3px; }
.dl-seg.wide button.on { background: var(--dl-primary); color: var(--dl-primary-fg); }

/* map */
.dl-geomap { position: relative; border-top: 1px solid var(--dl-line); background: var(--dl-soft); }
.dl-map-status { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--dl-fg-muted); font-size: 13px; z-index: 1; pointer-events: none; }
.dl-map-wrap { position: relative; }
.dl-map-legend { position: absolute; left: 12px; bottom: 12px; display: flex; gap: 12px; align-items: center; padding: 6px 12px; border-radius: 999px; font-size: 12px;
  background: color-mix(in srgb, var(--dl-card) 88%, transparent); border: 1px solid var(--dl-line); backdrop-filter: blur(6px); z-index: 2; }
.dl-map-legend span { display: inline-flex; align-items: center; gap: 6px; color: var(--dl-fg-muted); }
.dl-map-legend i.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dl-fg-faint); }
.dl-map-legend i.dot.ok { background: var(--dl-ok); }
.dl-map-legend i.line { width: 14px; height: 2px; border-radius: 2px; background: var(--dl-ok); }
.dl-map-off { padding: 32px 16px; text-align: center; color: var(--dl-fg-muted); border-top: 1px solid var(--dl-line); }
.dl-mk { all: unset; cursor: pointer; width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; position: relative; }
.dl-mk-dot { width: 12px; height: 12px; border-radius: 50%; background: #8f8f8f; box-shadow: 0 0 0 3px rgba(0,0,0,.55); }
.dl-mk.online .dl-mk-dot { width: 14px; height: 14px; background: #40c977; }
.dl-mk.online::before { content: ''; position: absolute; inset: -9px; border-radius: 50%; background: rgba(64, 201, 119, .28); animation: dl-pulse 2s ease-out infinite; }
@keyframes dl-pulse { 0% { transform: scale(.5); opacity: 1; } 100% { transform: scale(1.4); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .dl-mk.online::before { animation: none; } }
.dl-mk-home { width: 22px; height: 22px; border-radius: 7px; background: #ededed; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 0 0 4px rgba(237, 237, 237, .18), 0 2px 6px rgba(0,0,0,.5); color: #131313; }
.dl-mk-home-ic { width: 13px; height: 13px; }
.dl-popup { z-index: 4; }
.dl-popup .maplibregl-popup-content { background: var(--dl-elevated); color: var(--dl-fg); border: 1px solid var(--dl-line); border-radius: 12px; padding: 12px;
  box-shadow: var(--shadow-xl, 0 8px 16px -4px rgba(0,0,0,.4)); font: inherit; }
.dl-popup .maplibregl-popup-tip { border-top-color: var(--dl-elevated) !important; border-bottom-color: var(--dl-elevated) !important; }
.dl-pop { display: flex; flex-direction: column; gap: 4px; font-size: 12px; line-height: 18px; min-width: 210px; }
.dl-pop-head { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 2px; }
.dl-mk.multi { width: 26px; height: 26px; }
.dl-mk-count { min-width: 22px; height: 22px; padding: 0 6px; border-radius: 999px; background: #8f8f8f; color: #0a0a0a; font: 600 11px/22px var(--dl-mono);
  text-align: center; box-shadow: 0 0 0 3px rgba(0,0,0,.55); box-sizing: border-box; }
.dl-mk.online .dl-mk-count { background: #40c977; }
.dl-pop-net { width: 30px; height: 30px; border-radius: 9px; background: var(--dl-soft); display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; color: var(--dl-fg-muted); }
.dl-pop-list { display: flex; flex-direction: column; margin: 6px -4px 0; }
.dl-pop-row { all: unset; cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 5px 4px; border-radius: 6px; }
.dl-pop-row:hover { background: var(--dl-soft); }
.dl-pop-row:focus { outline: none; }
.dl-pop-row:focus-visible { outline: 2px solid var(--dl-ring); }
.dl-pop-name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dl-pop-name b { font-weight: 500; }
.dl-pop-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dl-fg-faint); flex: 0 0 auto; }
.dl-pop-dot.on { background: var(--dl-ok); box-shadow: 0 0 0 3px var(--dl-ok-wash); }
.dl-pop-actions { display: flex; gap: 6px; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--dl-line); }
.dl-pop-actions .cbi-button { flex: 1; height: 28px !important; font-size: 12px !important; justify-content: center; }
.maplibregl-ctrl-attrib { font-size: 10px; }

/* charts */
.dl-chartbox { position: relative; }
.dl-bars { display: flex; align-items: flex-end; gap: 4px; border-bottom: 1px solid var(--dl-line); }
.dl-bar { flex: 1; height: 100%; display: flex; flex-direction: column-reverse; gap: 1px; cursor: default; min-width: 3px; }
.dl-bar i { display: block; border-radius: 3px 3px 0 0; }
.dl-bar i.down { background: var(--dl-chart-1); }
.dl-bar i.up { background: var(--dl-chart-2); opacity: .75; border-radius: 3px 3px 0 0; }
.dl-bar:hover i { filter: brightness(1.25); }
.dl-bar.empty { background: linear-gradient(to top, var(--dl-line) 2px, transparent 2px); }
.dl-tip { position: absolute; top: -8px; transform: translate(-50%, -100%); padding: 8px 10px; border-radius: 10px; font-size: 12px; line-height: 18px; white-space: nowrap;
  background: var(--dl-elevated); border: 1px solid var(--dl-line); box-shadow: var(--shadow-xl, 0 8px 16px -4px rgba(0,0,0,.4)); pointer-events: none; z-index: 3; }
.dl-tip-title { font-weight: 500; }
.dl-tip-float { position: fixed; z-index: 2000; color: var(--dl-fg); }
.dl-spark i:hover { opacity: 1; filter: brightness(1.25); }
.dl-meter, .dl-slots { cursor: default; }
.dl-axis { display: flex; justify-content: space-between; font-size: 12px; color: var(--dl-fg-faint); margin-top: 6px; }
.dl-legend i.down { background: var(--dl-chart-1); } .dl-legend i.up { background: var(--dl-chart-2); }
.dl-spark { display: flex; align-items: flex-end; gap: 2px; flex: 0 0 auto; }
.dl-spark i { flex: 1; display: block; border-radius: 2px 2px 0 0; background: var(--dl-chart-1); opacity: .85; }
.dl-spark i.zero { opacity: .22; }

/* rows */
.dl-row { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-top: 1px solid var(--dl-line); font-size: 14px; line-height: 20px; min-width: 0; }
.dl-row.link { color: inherit; text-decoration: none; } .dl-row.link:hover { background: var(--dl-soft); }
.dl-row-main { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.dl-row-main b { font-weight: 500; }
.dl-attn { display: flex; flex-direction: column; gap: 10px; padding: 16px; border-top: 1px solid var(--dl-line); }
.dl-attn-item { display: flex; gap: 10px; align-items: baseline; font-size: 13px; color: var(--dl-fg-muted); }
.dl-avatar.sm { width: 26px; height: 26px; font-size: 10px; margin: 0; }
.dl-avatar.lg { width: 48px; height: 48px; font-size: 15px; margin: 0; }
.dl-avatar.lg.online::after { width: 12px; height: 12px; }
.dl-list { border: 1px solid var(--dl-line); border-radius: 12px; overflow: hidden; }
.dl-list > .dl-row:first-child { border-top: 0; }
.dl-ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.dl-row-main.dl-stack { min-width: 0; }

/* person page */
.dl-person-id { display: flex; align-items: center; gap: 14px; min-width: 0; }
.dl-grid-person { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr); gap: 16px; align-items: start; }
@media (max-width: 1000px) { .dl-grid-person { grid-template-columns: minmax(0, 1fr); } }
.dl-devsec { display: flex; flex-direction: column; gap: 12px; }
.dl-devsec .dl-panel-head { margin: 0; }
.dl-dgrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
/* Cards in a row share a height: the bottom block (usage or set-up buttons) sits on the bottom edge. */
.dl-dcard > .dl-dcard-head + * { margin-top: auto; }
@media (max-width: 700px) { .dl-dgrid { grid-template-columns: minmax(0, 1fr); } }
/* No devices yet: the add card takes the whole row instead of leaving a hole. */
.dl-dgrid > .dl-dslot.add:only-child { grid-column: 1 / -1; }
.dl-dcard { background: var(--dl-card); border: 1px solid var(--dl-line); border-radius: 14px; padding: 14px; display: flex; flex-direction: column; gap: 12px; min-width: 0; box-shadow: var(--dl-shadow); }
.dl-dcard.online { border-color: color-mix(in srgb, var(--dl-ok) 35%, transparent); }
.dl-dcard.off { opacity: .7; }
.dl-dcard-head { display: flex; align-items: center; gap: 12px; }
.dl-dcard-ic { width: 40px; height: 40px; border-radius: 12px; background: var(--dl-soft); display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; color: var(--dl-fg-muted); }
.dl-dcard-ic .dl-icon { width: 20px; height: 20px; }
.dl-dcard.online .dl-dcard-ic { background: var(--dl-ok-wash); color: var(--dl-ok); }
.dl-dcard-title { all: unset; cursor: pointer; flex: 1; min-width: 0; display: flex; flex-direction: column; }
.dl-dcard-title b { font-weight: 500; font-size: 15px; }
.dl-dstat { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dl-fg-muted); white-space: nowrap; min-width: 0; }
.dl-dstat i.dot { flex: none; }
.dl-dstat.ok { color: var(--dl-ok); } .dl-dstat.warn { color: var(--dl-warn); }
.dl-dstat i.dot, .dl-savebar i.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dl-fg-faint); }
.dl-dstat i.dot.ok { background: var(--dl-ok); box-shadow: 0 0 0 3px var(--dl-ok-wash); } .dl-dstat i.dot.warn { background: var(--dl-warn); }
.dl-dcard-use { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
.dl-dcard-foot { padding-top: 10px; border-top: 1px solid var(--dl-line); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dl-dslot.add { all: unset; box-sizing: border-box; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  padding: 14px; min-height: 0; border: 1px dashed color-mix(in srgb, currentColor 18%, transparent); border-radius: 14px; text-align: center;
  color: var(--dl-fg-muted); transition: background .15s, border-color .15s, color .15s; }
.dl-dslot.add .dl-stack { align-items: center; }
.dl-dslot.add:hover { border-color: color-mix(in srgb, currentColor 35%, transparent); color: var(--dl-fg); }
.dl-dslot.add:focus-visible { outline: 2px solid var(--dl-ring); outline-offset: 2px; }
.dl-dslot.add b { font-weight: 500; }
.dl-dslot.add:hover { background: var(--dl-soft); }
.dl-dslot-ic { width: 36px; height: 36px; border-radius: 999px; background: var(--dl-soft); display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; color: var(--dl-fg-muted); }
.dl-dslot.add:hover .dl-dslot-ic { background: var(--dl-primary); color: var(--dl-primary-fg); }
.dl-tiles2 { display: grid; gap: 10px; margin-top: 16px; }
.dl-tile2 { border: 1px solid var(--dl-line); border-radius: 14px; padding: 14px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.dl-tile2-label { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; font-weight: 500; color: var(--dl-fg-faint); }
.dl-tile2-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.dl-tile2-value { font-size: 20px; line-height: 28px; font-weight: 500; letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
.dl-tile2-value .dl-faint { font-size: 14px; font-weight: 400; }
.dl-tile2-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 10px; border-top: 1px solid var(--dl-line); font-size: 12px; }
.dl-stepper { display: inline-flex; align-items: stretch; height: 32px; border: 1px solid var(--input, var(--dl-line)); border-radius: 8px; overflow: hidden; }
.dl-stepper button { all: unset; cursor: pointer; width: 32px; display: inline-flex; align-items: center; justify-content: center; font-size: 16px; color: var(--dl-fg); }
.dl-stepper button:hover { background: var(--dl-soft); } .dl-stepper button[disabled] { opacity: .35; cursor: not-allowed; }
.dl-stepper + .dl-stepper { margin-left: 4px; }
.dl-step-select { border: 0 !important; border-left: 1px solid var(--input, var(--dl-line)) !important; border-right: 1px solid var(--input, var(--dl-line)) !important;
  border-radius: 0 !important; background: transparent !important; color: inherit; font: 500 13px inherit; padding: 0 10px !important; height: 100% !important; min-width: 0 !important; }
.dl-slots { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 3px; }
.dl-slots i { height: 4px; border-radius: 999px; background: var(--dl-track); display: block; } .dl-slots i.used { background: var(--dl-fg); }
.dl-slots i.over { background: color-mix(in srgb, var(--dl-warn) 80%, transparent); }
.dl-date { display: flex; align-items: center; gap: 8px; flex: 1 1 150px; min-width: 0; box-sizing: border-box; height: 34px; padding: 0 10px; border: 1px solid var(--input, var(--dl-line)); border-radius: 8px; color: var(--dl-fg-faint); }
.dl-date input { border: 0 !important; background: transparent !important; box-shadow: none !important; padding: 0 !important; height: 32px !important; color: var(--dl-fg); flex: 1; min-width: 0 !important; width: 100% !important; }
.dl-meter { position: relative; height: 6px; border-radius: 999px; background: var(--dl-track); }
.dl-meter > i { display: block; height: 100%; border-radius: 999px; background: var(--dl-accent); }
.dl-meter.warn > i { background: var(--dl-warn); } .dl-meter.bad > i { background: var(--dl-bad); }
.dl-meter .mark { position: absolute; left: 90%; top: -3px; width: 1px; height: 12px; background: var(--dl-warn); }
.dl-meter.sm { height: 4px; }
.dl-chips-row { display: flex; flex-wrap: wrap; gap: 4px; }
.dl-chipbtn { all: unset; cursor: pointer; height: 26px; padding: 0 10px; border-radius: 999px; background: var(--dl-soft); font-size: 12px; font-weight: 500; display: inline-flex; align-items: center; }
.dl-chipbtn:hover { background: var(--dl-soft-hover); } .dl-chipbtn.on { background: var(--dl-primary); color: var(--dl-primary-fg); }
.dl-switch { all: unset; cursor: pointer; position: relative; width: 32px; height: 20px; border-radius: 999px; background: var(--switch-off, var(--dl-track)); flex: 0 0 auto; transition: background .15s; }
.dl-switch i { position: absolute; left: 2px; top: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: left .15s; box-shadow: 0 1px 2px rgba(0,0,0,.3); }
.dl-switch.on { background: var(--dl-accent); } .dl-switch.on i { left: 14px; }
.dl-switch:focus-visible { outline: 2px solid var(--dl-ring); outline-offset: 2px; }
.dl-linkbox { display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 4px 0 12px; border: 1px solid var(--input, var(--dl-line)); border-radius: 8px; background: var(--input-bg, transparent); }
.dl-linkbox .dl-mono { flex: 1; min-width: 0; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--dl-fg-muted); }
.dl-linkbox .cbi-button { height: 28px !important; }

/* people cards (extra) */
.dl-map .cbi-section-create, .dl-map > .cbi-section > .cbi-button-add { display: none !important; }
.dl-pcard { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 20px; align-items: stretch; min-width: 0; }
.dl-pcard-main { min-width: 0; }
.dl-pcard-top { display: flex; align-items: center; gap: 12px; min-width: 0; }
.dl-pcard-top .dl-avatar { margin-right: 0; }
.dl-pcard-who { flex: 1; min-width: 0; }
.dl-pcard-who .dl-slotbar { margin: 3px 0 0; }
.dl-pside { display: flex; flex-direction: column; justify-content: space-between; gap: 8px; padding-left: 20px; border-left: 1px solid var(--dl-line); min-width: 0; }
.dl-pside-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dl-pside-state { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--dl-fg-muted); }
.dl-pside-state.live { color: var(--dl-ok); }
.dl-pside-foot { font-size: 12px; }
.dl-pside .dl-use-num b { font-size: 20px; }
.dl-map .cbi-section-table-row > .td:has(.dl-pcard) { flex: 1 1 100%; max-width: none !important; width: 100% !important; margin: 0 !important; }
.dl-none { display: none !important; }
.dl-pcard-actions { display: flex; gap: 6px; flex: 0 0 auto; }
.dl-pcard-actions .cbi-button { height: 32px !important; }
.dl-icon-only .dl-btn-label { display: none; }
.dl-pill-ic { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 8px; border-radius: 999px; font-size: 12px; white-space: nowrap;
  background: var(--dl-soft); color: var(--dl-fg-muted); }
.dl-pill-ic .dl-icon { width: 12px; height: 12px; }
.dl-pill-ic.warn { background: var(--dl-warn-wash); color: var(--dl-warn); }
.dl-pill-ic.bad { background: var(--dl-bad-wash); color: var(--dl-bad); }
.dl-use-num { display: flex; align-items: baseline; gap: 6px; white-space: nowrap; }
.dl-use-num b { font-size: 15px; font-weight: 500; }
.dl-use-live { display: flex; align-items: center; gap: 8px; font-size: 12px; font-variant-numeric: tabular-nums; }
.dl-usebar { display: flex; gap: 2px; height: 6px; border-radius: 999px; overflow: hidden; background: var(--dl-track); }
.dl-usebar i { display: block; height: 100%; min-width: 3px; flex: 0 1 0; }
.dl-usebar i.fill { flex: none; min-width: 0; border-radius: 999px; background: var(--dl-accent); }
.dl-usebar.warn i.fill { background: var(--dl-warn); } .dl-usebar.bad i.fill { background: var(--dl-bad); }
.dl-usebar .c0, .dl-swatch.c0 { background: var(--dl-chart-1); }
.dl-usebar .c1, .dl-swatch.c1 { background: #8b7cf6; }
.dl-usebar .c2, .dl-swatch.c2 { background: #2fb889; }
.dl-usebar .c3, .dl-swatch.c3 { background: #d9a03f; }
.dl-usebar .c4, .dl-swatch.c4 { background: var(--dl-fg-faint); }
.dl-tip-row { display: flex; align-items: center; gap: 8px; min-width: 160px; }
.dl-tip-row b { margin-left: auto; font-weight: 500; }
.dl-swatch { width: 8px; height: 8px; border-radius: 2px; flex: none; }
.dl-card-name { color: var(--dl-fg) !important; text-decoration: none; }
.dl-card-name:hover { text-decoration: underline; }
.dl-chip-tag { font-size: 11px; line-height: 18px; padding: 0 6px; border-radius: 999px; background: var(--dl-warn-wash); color: var(--dl-warn); }
/* Online device: a soft green chip instead of a dot */
.dl-chip.live { background: var(--dl-ok-wash); color: color-mix(in srgb, var(--dl-ok) 35%, var(--dl-fg)); }
.dl-chip.live:hover { background: color-mix(in srgb, var(--dl-ok) 22%, transparent); }
.dl-chip.live .dl-icon { color: var(--dl-ok); }
.dl-fixes { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0 0 44px; }
.dl-fix { all: unset; cursor: pointer; height: 26px; padding: 0 10px; border-radius: 999px; background: var(--dl-info-wash); color: var(--dl-info); font-size: 12px; font-weight: 500;
  display: inline-flex; align-items: center; }
.dl-fix:hover { filter: brightness(1.15); }
.dl-map .cbi-section-table-row.dl-attn-row { border-color: color-mix(in srgb, var(--dl-warn) 35%, transparent) !important; }
@media (max-width: 760px) { .dl-pcard { grid-template-columns: 1fr; } .dl-pside { padding: 12px 0 0; border-left: 0; border-top: 1px solid var(--dl-line); } .dl-fixes { margin-left: 0; } }
.dl-select { height: 34px !important; border-radius: 999px !important; min-width: 136px !important; width: auto !important; padding: 0 34px 0 14px !important;
  appearance: none !important; -webkit-appearance: none !important; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238b8f98' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") !important; background-repeat: no-repeat !important; background-position: right 12px center !important; background-size: 14px !important; }
.dl-savebar { position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 160%); opacity: 0; transition: transform .25s cubic-bezier(.2,.8,.2,1), opacity .2s;
  display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 18px; border-radius: 999px; background: var(--dl-elevated); border: 1px solid var(--dl-line);
  box-shadow: var(--shadow-2xl, 0 16px 32px -8px rgba(0,0,0,.5)); z-index: 60; pointer-events: none; }
.dl-savebar.show { transform: translate(-50%, 0); opacity: 1; pointer-events: auto; }
.dl-savebar-text { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; }

/* live toasts */
.dl-toast strong { display: block; font-weight: 500; }
.dl-toast div { opacity: .8; font-size: 13px; }


/* device drawer */
.dl-drawer-overlay { position: fixed; inset: 0; z-index: 900; display: flex; justify-content: flex-end; background: transparent; transition: background .2s; }
.dl-drawer-overlay.open { background: var(--scrim, rgba(0,0,0,.45)); }
.dl-drawer { width: min(520px, 100%); height: 100%; display: flex; flex-direction: column; background: var(--dialog-bg, var(--dl-elevated)); color: var(--dl-fg);
  border-left: 1px solid var(--dl-line); box-shadow: var(--shadow-2xl, -16px 0 32px -8px rgba(0,0,0,.5)); transform: translateX(100%);
  transition: transform .22s cubic-bezier(.2,.8,.2,1); }
.dl-drawer-overlay.open .dl-drawer { transform: none; }
.dl-drawer-head { display: flex; align-items: center; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--dl-line); }
.dl-drawer-title { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; }
.dl-drawer-title h3 { margin: 0 !important; padding: 0 !important; border: 0 !important; font-size: 18px !important; line-height: 26px; font-weight: 500 !important; }
.dl-drawer-x { all: unset; cursor: pointer; width: 32px; height: 32px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; color: var(--dl-fg-muted); }
.dl-drawer-x:hover { background: var(--dl-soft); color: var(--dl-fg); }
.dl-drawer-body { flex: 1; overflow: auto; padding: 20px; }
.dl-drawer-foot { padding: 12px 20px; border-top: 1px solid var(--dl-line); }
.dl-drawer-actions { display: flex; align-items: center; gap: 8px; }
.dl-dcard-ic.on { background: var(--dl-ok-wash); color: var(--dl-ok); }
.dl-icon-only.sm { width: 28px; height: 28px !important; }
.dl-stack.gap12 { gap: 12px; } .dl-stack.gap16 { gap: 16px; }
.dl-dstats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border: 1px solid var(--dl-line); border-radius: 14px; overflow: hidden; }
.dl-dstats-cell { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; min-width: 0; }
.dl-dstats-cell.wide { grid-column: span 2; border-bottom: 1px solid var(--dl-line); }
.dl-dstats-cell + .dl-dstats-cell:not(.wide):last-child { border-left: 1px solid var(--dl-line); }
.dl-dstats-cell b { font-size: 16px; font-weight: 500; font-variant-numeric: tabular-nums; }
.dl-dstats-cell .dl-dstat { font-size: 14px; }
.dl-dsec { border: 1px solid var(--dl-line); border-radius: 14px; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.dl-dsec-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.dl-dsec-head h4 { margin: 0 !important; padding: 0 !important; font-size: 14px !important; font-weight: 500 !important; border: 0 !important; }
.dl-dstat i.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dl-fg-faint); display: inline-block; }
.dl-connect-body { min-height: 60px; }
.dl-connect-body .dl-qr { width: min(240px, 70vw); }
.dl-kv2 { display: flex; flex-direction: column; }
.dl-kvrow { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 9px 0; border-top: 1px solid var(--dl-line); font-size: 13px; min-width: 0; }
.dl-kvrow:first-child { border-top: 0; padding-top: 0; }
.dl-kvrow-k { color: var(--dl-fg-muted); flex: 0 0 auto; }
/* Values wrap (an IPv6 endpoint, traffic totals); only copyable keys are cut, see .copy */
.dl-kvrow-v { min-width: 0; text-align: right; overflow-wrap: anywhere; }
.dl-kvrow-v.copy { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; min-width: 0; color: var(--dl-fg); }
.dl-kvrow-v.copy span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dl-kvrow-v.copy .dl-icon { width: 13px; height: 13px; color: var(--dl-fg-faint); }
.dl-kvrow-v.copy:hover .dl-icon { color: var(--dl-fg); }
@media (max-width: 560px) { .dl-drawer { width: 100%; } .dl-dstats { grid-template-columns: minmax(0, 1fr); } .dl-dstats-cell.wide { grid-column: auto; } .dl-dstats-cell + .dl-dstats-cell:not(.wide):last-child { border-left: 0; border-top: 1px solid var(--dl-line); } }

.dl-dev-log { display: flex; flex-direction: column; }
.dl-dev-log-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--dl-line); font-size: 13px; line-height: 20px; min-width: 0; }
.dl-dev-log-row:first-child { border-top: 0; padding-top: 0; }
.dl-dev-log-row .dl-row-main { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* settings */
.dl-settings-main { min-width: 0; display: flex; flex-direction: column; gap: 20px; }
.dl-setsec { background: var(--dl-card); border: 1px solid var(--dl-line); border-radius: var(--dl-radius); overflow: hidden; scroll-margin-top: 88px; box-shadow: var(--dl-shadow); }
.dl-setsec-body { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.dl-setsec-body h3 { margin: 0 !important; padding: 0 !important; font-size: 18px !important; line-height: 26px; font-weight: 500 !important; border: 0 !important; }
.dl-setsec-body p { margin: 0; }
.dl-setsec-head { display: flex; align-items: center; gap: 10px; }
/* Groups inside a settings card */
.dl-group { border: 1px solid var(--dl-line); border-radius: 14px; padding: 2px 16px; }
.dl-group-head { display: flex; align-items: center; gap: 12px; padding: 14px 0 10px; }
.dl-group-head b { font-size: 15px; font-weight: 500; }
.dl-group-ic { width: 32px; height: 32px; border-radius: 10px; background: var(--dl-soft); color: var(--dl-fg-muted); display: inline-flex; align-items: center; justify-content: center; flex: none; }
.dl-group-ic .dl-icon-wrap { display: inline-flex; } .dl-group-ic .dl-icon { width: 16px; height: 16px; }
.dl-group-body > * { padding: 12px 0; margin: 0 !important; }
.dl-group-body > * + * { border-top: 1px solid var(--dl-line); }
.dl-group-body > .dl-row { border-left: 0; border-right: 0; border-bottom: 0; padding-left: 0; padding-right: 0; background: none; }
.dl-group-body > .dl-row:first-child { border-top: 0; }
.dl-setsec-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; padding: 12px 20px; border-top: 1px solid var(--dl-line); background: var(--dl-soft); }
.dl-setsec.danger { border-color: color-mix(in srgb, var(--dl-bad) 40%, transparent); }
.dl-setsec.danger .dl-setsec-foot { background: color-mix(in srgb, var(--dl-bad) 6%, transparent); }
.dl-setrow { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 420px); align-items: center; gap: 8px 24px; }
.dl-setrow.head { display: flex; justify-content: space-between; gap: 16px; }
.dl-setrow-label { font-size: 14px; font-weight: 500; }
.dl-setrow-ctl { display: flex; justify-content: flex-end; min-width: 0; }
.dl-setrow-ctl .dl-chips-row { justify-content: flex-end; }
.dl-setrow-ctl > input { width: 100%; }
.dl-hostport { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; justify-content: flex-end; }
.dl-hostport input { flex: 1; min-width: 0; }
.dl-root input.dl-w-port, .dl-hostport input.dl-w-port { flex: 0 0 90px; width: 90px; }
.dl-more summary { cursor: pointer; color: var(--dl-fg-muted); font-size: 13px; margin-bottom: 10px; }
.dl-more .dl-setrow + .dl-setrow { margin-top: 10px; }
@media (max-width: 760px) { .dl-setrow:not(.head) { grid-template-columns: minmax(0, 1fr); } .dl-setrow-ctl, .dl-setrow-ctl .dl-chips-row { justify-content: flex-start; } }
/* A missing package, shown where its feature is turned on */
.dl-need-ic { width: 30px; height: 30px; border-radius: 9px; background: var(--dl-soft); color: var(--dl-fg-muted); display: inline-flex; align-items: center; justify-content: center; flex: none; }
.dl-need-ic .dl-icon-wrap { display: inline-flex; } .dl-need-ic .dl-icon { width: 15px; height: 15px; }
.dl-need-row.bad .dl-need-ic, .dl-need-ic.bad { background: var(--dl-bad-wash); color: var(--dl-bad); }
.dl-need-row.warn .dl-need-ic, .dl-need-ic.warn { background: var(--dl-warn-wash); color: var(--dl-warn); }
.dl-need-ic.ok { background: var(--dl-ok-wash); color: var(--dl-ok); }
.dl-lh-main { display: flex; align-items: flex-start; gap: 12px; min-width: 0; }
.dl-lh-main > .dl-need-ic { margin-top: 1px; }
/* Monospace reads larger than the sans text around it */
.dl-sub .dl-mono { font-size: .92em; }
.dl-need-row > .cbi-button { flex: none; }
/* Backups section in Settings */
.dl-bk-row .dl-group-ic { width: 30px; height: 30px; }
.dl-bk-older > summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 11px 16px; border-top: 1px solid var(--dl-line); font-size: 13px; color: var(--dl-fg-muted); user-select: none; }
.dl-bk-older > summary::-webkit-details-marker { display: none; }
.dl-bk-older > summary:hover { background: var(--dl-soft); color: var(--dl-fg); }
.dl-bk-older > summary .dl-icon-wrap { display: inline-flex; transition: transform .15s; } .dl-bk-older > summary .dl-icon { width: 14px; height: 14px; }
.dl-bk-older[open] > summary .dl-icon-wrap { transform: rotate(90deg); }
#dl-set-backups .dl-setsec-head h3 + .dl-sub { margin-top: 2px; }
#dl-set-backups .dl-setsec-foot > .dl-sub { flex: 1 1 260px; }
.dl-bk-actions { flex: 0 1 auto; justify-content: flex-end; }
@media (max-width: 640px) { #dl-set-backups .dl-setsec-foot > .dl-sub { flex-basis: 100%; } .dl-bk-actions { justify-content: flex-start; } }
/* Updates: Settings-style sections, one row anatomy (name and note left, a pill or a button right) */
.dl-upd { display: flex; flex-direction: column; gap: 16px; }
.dl-upd > .dl-pagehead { margin: 0 0 4px; }
.dl-upd-head { display: flex; align-items: center; gap: 12px; padding: 16px 20px; }
.dl-upd-head > .dl-stack { flex: 1; min-width: 0; }
.dl-upd-head > .dl-stack > b { font-size: 15px; font-weight: 500; }
.dl-upd-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 20px; border-top: 1px solid var(--dl-line); min-height: 40px; }
.dl-upd-row > .dl-stack { min-width: 0; }
.dl-upd-name { font-size: 14px; }
.dl-upd-row .dl-mono { font-size: 11px; }
.dl-upd-row .dl-mono b { color: var(--dl-fg); font-weight: 500; }
.dl-upd-row > .dl-pill, .dl-upd-row > button, .dl-upd-head > .dl-pill, .dl-upd-head > button { flex: none; }
.dl-upd-bad { color: var(--dl-bad); }
.dl-upd-job > .dl-log, .dl-upd-job > .alert-message { margin: 0 14px 14px; }
`;

/** A <style> element for the view root (see the note at the top). */
export function styleNode(): HTMLStyleElement {
  const el = document.createElement('style');
  el.dataset.dawnline = '1';
  el.textContent = CSS;
  return el;
}
