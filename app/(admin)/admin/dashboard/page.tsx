import { requireAdmin } from "@/lib/auth/guards";
import { signOut } from "@/lib/auth/config";

export default async function AdminDashboard() {
  const user = await requireAdmin();

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Admin</h1>
          <p className="text-slate-600">Signed in as {user.email}</p>
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
          >
            Sign out
          </button>
        </form>
      </header>

      <section className="bg-white rounded-xl shadow border border-slate-200 p-6">
        <h2 className="text-lg font-medium text-slate-900 mb-2">Overview</h2>
        <p className="text-slate-600">
          Phase 3 will render the teacher list, completion percentages, and approve/reject
          flow here. Phase 5 adds CSV export and the audit log viewer.
        </p>
      </section>
    </main>
  );
}
