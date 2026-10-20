// CSV for the log export. Cells a spreadsheet would run as a formula (= + - @,
// tab, CR) get a leading apostrophe; quotes, commas and line breaks are quoted.
// The header row is the column keys unless the caller names them (translated).

export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<K extends string>(cols: readonly K[], rows: Record<K, unknown>[], head?: Record<K, string>): string {
  return [cols.map((c) => csvCell(head?.[c] ?? c)).join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n');
}
