"use client";

import { useState } from "react";

/**
 * Renders a copyable renewal-reminder email draft for one teacher. The draft is
 * computed on the server (only that teacher's expired / expiring-soon docs) and
 * passed in as `subject` + `text`. Nothing is sent — the admin copies and sends
 * it out of band, matching the portal's email-free invitation flow.
 *
 * When `subject`/`text` are null, there is nothing expiring → show a calm note.
 */
export function ExpirationEmailDraft({
  subject,
  text,
}: {
  subject: string | null;
  text: string | null;
}) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!subject || !text) {
    return (
      <p className="text-sm text-slate-600">
        No reminder needed — none of this teacher&apos;s documents are expired or expiring
        soon.
      </p>
    );
  }

  const copyText = `Subject: ${subject}\n\n${text}`;

  if (!shown) {
    return (
      <button
        type="button"
        onClick={() => setShown(true)}
        className="rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2"
      >
        Generate expiration email draft
      </button>
    );
  }

  return (
    <div className="space-y-3 max-w-2xl">
      <textarea
        readOnly
        value={copyText}
        rows={14}
        className="w-full rounded-md border border-slate-200 bg-white p-3 font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(copyText);
            setCopied(true);
          }}
          className="rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2"
        >
          {copied ? "Copied" : "Copy email draft"}
        </button>
        <button
          type="button"
          onClick={() => {
            setShown(false);
            setCopied(false);
          }}
          className="rounded-md border border-slate-300 text-sm font-medium px-4 py-2 hover:bg-slate-100"
        >
          Hide
        </button>
      </div>
    </div>
  );
}
