"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ReinviteResult {
  email: string;
  loginUrl: string;
  temporaryPassword: string;
  invitation: { subject: string; text: string };
}

/**
 * Admin control to re-invite a teacher who has not activated their account.
 * Posts to the re-invite endpoint, which generates a fresh temporary password
 * (invalidating the previous one), then shows the copyable invitation.
 */
export function ReinviteTeacher({ teacherId }: { teacherId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReinviteResult | null>(null);
  const [copied, setCopied] = useState(false);

  async function reinvite() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/teachers/${teacherId}/reinvite`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? `Request failed (${res.status})`);
        return;
      }
      setResult(body);
      setCopied(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const copyText = `Subject: ${result.invitation.subject}\n\n${result.invitation.text}`;
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-medium">New temporary password generated.</p>
        <p className="mt-1">
          The previous temporary password no longer works. Send this invitation to the teacher —
          the password is shown once.
        </p>
        <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 font-mono text-xs text-slate-900">
          <dt className="text-amber-800">Login URL</dt>
          <dd className="break-all">{result.loginUrl}</dd>
          <dt className="text-amber-800">Email</dt>
          <dd className="break-all">{result.email}</dd>
          <dt className="text-amber-800">Temp password</dt>
          <dd className="break-all">{result.temporaryPassword}</dd>
        </dl>
        <textarea
          readOnly
          value={copyText}
          rows={12}
          aria-label="Ready-to-send invitation"
          className="mt-3 w-full rounded-md border border-amber-200 bg-white p-3 font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
        />
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(copyText);
            setCopied(true);
          }}
          className="mt-3 rounded-md bg-amber-700 px-3 py-2 text-sm font-medium text-white hover:bg-amber-800"
        >
          {copied ? "Copied" : "Copy invitation"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={reinvite}
        disabled={busy}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50"
      >
        {busy ? "Generating…" : "Re-invite (new temporary password)"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
