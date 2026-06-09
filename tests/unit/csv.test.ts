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

});

describe("CSV formula-injection defense", () => {
  /**
   * Excel / Google Sheets / LibreOffice interpret a cell that starts
   * with =, +, -, @, TAB, or CR as a formula at open time. We prepend
   * a single-quote before quoting, which spreadsheets strip on display.
   */
  it.each([
    ["=SUM(1+1)", "'=SUM(1+1)"],
    ["+1+1", "'+1+1"],
    ["-1+1", "'-1+1"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\tinjected", "'\tinjected"],
    ["\rinjected", "'\rinjected"],
  ])("neutralises dangerous prefix %j", (raw, escaped) => {
    const out = escapeCell(raw);
    // The output begins with the literal `'` (possibly wrapped in
    // quotes if RFC 4180 escaping kicked in for tab / CR / comma).
    const stripped = out.startsWith('"') ? out.slice(1, -1).replace(/""/g, '"') : out;
    expect(stripped).toBe(escaped);
  });

  it("does NOT mangle a leading character that isn't dangerous", () => {
    expect(escapeCell("safe text")).toBe("safe text");
    expect(escapeCell("123")).toBe("123");
    expect(escapeCell("a=b")).toBe("a=b"); // `=` not at position 0
    expect(escapeCell("Apple, Inc.")).toBe('"Apple, Inc."');
  });

  it("protects the attack-on-secretary case end-to-end via toCsv", () => {
    // A teacher who sets their name to `=cmd|'/c calc'!A1` cannot
    // trigger code execution when the secretary opens the export.
    const out = toCsv(["name"], [["=cmd|'/c calc'!A1"]]);
    // Cell now starts with the neutralising apostrophe; whole field is
    // also wrapped in quotes because the original contained `,` — wait,
    // it didn't, but it does contain neither `,` nor `\n`, so no RFC
    // 4180 quoting. Just the apostrophe.
    const dataLine = out.replace(/^\uFEFF/, "").split("\r\n")[1];
    expect(dataLine.startsWith("'=")).toBe(true);
    expect(dataLine).not.toMatch(/^=cmd/);
  });

  it("treats empty string as benign (no apostrophe added)", () => {
    expect(escapeCell("")).toBe("");
  });
});
