import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { documentTypes, type DocumentType } from "@/lib/db/schema";
import { auditLog } from "@/lib/audit/log";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";

function assertAdmin(currentAdmin: { role: string }) {
  if (currentAdmin.role !== "admin") {
    throw new ForbiddenError("Admin role required");
  }
}

export interface DocTypeInput {
  name: string;
  description?: string | null;
  required: boolean;
  renewalMonths: number;
}

function validateInput(input: DocTypeInput) {
  const name = input.name?.trim();
  if (!name) throw new ValidationError("name is required");
  if (name.length > 200) throw new ValidationError("name is too long");
  if (
    !Number.isInteger(input.renewalMonths) ||
    input.renewalMonths < 0 ||
    input.renewalMonths > 120
  ) {
    throw new ValidationError("renewalMonths must be an integer between 0 and 120");
  }
  if (typeof input.required !== "boolean") {
    throw new ValidationError("required must be a boolean");
  }
  return { ...input, name };
}

/**
 * Returns every document type, including deactivated ones. The teacher
 * dashboard (Agent 2) is responsible for filtering to `active=true` in its
 * own query — we never hard-delete here, so historical teacher docs keep
 * resolving their type name.
 */
export async function listDocumentTypes(
  currentAdmin: { role: string }
): Promise<DocumentType[]> {
  assertAdmin(currentAdmin);
  return db.select().from(documentTypes).orderBy(asc(documentTypes.name));
}

export async function createDocumentType(
  currentAdmin: { id: string; role: string },
  input: DocTypeInput
): Promise<DocumentType> {
  assertAdmin(currentAdmin);
  const v = validateInput(input);

  // Duplicate name → 409. The unique index on name would error anyway, but
  // we check first to return a clean message.
  const [existing] = await db
    .select()
    .from(documentTypes)
    .where(eq(documentTypes.name, v.name))
    .limit(1);
  if (existing) throw new ConflictError("A document type with that name already exists");

  const [row] = await db
    .insert(documentTypes)
    .values({
      name: v.name,
      description: v.description ?? null,
      required: v.required,
      renewalMonths: v.renewalMonths,
      active: true,
    })
    .returning();

  await auditLog({
    actorId: currentAdmin.id,
    action: "doc_type.create",
    targetType: "doc_type",
    targetId: row.id,
    metadata: { name: row.name },
  });
  return row;
}

export async function updateDocumentType(
  currentAdmin: { id: string; role: string },
  id: string,
  input: DocTypeInput
): Promise<DocumentType> {
  assertAdmin(currentAdmin);
  const v = validateInput(input);

  const [existing] = await db
    .select()
    .from(documentTypes)
    .where(eq(documentTypes.id, id))
    .limit(1);
  if (!existing) throw new NotFoundError("Document type not found");

  // If renaming, make sure the new name isn't taken by another row.
  if (v.name !== existing.name) {
    const [conflict] = await db
      .select()
      .from(documentTypes)
      .where(eq(documentTypes.name, v.name))
      .limit(1);
    if (conflict && conflict.id !== id) {
      throw new ConflictError("A document type with that name already exists");
    }
  }

  const [row] = await db
    .update(documentTypes)
    .set({
      name: v.name,
      description: v.description ?? null,
      required: v.required,
      renewalMonths: v.renewalMonths,
      updatedAt: new Date(),
    })
    .where(eq(documentTypes.id, id))
    .returning();

  await auditLog({
    actorId: currentAdmin.id,
    action: "doc_type.update",
    targetType: "doc_type",
    targetId: row.id,
    metadata: {
      name: row.name,
      previousName: existing.name,
    },
  });
  return row;
}

/**
 * Soft-delete: sets active=false. Existing teacher_documents rows continue
 * to reference this type so historical reviews remain auditable.
 */
export async function deactivateDocumentType(
  currentAdmin: { id: string; role: string },
  id: string
): Promise<DocumentType> {
  assertAdmin(currentAdmin);

  const [existing] = await db
    .select()
    .from(documentTypes)
    .where(eq(documentTypes.id, id))
    .limit(1);
  if (!existing) throw new NotFoundError("Document type not found");

  const [row] = await db
    .update(documentTypes)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(documentTypes.id, id))
    .returning();

  await auditLog({
    actorId: currentAdmin.id,
    action: "doc_type.deactivate",
    targetType: "doc_type",
    targetId: row.id,
    metadata: { name: row.name },
  });
  return row;
}
