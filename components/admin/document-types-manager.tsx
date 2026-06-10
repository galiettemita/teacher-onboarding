"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface DocType {
  id: string;
  name: string;
  description: string | null;
  required: boolean;
  renewalMonths: number;
  active: boolean;
}

interface DraftRow {
  name: string;
  description: string;
  required: boolean;
  renewalMonths: number;
}

const EMPTY_DRAFT: DraftRow = {
  name: "",
  description: "",
  required: true,
  renewalMonths: 24,
};

function DraftRowEditor({
  draft,
  setDraft,
  onSave,
  onCancel,
  saveLabel,
  busy,
}: {
  draft: DraftRow;
  setDraft: (d: DraftRow) => void;
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
  busy: boolean;
}) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Name</label>
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Renewal (months, 0 = one-time)
          </label>
          <input
            type="number"
            min={0}
            max={120}
            value={draft.renewalMonths}
            onChange={(e) =>
              setDraft({
                ...draft,
                renewalMonths: Number.parseInt(e.target.value || "0", 10),
              })
            }
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">Description</label>
        <textarea
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          rows={2}
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={draft.required}
          onChange={(e) => setDraft({ ...draft, required: e.target.checked })}
        />
        Required for completion
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={busy || draft.name.trim().length === 0}
          className="rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-1.5 disabled:opacity-50"
        >
          {saveLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-slate-300 text-sm font-medium px-3 py-1.5 hover:bg-white"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function DocumentTypesManager({ initial }: { initial: DocType[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [rows, setRows] = useState<DocType[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [newDraft, setNewDraft] = useState<DraftRow>(EMPTY_DRAFT);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<DraftRow>(EMPTY_DRAFT);

  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);

  function reset() {
    setError(null);
    setCreating(false);
    setNewDraft(EMPTY_DRAFT);
    setEditingId(null);
    setEditDraft(EMPTY_DRAFT);
    setConfirmDeactivateId(null);
  }

  async function refresh() {
    const res = await fetch("/api/admin/document-types", { cache: "no-store" });
    if (res.ok) {
      const next = (await res.json()) as DocType[];
      setRows(next);
    }
    startTransition(() => router.refresh());
  }

  async function submitCreate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/document-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newDraft),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? `Failed (${res.status})`);
        return;
      }
      reset();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function submitEdit(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/document-types/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editDraft),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? `Failed (${res.status})`);
        return;
      }
      reset();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function submitDeactivate(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/document-types/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? `Failed (${res.status})`);
        return;
      }
      reset();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  function startEdit(t: DocType) {
    setEditingId(t.id);
    setEditDraft({
      name: t.name,
      description: t.description ?? "",
      required: t.required,
      renewalMonths: t.renewalMonths,
    });
    setError(null);
  }

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="rounded-md bg-red-50 border border-red-200 text-red-800 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {creating ? (
        <DraftRowEditor
          draft={newDraft}
          setDraft={setNewDraft}
          onSave={submitCreate}
          onCancel={reset}
          saveLabel="Create"
          busy={busy}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setCreating(true);
            setNewDraft(EMPTY_DRAFT);
            setError(null);
          }}
          className="rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2"
        >
          New document type
        </button>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Name</th>
              <th className="text-left px-4 py-3 font-medium">Required</th>
              <th className="text-left px-4 py-3 font-medium">Renewal</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  No document types yet. Create one above.
                </td>
              </tr>
            ) : (
              rows.map((t) => {
                if (editingId === t.id) {
                  return (
                    <tr key={t.id} className="border-t border-slate-100">
                      <td colSpan={5} className="px-4 py-3">
                        <DraftRowEditor
                          draft={editDraft}
                          setDraft={setEditDraft}
                          onSave={() => submitEdit(t.id)}
                          onCancel={reset}
                          saveLabel="Save"
                          busy={busy}
                        />
                      </td>
                    </tr>
                  );
                }
                if (confirmDeactivateId === t.id) {
                  return (
                    <tr key={t.id} className="border-t border-slate-100 bg-amber-50">
                      <td colSpan={5} className="px-4 py-3">
                        <p className="text-sm text-amber-900 mb-2">
                          Deactivate <span className="font-medium">{t.name}</span>?
                          This will hide the type from teachers but keep their history.
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => submitDeactivate(t.id)}
                            disabled={busy}
                            className="rounded-md bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium px-3 py-1.5 disabled:opacity-50"
                          >
                            Confirm deactivate
                          </button>
                          <button
                            type="button"
                            onClick={reset}
                            disabled={busy}
                            className="rounded-md border border-slate-300 text-sm font-medium px-3 py-1.5 hover:bg-white"
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={t.id} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{t.name}</div>
                      {t.description && (
                        <div className="text-xs text-slate-500">{t.description}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {t.required ? "Yes" : "No"}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {t.renewalMonths === 0 ? "One-time" : `${t.renewalMonths} months`}
                    </td>
                    <td className="px-4 py-3">
                      {t.active ? (
                        <span className="inline-flex items-center rounded-full bg-green-100 text-green-800 border border-green-200 px-2 py-0.5 text-xs font-medium">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-slate-200 text-slate-700 border border-slate-300 px-2 py-0.5 text-xs font-medium">
                          Deactivated
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-3 justify-end">
                        <button
                          type="button"
                          onClick={() => startEdit(t)}
                          className="text-blue-700 hover:underline text-sm"
                        >
                          Edit
                        </button>
                        {t.active && (
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmDeactivateId(t.id);
                              setError(null);
                            }}
                            className="text-amber-700 hover:underline text-sm"
                          >
                            Deactivate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
