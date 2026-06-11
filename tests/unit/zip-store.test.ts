import { describe, expect, it } from "vitest";
import { createZip, crc32 } from "@/lib/zip/store";

/**
 * Parse a store-only ZIP via its end-of-central-directory record and central
 * directory, so we assert on real archive structure rather than a hand-wave.
 */
function readEntries(zip: Buffer): Array<{ name: string; data: Buffer }> {
  // Find EOCD (0x06054b50) scanning from the end.
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("no EOCD");
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16); // central dir offset

  const out: Array<{ name: string; data: Buffer }> = [];
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central header");
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOffset = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString("utf8");

    // Local header → data.
    if (zip.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("bad local header");
    const lNameLen = zip.readUInt16LE(localOffset + 26);
    const lExtraLen = zip.readUInt16LE(localOffset + 28);
    const size = zip.readUInt32LE(localOffset + 22); // uncompressed size
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const data = zip.subarray(dataStart, dataStart + size);
    out.push({ name, data: Buffer.from(data) });

    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe("createZip (store method)", () => {
  it("crc32 matches a known value", () => {
    // CRC-32 of "123456789" is 0xCBF43926.
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });

  it("round-trips file names and bytes (test 24)", () => {
    const zip = createZip([
      { name: "jane/manifest.csv", data: Buffer.from("a,b,c\n") },
      { name: "jane/Medical-Form/2026-01-01-approved-form.pdf", data: Buffer.from("%PDF-1.4 fake") },
    ]);
    const entries = readEntries(zip);
    expect(entries.map((e) => e.name)).toEqual([
      "jane/manifest.csv",
      "jane/Medical-Form/2026-01-01-approved-form.pdf",
    ]);
    expect(entries[0].data.toString()).toBe("a,b,c\n");
    expect(entries[1].data.toString()).toBe("%PDF-1.4 fake");
  });

  it("starts with the local file header signature", () => {
    const zip = createZip([{ name: "x.txt", data: Buffer.from("hi") }]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
  });

  it("handles binary data with a correct CRC in the header", () => {
    const data = Buffer.from([0x00, 0xff, 0x10, 0x80, 0x7f]);
    const zip = createZip([{ name: "b.bin", data }]);
    const [entry] = readEntries(zip);
    expect(entry.data.equals(data)).toBe(true);
  });
});
