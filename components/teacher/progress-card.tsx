import type { DocumentTypeWithStatus } from "@/lib/db/queries/teacher-documents";

/**
 * Top-of-dashboard progress summary. Counts approved REQUIRED docs against
 * total REQUIRED docs. Optional docs don't gate "completion".
 */
export function ProgressCard({
  entries,
}: {
  entries: DocumentTypeWithStatus[];
}) {
  const required = entries.filter((e) => e.documentType.required);
  const approved = required.filter((e) => e.uiStatus === "approved").length;
  const total = required.length;
  const pct = total === 0 ? 0 : Math.round((approved / total) * 100);

  return (
    <section
      aria-label="Onboarding progress"
      className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold text-slate-900">Your progress</h2>
        <p className="text-sm text-slate-600">
          <span className="text-2xl font-semibold text-slate-900">{approved}</span>{" "}
          of {total} required documents approved
        </p>
      </div>
      <div
        className="mt-4 h-3 w-full overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${pct}% of required documents approved`}
      >
        <div
          className="h-full bg-emerald-500 transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
    </section>
  );
}
