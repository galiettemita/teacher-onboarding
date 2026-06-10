import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guards";
import { AdminNav } from "@/components/admin/nav";
import { renderAllPreviews } from "@/lib/email/templates";

export const dynamic = "force-dynamic";

export default async function AdminRemindersPreviewPage() {
  const user = await requireAdmin();
  const previews = renderAllPreviews();

  return (
    <>
      <AdminNav email={user.email} active="reminders" />
      <main className="max-w-4xl mx-auto px-6 py-8">
        <Link
          href="/admin/reminders"
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← Back to reminders
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900 mt-3 mb-2">
          Template preview
        </h1>
        <p className="text-slate-600 mb-6">
          Each reminder type rendered against a sample teacher named &quot;Pat&quot;
          and a sample document called &quot;Teaching Credential&quot;. No emails
          are sent.
        </p>

        <div className="space-y-6">
          {previews.map((p) => (
            <article
              key={p.type}
              className="rounded-lg border border-slate-200 overflow-hidden"
            >
              <header className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex items-baseline justify-between">
                <h2 className="font-medium text-slate-900">{p.type}</h2>
                <span className="text-xs text-slate-500">
                  audience: {p.audience}
                </span>
              </header>
              <div className="px-4 py-3 border-b border-slate-200">
                <div className="text-xs text-slate-500 mb-1">Subject</div>
                <div className="text-slate-900">{p.rendered.subject}</div>
              </div>
              <div className="px-4 py-3 border-b border-slate-200">
                <div className="text-xs text-slate-500 mb-1">
                  Plain text body
                </div>
                <pre className="text-sm text-slate-800 whitespace-pre-wrap font-sans">
                  {p.rendered.text}
                </pre>
              </div>
              <details className="px-4 py-3">
                <summary className="text-xs text-slate-500 cursor-pointer">
                  HTML body (source)
                </summary>
                <pre className="text-xs text-slate-700 whitespace-pre-wrap mt-2 font-mono">
                  {p.rendered.html}
                </pre>
              </details>
            </article>
          ))}
        </div>
      </main>
    </>
  );
}
