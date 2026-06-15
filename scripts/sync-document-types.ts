/**
 * Make the live document-type catalog match the canonical five forms in
 * lib/db/document-catalog.ts. Safe to run repeatedly (idempotent).
 *
 * Usage:
 *   pnpm db:sync-doctypes              # safe: upsert the 5, DEACTIVATE the rest
 *   pnpm db:sync-doctypes --hard-delete# also PHYSICALLY DELETE the rest + their uploads
 *
 * Default (deactivate) is reversible and preserves every upload + review
 * record — non-catalog types simply disappear from teacher dashboards and
 * admin completion. `--hard-delete` permanently removes non-catalog document
 * types AND any teacher_documents rows that reference them (their stored files
 * become orphaned in the bucket). Use it only when you truly want those forms
 * gone from every record.
 *
 * This script never touches users, teacher profiles, or the five catalog forms'
 * own uploads.
 */
import { inArray, notInArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { documentTypes, teacherDocuments } from "@/lib/db/schema";
import {
  REQUIRED_DOCUMENT_TYPES,
  REQUIRED_DOCUMENT_TYPE_NAMES,
} from "@/lib/db/document-catalog";

const HARD_DELETE =
  process.argv.includes("--hard-delete") || process.env.HARD_DELETE === "1";

async function upsertCatalog() {
  for (const dt of REQUIRED_DOCUMENT_TYPES) {
    await db
      .insert(documentTypes)
      .values({
        name: dt.name,
        description: dt.description,
        required: dt.required,
        renewalMonths: dt.renewalMonths,
        applicability: dt.applicability,
        active: true,
      })
      .onConflictDoUpdate({
        target: documentTypes.name,
        set: {
          description: dt.description,
          required: dt.required,
          renewalMonths: dt.renewalMonths,
          applicability: dt.applicability,
          active: true,
          updatedAt: new Date(),
        },
      });
    console.log(`  ✓ ${dt.name}  [${dt.applicability}]`);
  }
}

async function deactivateRest() {
  const rows = await db
    .update(documentTypes)
    .set({ active: false, updatedAt: new Date() })
    .where(notInArray(documentTypes.name, REQUIRED_DOCUMENT_TYPE_NAMES))
    .returning({ name: documentTypes.name });
  return rows.map((r) => r.name);
}

async function hardDeleteRest(): Promise<{ types: string[]; docs: number }> {
  return db.transaction(async (tx) => {
    const victims = await tx
      .select({ id: documentTypes.id, name: documentTypes.name })
      .from(documentTypes)
      .where(notInArray(documentTypes.name, REQUIRED_DOCUMENT_TYPE_NAMES));
    const ids = victims.map((v) => v.id);
    if (ids.length === 0) return { types: [], docs: 0 };

    // Break the self-referential supersession links among these rows first so
    // the bulk delete can't trip the restrict FK, then delete the uploads and
    // finally the types themselves (teacher_documents.document_type_id is
    // ON DELETE RESTRICT).
    await tx
      .update(teacherDocuments)
      .set({ supersededBy: null })
      .where(inArray(teacherDocuments.documentTypeId, ids));
    const deletedDocs = await tx
      .delete(teacherDocuments)
      .where(inArray(teacherDocuments.documentTypeId, ids))
      .returning({ id: teacherDocuments.id });
    await tx.delete(documentTypes).where(inArray(documentTypes.id, ids));

    return { types: victims.map((v) => v.name), docs: deletedDocs.length };
  });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Configure .env before running.");
    process.exit(1);
  }

  console.log("→ upserting the 5 catalog document types");
  await upsertCatalog();

  if (HARD_DELETE) {
    console.log("→ HARD-DELETE: removing all non-catalog types and their uploads");
    const { types, docs } = await hardDeleteRest();
    if (types.length === 0) {
      console.log("  (nothing else to delete — catalog already clean)");
    } else {
      console.log(
        `  deleted ${types.length} type(s) and ${docs} upload row(s): ${types.join(", ")}`
      );
    }
  } else {
    console.log("→ deactivating all non-catalog types (safe, reversible)");
    const names = await deactivateRest();
    if (names.length === 0) {
      console.log("  (nothing else active — catalog already clean)");
    } else {
      console.log(`  deactivated ${names.length} type(s): ${names.join(", ")}`);
    }
  }

  console.log("");
  console.log("✓ document catalog now matches the 5 required forms");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
