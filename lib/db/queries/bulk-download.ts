import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  documentTypes,
  teacherDocuments,
  teacherProfiles,
  users,
} from "@/lib/db/schema";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { getStorage } from "@/lib/storage";
import { sanitizeFilename } from "@/lib/validation/file";
import { createZip, type ZipEntry } from "@/lib/zip/store";

/**
 * Build a single ZIP containing every uploaded document for one teacher, plus
 * a manifest. Admin-only — the caller (route) re-checks the session role and
 * this query asserts admin again as a second wall.
 *
 * Safety:
 *  - File bytes only ever flow through the private storage adapter; no public
 *    URLs are produced.
 *  - In-archive paths are built from sanitized, server-known values
 *    (`sanitizeFilename` + UUID), never raw user input — no path traversal.
 *  - A missing/unreadable file does NOT abort the archive: it is recorded in
 *    the manifest with a note and skipped.
 */

export interface BulkDownloadResult {
  zip: Buffer;
  /** Safe base filename for Content-Disposition, no extension. */
  baseName: string;
  fileCount: number;
  skippedCount: number;
}

function csvCell(value: string | null | undefined): string {
  const s = value ?? "";
  // Quote and escape any cell that could break CSV parsing.
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function isoOrEmpty(d: Date | null | undefined): string {
  return d ? new Date(d).toISOString() : "";
}

/** Folder-safe slug for the top-level archive directory. */
function folderSlug(name: string): string {
  const slug = name
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug.length > 0 ? slug : "teacher";
}

export async function buildTeacherDocumentsZip(
  currentAdmin: { role: string },
  teacherId: string
): Promise<BulkDownloadResult> {
  if (currentAdmin.role !== "admin") {
    throw new ForbiddenError("Admin role required");
  }

  const [teacher] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, teacherId), eq(users.role, "teacher")))
    .limit(1);
  if (!teacher) throw new NotFoundError("Teacher not found");

  // Profile is optional for the download (present for all real teachers).
  await db
    .select()
    .from(teacherProfiles)
    .where(eq(teacherProfiles.userId, teacherId))
    .limit(1);

  // Every upload, newest first — history included so nothing is hidden.
  const rows = await db
    .select({
      doc: teacherDocuments,
      typeName: documentTypes.name,
    })
    .from(teacherDocuments)
    .leftJoin(documentTypes, eq(documentTypes.id, teacherDocuments.documentTypeId))
    .where(eq(teacherDocuments.userId, teacherId))
    .orderBy(desc(teacherDocuments.uploadedAt));

  const folder = folderSlug(teacher.name);
  const storage = getStorage();
  const entries: ZipEntry[] = [];
  let skippedCount = 0;

  const manifestRows: string[] = [
    [
      "teacher_name",
      "teacher_email",
      "document_type",
      "original_filename",
      "archive_path",
      "uploaded_at",
      "review_status",
      "expires_at",
      "note",
    ].join(","),
  ];

  // De-dupe identical in-archive paths if two uploads sanitize to the same name.
  const usedPaths = new Set<string>();

  for (const r of rows) {
    const doc = r.doc;
    const typeName = r.typeName ?? "Unknown-Type";
    const typeSlug = sanitizeFilename(typeName).replace(/\.+$/, "") || "Unknown-Type";
    const datePart = isoOrEmpty(doc.uploadedAt).slice(0, 10) || "unknown-date";
    const safeOriginal = sanitizeFilename(doc.originalFilename);
    let archivePath = `${folder}/${typeSlug}/${datePart}-${doc.status}-${safeOriginal}`;
    // Guarantee uniqueness so no file silently overwrites another.
    if (usedPaths.has(archivePath)) {
      archivePath = `${folder}/${typeSlug}/${doc.id}-${datePart}-${doc.status}-${safeOriginal}`;
    }
    usedPaths.add(archivePath);

    let note = "";
    try {
      const got = await storage.get(doc.storageKey);
      entries.push({ name: archivePath, data: got.body });
    } catch {
      note = "FILE MISSING IN STORAGE — skipped";
      skippedCount += 1;
      archivePath = ""; // not in archive
    }

    manifestRows.push(
      [
        csvCell(teacher.name),
        csvCell(teacher.email),
        csvCell(typeName),
        csvCell(doc.originalFilename),
        csvCell(archivePath),
        csvCell(isoOrEmpty(doc.uploadedAt)),
        csvCell(doc.status),
        csvCell(isoOrEmpty(doc.expiresAt)),
        csvCell(note),
      ].join(",")
    );
  }

  // Manifest always included, even if every file was missing.
  entries.push({
    name: `${folder}/manifest.csv`,
    data: Buffer.from(manifestRows.join("\r\n") + "\r\n", "utf8"),
  });

  return {
    zip: createZip(entries),
    baseName: `${folder}-documents`,
    fileCount: rows.length,
    skippedCount,
  };
}
