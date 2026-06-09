"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface ReviewActionsProps {
  documentId: string;
}

/**
 * Approve / Reject buttons for a single pending document row.
 *
 * Reject opens an inline form requiring a non-empty reason — both client and
 * server validate. The server is the authority (see /api/admin/documents/[id]).
 */
export function ReviewActions({ documentId }: ReviewActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function send(action: "approve" | "reject", extra?: { reason?: string }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(extra ?? {}) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? `Request failed (${res.status})`);
        return;
      }
      setRejecting(false);
      setReason("");
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  if (rejecting) {
    const trimmed = reason.trim();
    return (
      <div className="border border-red-200 bg-red-50 rounded-md p-3 max-w-md">
        <label className="block text-sm font-medium text-red-900 mb-1">
          Reason for rejection
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-red-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          placeholder="What does the teacher need to fix?"
          autoFocus
        />
        {error && <div className="mt-1 text-xs text-red-700">{error}</div>}
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => send("reject", { reason: trimmed })}
            disabled={busy || isPending || trimmed.length === 0}
            className="rounded-md bg-red-600 text-white text-sm font-medium px-3 py-1.5 hover:bg-red-700 disabled:opacity-50"
          >
            Confirm reject
          </button>
          <button
            type="button"
            onClick={() => {
              setRejecting(false);
              setReason("");
              setError(null);
            }}
            disabled={busy || isPending}
            className="rounded-md border border-slate-300 text-sm font-medium px-3 py-1.5 hover:bg-white"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => send("approve")}
        disabled={busy || isPending}
        className="rounded-md bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-3 py-1.5 disabled:opacity-50"
      >
        Approve
      </button>
      <button
        type="button"
        onClick={() => setRejecting(true)}
        disabled={busy || isPending}
        className="rounded-md border border-red-300 text-red-700 hover:bg-red-50 text-sm font-medium px-3 py-1.5 disabled:opacity-50"
      >
        Reject
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
