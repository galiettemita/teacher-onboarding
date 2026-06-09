import type { UiStatus } from "@/lib/db/queries/teacher-documents";

/**
 * Pure visual badge for a derived document status.
 *
 * API is intentionally minimal: `<StatusBadge status={status} />`. The
 * underlying status union is the full `UiStatus` from the queries module
 * (missing | pending | approved | rejected | expired | expiring_soon).
 *
 * Agent 3's admin views render raw DB statuses (without the UI-derived
 * `expiring_soon` / `missing` extensions); the `DocStatus` re-export below
 * keeps that call site type-safe. New callers should prefer `UiStatus`.
 */
export type DocStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "missing";

export type StatusBadgeStatus = UiStatus;

export type StatusBadgeProps = {
  status: StatusBadgeStatus;
  className?: string;
};

const STYLES: Record<
  StatusBadgeStatus,
  { label: string; classes: string; dot: string }
> = {
  missing: {
    label: "Not uploaded",
    classes: "bg-slate-100 text-slate-700 border-slate-200",
    dot: "bg-slate-400",
  },
  pending: {
    label: "Pending review",
    classes: "bg-amber-50 text-amber-800 border-amber-200",
    dot: "bg-amber-500",
  },
  approved: {
    label: "Approved",
    classes: "bg-emerald-50 text-emerald-800 border-emerald-200",
    dot: "bg-emerald-500",
  },
  rejected: {
    label: "Rejected",
    classes: "bg-rose-50 text-rose-800 border-rose-200",
    dot: "bg-rose-500",
  },
  expired: {
    label: "Expired",
    classes: "bg-rose-50 text-rose-800 border-rose-200",
    dot: "bg-rose-500",
  },
  expiring_soon: {
    label: "Expiring soon",
    classes: "bg-orange-50 text-orange-800 border-orange-200",
    dot: "bg-orange-500",
  },
};

export function StatusBadge({ status, className = "" }: StatusBadgeProps) {
  const s = STYLES[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${s.classes} ${className}`}
      aria-label={`Status: ${s.label}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
      {s.label}
    </span>
  );
}
