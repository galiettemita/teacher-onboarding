"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Modal dialog wrapping the file <input>. Posts to `/api/upload` and shows
 * a loading state until the request resolves, then refreshes the server
 * data (so the dashboard re-renders with the new pending row).
 *
 * Grandma-friendly notes:
 *  - Large hit targets, plain English labels
 *  - Loading state on submit so nobody wonders if their click registered
 *  - Inline error text explains what to do next
 *  - Esc and the X button both close; focus trapped inside the dialog
 */
const ACCEPT = "application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png";
const MAX_MB = 10;

export type UploadModalProps = {
  documentTypeId: string;
  documentTypeName: string;
  open: boolean;
  onClose: () => void;
};

type Submitting = { state: "idle" } | { state: "uploading" } | { state: "error"; message: string };

export function UploadModal({
  documentTypeId,
  documentTypeName,
  open,
  onClose,
}: UploadModalProps) {
  const router = useRouter();
  const fileInputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [submitting, setSubmitting] = useState<Submitting>({ state: "idle" });
  const [selectedName, setSelectedName] = useState<string>("");

  // Reset state when the dialog opens.
  useEffect(() => {
    if (open) {
      setSubmitting({ state: "idle" });
      setSelectedName("");
      // focus the file input shortly after mount so screen readers announce it
      setTimeout(() => fileRef.current?.focus(), 50);
    }
  }, [open]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && submitting.state !== "uploading") {
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, submitting.state]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setSubmitting({ state: "error", message: "Choose a file to upload." });
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setSubmitting({
        state: "error",
        message: `That file is over ${MAX_MB} MB. Please choose a smaller file.`,
      });
      return;
    }

    setSubmitting({ state: "uploading" });

    const fd = new FormData();
    fd.set("document_type_id", documentTypeId);
    fd.set("file", file);

    let res: Response;
    try {
      res = await fetch("/api/upload", { method: "POST", body: fd });
    } catch {
      setSubmitting({
        state: "error",
        message: "Network problem. Please check your connection and try again.",
      });
      return;
    }

    if (res.status === 201) {
      onClose();
      router.refresh();
      return;
    }

    const message = await readError(res);
    setSubmitting({ state: "error", message });
  }

  const isUploading = submitting.state === "uploading";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isUploading) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="upload-modal-title" className="text-lg font-semibold text-slate-900">
            Upload: {documentTypeName}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isUploading}
            aria-label="Close upload dialog"
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <p className="mt-2 text-sm text-slate-600">
          PDF, JPG, or PNG up to {MAX_MB} MB.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label
              htmlFor={fileInputId}
              className="block text-sm font-medium text-slate-700"
            >
              Choose a file
            </label>
            <input
              ref={fileRef}
              id={fileInputId}
              name="file"
              type="file"
              accept={ACCEPT}
              required
              disabled={isUploading}
              onChange={(e) => {
                setSelectedName(e.target.files?.[0]?.name ?? "");
                setSubmitting({ state: "idle" });
              }}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />
            {selectedName && (
              <p className="mt-1 text-xs text-slate-500" aria-live="polite">
                Selected: {selectedName}
              </p>
            )}
          </div>

          {submitting.state === "error" && (
            <p
              role="alert"
              className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"
            >
              {submitting.message}
            </p>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isUploading}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isUploading}
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
            >
              {isUploading && (
                <span
                  aria-hidden="true"
                  className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent"
                />
              )}
              {isUploading ? "Uploading…" : "Upload"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Map server error statuses to a sentence a grandma can act on. */
async function readError(res: Response): Promise<string> {
  let payload: { error?: string; reason?: string; maxBytes?: number } = {};
  try {
    payload = await res.json();
  } catch {
    // ignore — fall through to status-based message
  }
  switch (res.status) {
    case 401:
      return "You were signed out. Please log in and try again.";
    case 403:
      return "You don't have permission to upload here.";
    case 413:
      return `That file is too big. The limit is ${MAX_MB} MB.`;
    case 415:
      return payload.reason === "corrupt"
        ? "That file looks damaged. Try saving it again and re-uploading."
        : "Only PDF, JPG, and PNG files are accepted.";
    case 400:
      return payload.error ?? "Something is wrong with the form. Please try again.";
    case 404:
      return "This document type is no longer available. Refresh the page.";
    default:
      return "Upload failed. Please try again in a moment.";
  }
}
