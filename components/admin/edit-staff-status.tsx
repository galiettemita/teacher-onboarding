"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type StaffStatus = "new_first_year" | "returning";

/**
 * Inline editor for a teacher's staff status + first-year start date. Admin-only
 * (the PATCH route enforces the role server-side). Plain-English labels, no jargon.
 */
export function EditStaffStatus({
  teacherId,
  initialStatus,
  initialFirstYearStart,
}: {
  teacherId: string;
  initialStatus: StaffStatus;
  initialFirstYearStart: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<StaffStatus>(initialStatus);
  const [firstYearStart, setFirstYearStart] = useState(initialFirstYearStart ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, string | null> = { staffStatus: status };
      payload.firstYearStartDate = firstYearStart.trim() || null;
      const res = await fetch(`/api/admin/teachers/${teacherId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? `Failed (${res.status})`);
        return;
      }
      setOpen(false);
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-blue-700 hover:underline text-sm"
      >
        Change
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3 space-y-3 max-w-md">
      {error && (
        <div role="alert" className="rounded-md bg-red-50 border border-red-200 text-red-800 px-3 py-2 text-sm">
          {error}
        </div>
      )}
      <div className="space-y-2">
        <label className="flex items-start gap-2 text-sm text-slate-800">
          <input
            type="radio"
            name="staff-status"
            className="mt-1"
            checked={status === "new_first_year"}
            onChange={() => setStatus("new_first_year")}
          />
          <span>
            <span className="font-medium">New first-year staff</span>
            <span className="block text-xs text-slate-500">
              Asked for first-year-only documents until the first year ends.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm text-slate-800">
          <input
            type="radio"
            name="staff-status"
            className="mt-1"
            checked={status === "returning"}
            onChange={() => setStatus("returning")}
          />
          <span>
            <span className="font-medium">Returning staff</span>
            <span className="block text-xs text-slate-500">
              Skips first-year-only documents.
            </span>
          </span>
        </label>
      </div>
      <div>
        <label htmlFor="first-year-start" className="block text-xs font-medium text-slate-700 mb-1">
          First year started on (optional — defaults to hire date)
        </label>
        <input
          id="first-year-start"
          type="date"
          value={firstYearStart}
          onChange={(e) => setFirstYearStart(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-1.5 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className="rounded-md border border-slate-300 text-sm font-medium px-3 py-1.5 hover:bg-white"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
