import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth/config";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; from?: string }>;
}) {
  const session = await auth();
  if (session?.user?.id) {
    redirect(session.user.role === "admin" ? "/admin/dashboard" : "/teacher/dashboard");
  }
  const params = await searchParams;
  const error = params.error;

  async function loginAction(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");

    // signIn throws a redirect on success. We hand it the role-aware
    // landing pages; Auth.js will route based on the credentials handler.
    await signIn("credentials", {
      email,
      password,
      redirectTo: "/",
    });
  }

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-xl shadow border border-slate-200 p-8">
        <h1 className="text-2xl font-semibold text-slate-900 mb-1">Sign in</h1>
        <p className="text-slate-600 mb-6">
          Use the credentials your school administrator provided.
        </p>

        {error ? (
          <div
            role="alert"
            className="mb-4 rounded-md bg-red-50 border border-red-200 text-red-800 px-3 py-2 text-sm"
          >
            Could not sign in. Check your email and password.
          </div>
        ) : null}

        <form action={loginAction} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5"
          >
            Sign in
          </button>
        </form>

        <p className="mt-6 text-xs text-slate-500">
          Trouble signing in? Contact your school administrator.
        </p>
      </div>
    </main>
  );
}
