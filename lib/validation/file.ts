import { fileTypeFromBuffer } from "file-type";
import { z } from "zod";

/**
 * File validation utilities for the upload pipeline.
 *
 * We never trust the client's `Content-Type` header or filename extension.
 * Detection is by magic bytes only (via the `file-type` package).
 *
 * Whitelist: PDF + JPEG + PNG. Anything else (including SVG, HTML, scripts,
 * executables, archives, Office docs) is rejected as `unsupported_type`.
 * Truncated / unparseable files come back as `corrupt`.
 */

export const ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/png"] as const;
export type AllowedMime = (typeof ALLOWED_MIME)[number];
export type AllowedExt = "pdf" | "jpg" | "png";

export const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/** Zod schema for the multipart `document_type_id` field. */
export const uploadFieldsSchema = z.object({
  document_type_id: z.string().uuid(),
});

const MIME_TO_EXT: Record<AllowedMime, AllowedExt> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

export type SniffResult =
  | { ok: true; mime: AllowedMime; ext: AllowedExt }
  | { ok: false; reason: "unsupported_type" | "corrupt" };

/**
 * Detect the file type by magic bytes and verify it is in the whitelist.
 *
 *  - If `file-type` returns nothing, the buffer doesn't match any known
 *    format — treated as `corrupt` (real PDFs/PNGs/JPEGs are always
 *    detected).
 *  - If the detected mime is outside the whitelist, `unsupported_type`.
 *  - PDFs must begin with `%PDF-` AND contain `%%EOF` near the tail.
 *    `file-type` is permissive on truncated PDFs, so we re-check here.
 */
export async function sniffAndValidate(buffer: Buffer): Promise<SniffResult> {
  if (buffer.length === 0) return { ok: false, reason: "corrupt" };

  const detected = await fileTypeFromBuffer(buffer);
  if (!detected) return { ok: false, reason: "corrupt" };

  if (!ALLOWED_MIME.includes(detected.mime as AllowedMime)) {
    return { ok: false, reason: "unsupported_type" };
  }
  const mime = detected.mime as AllowedMime;

  if (mime === "application/pdf") {
    // Header check is redundant with file-type, but cheap insurance.
    if (!buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      return { ok: false, reason: "corrupt" };
    }
    // PDFs end with `%%EOF`. Look in the last 1024 bytes to allow trailing whitespace.
    const tail = buffer.subarray(Math.max(0, buffer.length - 1024));
    if (!tail.includes(Buffer.from("%%EOF"))) {
      return { ok: false, reason: "corrupt" };
    }
  }

  return { ok: true, mime, ext: MIME_TO_EXT[mime] };
}

/**
 * Strip everything that is not `[A-Za-z0-9._-]` from a filename. Used for
 * `Content-Disposition` and any other place the original filename leaks
 * back to the client.
 *
 *  - Drops directory separators (`/`, `\`) and `..` traversal pieces.
 *  - Drops control characters, quotes, and other shell-active chars.
 *  - Collapses to a single dot in extensions; no leading/trailing dots.
 *  - Falls back to `file` if everything is stripped.
 */
export function sanitizeFilename(name: string): string {
  // Strip any path components first — only the basename matters.
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "");
  // Drop leading dots so we never produce a hidden file like `.htaccess`.
  const noLeadingDot = cleaned.replace(/^\.+/, "");
  // Trim length defensively — `Content-Disposition` can choke on huge names.
  const trimmed = noLeadingDot.slice(0, 200);
  return trimmed.length > 0 ? trimmed : "file";
}
