import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guards";
import { AdminNav } from "@/components/admin/nav";
import { InviteTeacherForm } from "@/components/admin/invite-teacher-form";

export default async function NewTeacherPage() {
  const user = await requireAdmin();

  return (
    <>
      <AdminNav email={user.email} active="teachers" />
      <main className="flex-1 p-6 max-w-6xl mx-auto w-full">
        <div className="mb-4">
          <Link href="/admin/teachers" className="text-sm text-blue-700 hover:underline">
            ← Back to teachers
          </Link>
        </div>
        <h1 className="text-2xl font-semibold text-slate-900 mb-2">Invite a teacher</h1>
        <p className="text-slate-600 mb-6 max-w-xl text-sm">
          Creating a teacher account adds them to the portal. They&apos;ll sign in with
          their email — the admin handles password / magic-link delivery.
        </p>
        <InviteTeacherForm />
      </main>
    </>
  );
}
