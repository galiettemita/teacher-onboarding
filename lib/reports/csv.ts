/**
 * RFC 4180 CSV writer. No third-party dep — the format is tiny.
 *
 *   - Fields containing `"`, `,`, `\n`, or `\r` are wrapped in double
 *     quotes; embedded `"` is doubled.
 *   - Rows are separated by `\r\n`.
 *   - The file begins with a UTF-8 BOM (`\uFEFF`) so Excel respects
 *     diacritics on Windows. Spreadsheet apps that don't recognise the
 *     BOM strip it silently.
 */
export function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : String(value);
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
