import { redirect } from "next/navigation";
import { auth } from "./config";
import type { AppRole } from "./config";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: AppRole;
};

/** Returns the session or null. Use for optional auth. */
export async function getSession() {
  return auth();
}

/** Server component / route helper: require ANY authenticated user. */
export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role) {
    redirect("/login");
  }
  return {
    id: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name ?? "",
    role: session.user.role,
  };
}

/** Server component / route helper: require an admin. Teachers get redirected to /unauthorized. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/unauthorized");
  return user;
}

/** Server component / route helper: require a teacher. */
export async function requireTeacher(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "teacher") redirect("/unauthorized");
  return user;
}
