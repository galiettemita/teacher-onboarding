import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-md text-center bg-white rounded-xl shadow border border-slate-200 p-8">
        <h1 className="text-2xl font-semibold text-slate-900 mb-2">Access denied</h1>
        <p className="text-slate-600 mb-6">
          You don&apos;t have permission to view that page.
        </p>
        <Link
          href="/"
          className="inline-block rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2"
        >
          Go to your dashboard
        </Link>
      </div>
    </main>
  );
}
