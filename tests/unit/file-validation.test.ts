import { describe, expect, it } from "vitest";
import { sanitizeFilename, sniffAndValidate } from "@/lib/validation/file";

// ---------- magic-byte fixtures ----------
// Real magic-byte headers + minimal valid trailing structure. We don't need
// full conforming files — just enough that file-type's detection succeeds.

/** A minimal valid PDF (header + trailer). */
function makePdf(): Buffer {
  return Buffer.from(
    "%PDF-1.4\n" +
      "1 0 obj<<>>endobj\n" +
      "xref\n0 1\n0000000000 65535 f \n" +
      "trailer<<>>\n" +
      "startxref\n9\n" +
      "%%EOF\n"
  );
}

/** A PDF header without a trailer — looks like a real PDF until you read to the end. */
function makeTruncatedPdf(): Buffer {
  return Buffer.from("%PDF-1.4\nthis file was cut off mid-write");
}

/** Minimal valid PNG: 8-byte signature + IHDR + IEND. */
function makePng(): Buffer {
  // 1x1 transparent PNG.
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64"
  );
}

/** Minimal valid JPEG. */
function makeJpeg(): Buffer {
  // Smallest valid JPEG: SOI + APP0 (JFIF) + EOI.
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]);
}

/** A Windows PE executable header (MZ). */
function makeExe(): Buffer {
  const buf = Buffer.alloc(64);
  buf.write("MZ", 0, "ascii");
  return buf;
}

/** A plausible SVG (text/xml — must be rejected: not in whitelist). */
function makeSvg(): Buffer {
  return Buffer.from(
    `<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>`
  );
}

describe("sniffAndValidate", () => {
  it("accepts a real PDF", async () => {
    const r = await sniffAndValidate(makePdf());
    expect(r).toEqual({ ok: true, mime: "application/pdf", ext: "pdf" });
  });

  it("accepts a real JPEG", async () => {
    const r = await sniffAndValidate(makeJpeg());
    expect(r).toEqual({ ok: true, mime: "image/jpeg", ext: "jpg" });
  });

  it("accepts a real PNG", async () => {
    const r = await sniffAndValidate(makePng());
    expect(r).toEqual({ ok: true, mime: "image/png", ext: "png" });
  });

  it("rejects a .exe regardless of the (absent) Content-Type header", async () => {
    const r = await sniffAndValidate(makeExe());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unsupported_type");
  });

  it("rejects an SVG (not in whitelist)", async () => {
    const r = await sniffAndValidate(makeSvg());
    expect(r.ok).toBe(false);
    // file-type does not detect plain XML/SVG by magic bytes — it comes back
    // as `corrupt`, which still keeps the file out of storage.
  });

  it("rejects a truncated PDF (missing %%EOF)", async () => {
    const r = await sniffAndValidate(makeTruncatedPdf());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("corrupt");
  });

  it("rejects an empty buffer", async () => {
    const r = await sniffAndValidate(Buffer.alloc(0));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("corrupt");
  });

  it("rejects random noise", async () => {
    const r = await sniffAndValidate(Buffer.from("this is not a file"));
    expect(r.ok).toBe(false);
  });
});

describe("sanitizeFilename", () => {
  it("strips path traversal", () => {
    expect(sanitizeFilename("../../../etc/passwd")).toBe("passwd");
  });

  it("strips quotes and shell-active chars (basename only, with separators stripped)", () => {
    // basename of "...; rm -rf /; echo .pdf" is "echo .pdf"; then the space is
    // removed by the [A-Za-z0-9._-]+ filter.
    expect(sanitizeFilename(`"; rm -rf /; echo .pdf`)).toBe("echo.pdf");
  });

  it("strips quotes and CRLF from a single-segment name", () => {
    expect(sanitizeFilename(`bad"name\r\n.pdf`)).toBe("badname.pdf");
  });

  it("collapses to [A-Za-z0-9._-]", () => {
    expect(sanitizeFilename("my résumé (final).pdf")).toBe("myrsumfinal.pdf");
  });

  it("drops leading dots so we never produce a dotfile", () => {
    expect(sanitizeFilename(".htaccess")).toBe("htaccess");
  });

  it("falls back to 'file' when everything is stripped", () => {
    expect(sanitizeFilename("///")).toBe("file");
    expect(sanitizeFilename("")).toBe("file");
  });

  it("preserves a normal filename unchanged", () => {
    expect(sanitizeFilename("CPR_2024.pdf")).toBe("CPR_2024.pdf");
  });
});
