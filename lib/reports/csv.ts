/**
 * RFC 4180 CSV writer + CSV-formula-injection defense.
 *
 *   - Fields containing `"`, `,`, `\n`, or `\r` are wrapped in double
 *     quotes; embedded `"` is doubled.
 *   - Rows are separated by `\r\n`.
 *   - The file begins with a UTF-8 BOM (`\uFEFF`) so Excel respects
 *     diacritics on Windows. Spreadsheet apps that don't recognise the
 *     BOM strip it silently.
 *
 * Formula-injection defense (CWE-1236):
 *   A cell whose first character is `=`, `+`, `-`, `@`, TAB (`\t`), or
 *   CR (`\r`) is interpreted as a formula by Excel / Google Sheets /
 *   LibreOffice the moment the file is opened. A teacher who sets their
 *   name to `=cmd|'/c calc'!A1` would trigger code execution on the
 *   secretary's laptop when she opens the export. We neutralise this by
 *   prefixing a single-quote (`'`) to any such cell BEFORE the RFC 4180
 *   quoting layer. The prepended `'` is conventionally stripped by
 *   spreadsheet apps on import and is invisible in the rendered cell.
 *
 *   See docs/SECURITY.md §1 (threat row "CSV formula injection") and
 *   tests/unit/csv.test.ts.
 */
const DANGEROUS_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

export function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "string" ? value : String(value);
  if (s.length > 0 && DANGEROUS_PREFIXES.includes(s[0])) {
    s = "'" + s;
  }
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(header: readonly string[], rows: readonly unknown[][]): string {
  const lines: string[] = [];
  lines.push(header.map(escapeCell).join(","));
  for (const r of rows) {
    lines.push(r.map(escapeCell).join(","));
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
