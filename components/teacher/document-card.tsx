"use client";

import { useState } from "react";
import type { DocumentTypeWithStatus } from "@/lib/db/queries/teacher-documents";
import { StatusBadge } from "@/components/status-badge";
import { UploadModal } from "@/components/upload/upload-modal";
import { getDocumentResources } from "@/lib/teacher/document-resources";

/**
 * One card per `document_type`. Client component so the upload modal can
 * own its own open/close state without round-tripping to the server. The
 * underlying data is still server-rendered on the parent page.
 */
export type DocumentCardProps = {
  entry: DocumentTypeWithStatus;
};

export function DocumentCard({ entry }: DocumentCardProps) {
  const { documentType, currentDoc, uiStatus } = entry;
  const [open, setOpen] = useState(false);
  const { note, links } = getDocumentResources(documentType.name);

  const primaryLabel =
    uiStatus === "missing"
      ? "Upload"
      : uiStatus === "rejected"
      ? "Re-upload"
      : uiStatus === "expired" || uiStatus === "expiring_soon"
      ? "Renew"
      : "Replace";

  return (
    <article className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            {documentType.name}
          </h3>
          {documentType.description && (
            <p className="mt-1 text-sm text-slate-600">{documentType.description}</p>
          )}
        </div>
        <StatusBadge status={uiStatus} />
      </div>

      {note && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {note}
        </p>
      )}

      {links.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {links.map((l) => (
            <li key={l.url}>
              <a
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-blue-700 underline hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {l.label}
                <span aria-hidden="true">↗</span>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
      )}

      {uiStatus === "rejected" && currentDoc?.rejectionReason && (
        <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <span className="font-medium">Reason: </span>
          {currentDoc.rejectionReason}
        </p>
      )}

      {currentDoc && uiStatus === "approved" && currentDoc.expiresAt && (
        <p className="mt-3 text-sm text-slate-600">
          Your {documentType.name} expires on {formatDate(currentDoc.expiresAt)}.
        </p>
      )}

      {currentDoc && uiStatus === "expiring_soon" && currentDoc.expiresAt && (
        <p className="mt-3 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900">
          Your {documentType.name} expires on {formatDate(currentDoc.expiresAt)}. Please
          upload an updated copy before it expires.
        </p>
      )}

      {currentDoc && uiStatus === "expired" && (
        <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          Your {documentType.name}
          {currentDoc.expiresAt ? ` expired on ${formatDate(currentDoc.expiresAt)}` : " has expired"}.
          Please upload a new copy to stay up to date.
        </p>
      )}

      <div className="mt-4 flex items-center justify-between">
        <div className="text-xs text-slate-500">
          {documentType.required ? "Required" : "Optional"}
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md bg-blue-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
        >
          {primaryLabel}
        </button>
      </div>

      <UploadModal
        open={open}
        onClose={() => setOpen(false)}
        documentTypeId={documentType.id}
        documentTypeName={documentType.name}
      />
    </article>
  );
}

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
