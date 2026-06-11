import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { auditLogs, users } from "@/lib/db/schema";
import { ForbiddenError, ValidationError } from "@/lib/errors";

/**
 * Teacher account-activation lifecycle.
 *
 * A teacher invited by an admin is created with a temporary password and
 * `must_change_password = true`. Until they create their own password they are
 * forced into /teacher/activate and blocked from the rest of the portal
 * (see lib/auth/guards.ts and the teacher API routes).
 *
 * `mustChangePassword` is the single source of truth for the access gate and
 * the admin "Account Created" status. `activatedAt` records when activation
 * happened (for display); both are written together by `activateAccount`.
 */

const MIN_PASSWORD_LENGTH = 12;

export interface ActivationStatus {
  /** True while the teacher still owes a self-chosen password (not activated). */
  mustChangePassword: boolean;
}

export async function getActivationStatus(userId: string): Promise<ActivationStatus> {
  const [row] = await db
    .select({ mustChangePassword: users.mustChangePassword })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) throw new ForbiddenError("User not found");
  return { mustChangePassword: row.mustChangePassword };
}

/**
 * Activate the current teacher's account by setting their own password.
 *
 * The teacher is already authenticated with the temporary password (the session
 * proves possession), so activation only asks for the new password twice. On
 * success the temporary password's hash is overwritten — it can never work
 * again — and the account is marked activated in the same transaction.
 */
export async function activateAccount(
  currentUser: { id: string; role: string },
  input: { newPassword: string; confirmPassword: string }
): Promise<void> {
  if (currentUser.role !== "teacher") {
    throw new ForbiddenError("Only teachers activate their onboarding account here");
  }

  const newPassword = String(input.newPassword ?? "");
  const confirmPassword = String(input.confirmPassword ?? "");

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (newPassword !== confirmPassword) {
    throw new ValidationError("Passwords do not match");
  }

  const [row] = await db
    .select({
      id: users.id,
      mustChangePassword: users.mustChangePassword,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.id, currentUser.id))
    .limit(1);

  if (!row) throw new ForbiddenError("User not found");
  // Only an account still pending activation may be activated. This also stops
  // an already-activated teacher from resetting their activation timestamp.
  if (!row.mustChangePassword) {
    throw new ForbiddenError("Account is already activated");
  }

  // Reject reusing the temporary password as the permanent one.
  if (row.passwordHash && (await bcrypt.compare(newPassword, row.passwordHash))) {
    throw new ValidationError("Choose a password different from your temporary password");
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        passwordHash,
        mustChangePassword: false,
        activatedAt: now,
        updatedAt: now,
      })
      .where(eq(users.id, currentUser.id));

    await tx.insert(auditLogs).values({
      actorId: currentUser.id,
      action: "user.password_change",
      targetType: "user",
      targetId: currentUser.id,
      metadata: { activation: true },
    });
  });
}
