import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { teacherDocuments } from "@/lib/db/schema";

/**
 * Drizzle's exported transaction handle type. We import it loosely (any
 * function that has the same `update` shape works) so this module can be
 * called from either a top-level `db` or from inside an existing
 * transaction without coupling to drizzle's verbose internal generics.
 */
type DbExecutor = Pick<typeof db, "update">;

/**
 * Mark `previousDocId` as superseded by `newDocId`.
 *
 * Atomically sets `previous.superseded_by = newDoc.id`. Returns the
 * number of rows actually updated (0 if the previous row was already
 * superseded — we never overwrite an existing chain link).
 *
 * Idempotency: the WHERE clause includes `superseded_by IS NULL`, so a
 * second call with the same arguments is a no-op rather than a
 * silent reassignment that could break a renewal chain.
 *
 * If the caller already has a transaction handle, pass it as `tx` to
 * keep the supersession write in the same unit as the new-doc insert.
 */
export async function linkSupersession(
  newDocId: string,
  previousDocId: string,
  tx?: DbExecutor
): Promise<number> {
  if (!newDocId || !previousDocId) {
    throw new Error("linkSupersession: both ids are required");
  }
  if (newDocId === previousDocId) {
    throw new Error("linkSupersession: a document cannot supersede itself");
  }
  const executor: DbExecutor = tx ?? db;
  const result = await executor
    .update(teacherDocuments)
    .set({ supersededBy: newDocId })
    .where(
      and(
        eq(teacherDocuments.id, previousDocId),
        isNull(teacherDocuments.supersededBy)
      )
    )
    .returning({ id: teacherDocuments.id });
  return result.length;
}
