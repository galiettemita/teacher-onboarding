import { describe, expect, it } from "vitest";
import { escapeCell, toCsv } from "@/lib/reports/csv";

describe("escapeCell", () => {
  it("returns empty for null / undefined", () => {
    expect(escapeCell(null)).toBe("");
    expect(escapeCell(undefined)).toBe("");
  });

  it("leaves plain text untouched", () => {
    expect(escapeCell("hello")).toBe("hello");
    expect(escapeCell(42)).toBe("42");
  });

  it("quotes fields with commas, quotes, and newlines", () => {
    expect(escapeCell("a,b")).toBe('"a,b"');
    expect(escapeCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCell("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCell("with\rcr")).toBe('"with\rcr"');
  });
});

describe("toCsv", () => {
  it("emits BOM + header + rows separated by CRLF", () => {
    const out = toCsv(["a", "b"], [
      ["1", "2"],
      ["3", "4"],
    ]);
    expect(out.startsWith("\uFEFF")).toBe(true);
    expect(out.split("\r\n")).toEqual(["\uFEFFa,b", "1,2", "3,4", ""]);
  });

  it("escapes cells containing the delimiter", () => {
    const out = toCsv(["name"], [["x,y"]]);
    expect(out).toContain('"x,y"');
  });

  it("is injection-safe: leading = stays literal (consumer decides)", () => {
    // RFC 4180 doesn't require sanitising formula-style cells; we
    // document the choice. The cell is emitted as-is when it contains
    // no delimiter chars. (Document expectation, don't auto-mangle.)
    const out = toCsv(["a"], [["=SUM(1)"]]);
    expect(out).toContain("=SUM(1)");
  });
});
