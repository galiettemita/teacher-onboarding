import Link from "next/link";
import { signOut } from "@/lib/auth/config";

interface AdminNavProps {
  email: string;
  active?:
    | "dashboard"
    | "teachers"
    | "doc-types"
    | "reports"
    | "audit";
}

const NAV_ITEMS = [
  { key: "dashboard" as const, href: "/admin/dashboard", label: "Dashboard" },
  { key: "teachers" as const, href: "/admin/teachers", label: "Teachers" },
  { key: "doc-types" as const, href: "/admin/document-types", label: "Document types" },
  { key: "reports" as const, href: "/admin/reports", label: "Reports" },
  { key: "audit" as const, href: "/admin/audit", label: "Audit" },
];

export function AdminNav({ email, active }: AdminNavProps) {
  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <nav className="flex items-center gap-6">
          <span className="font-semibold text-slate-900">Onboarding Admin</span>
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={
                "text-sm " +
                (active === item.key
                  ? "text-blue-700 font-medium"
                  : "text-slate-600 hover:text-slate-900")
              }
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <form action={logout} className="flex items-center gap-3">
          <span className="text-sm text-slate-500">{email}</span>
          <button
            type="submit"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
