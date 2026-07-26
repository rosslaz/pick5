// Client-side CSV download helpers (used by the admin player export and the
// leaderboard week export).

/**
 * Neutralise spreadsheet formula injection.
 *
 * Excel and Sheets evaluate a cell that begins with = + - @ (or a leading tab
 * or carriage return) as a formula, and wrapping the value in quotes does NOT
 * prevent it. Exported cells include display names and email addresses, which
 * any league member controls — so a member called `=cmd|'/c calc'!A1` could
 * get code to run on the commissioner's machine when they open the export.
 * A leading apostrophe forces the cell to be treated as text.
 *
 * Numbers are passed through untouched so genuine negative values stay numeric.
 */
function csvCell(v: string | number): string {
  if (typeof v === "number") return `"${v}"`;
  const s = String(v);
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/** Build a CSV (quoted + escaped, UTF-8 BOM) and trigger a browser download. */
export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "export";
}
