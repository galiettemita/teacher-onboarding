import { redirect } from "next/navigation";
import { requireTeacher } from "@/lib/auth/guards";
import { activateAccount, getActivationStatus } from "@/lib/db/queries/activation";
import { ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export default async function ActivateAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireTeacher();
  const status = await getActivationStatus(user.id);
  // Already activated — nothing to do here.
  if (!status.mustChangePassword) redirect("/teacher/dashboard");

  const params = await searchParams;
  const error = params.error;

  async function activateAction(formData: FormData) {
    "use server";
    const currentUser = await requireTeacher();

    try {
      await activateAccount(currentUser, {
        newPassword: String(formData.get("newPassword") ?? ""),
        confirmPassword: String(formData.get("confirmPassword") ?? ""),
      });
    } catch (err) {
      const message = err instanceof ValidationError ? err.message : "Could not activate your account";
      redirect(`/teacher/activate?error=${encodeURIComponent(message)}`);
    }

    redirect("/teacher/dashboard");
  }

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow">
        <h1 className="text-2xl font-semibold text-slate-900">Activate your account</h1>
        <p className="mt-2 text-sm text-slate-600">
          Welcome! Create your own password to finish setting up your account. You&apos;ll use
          it to sign in from now on — the temporary password from your invitation will stop working.
        </p>

        {error ? (
          <div
            role="alert"
            className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {error}
          </div>
        ) : null}

        <form action={activateAction} className="mt-6 space-y-4">
          <div>
            <label htmlFor="newPassword" className="mb-1 block text-sm font-medium text-slate-700">
              New password
            </label>
            <input
              id="newPassword"
              name="newPassword"
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              className="w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-slate-500">Use at least 12 characters.</p>
          </div>

          <div>
            <label htmlFor="confirmPassword" className="mb-1 block text-sm font-medium text-slate-700">
              Confirm password
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              className="w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-md bg-blue-600 py-2.5 font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Activate account
          </button>
        </form>
      </div>
    </main>
  );
}
