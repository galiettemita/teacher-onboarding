import { requireTeacher } from "@/lib/auth/guards";
import { signOut } from "@/lib/auth/config";

export default async function TeacherDashboard() {
  const user = await requireTeacher();

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <main className="flex-1 p-6 max-w-3xl mx-auto w-full">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Welcome, {user.name}</h1>
          <p className="text-slate-600">Teacher dashboard (placeholder)</p>
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
        <h2 className="text-lg font-medium text-slate-900 mb-2">Your documents</h2>
        <p className="text-slate-600">
          Phase 2 will render your required documents here with upload buttons and status
          badges (missing / pending / approved / rejected / expired).
        </p>
      </section>
    </main>
  );
}
