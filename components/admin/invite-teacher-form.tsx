"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface FormState {
  email: string;
  name: string;
  phone: string;
  hireDate: string;
  gradeLevel: string;
  staffStatus: "new_first_year" | "returning";
}

const EMPTY: FormState = {
  email: "",
  name: "",
  phone: "",
  hireDate: "",
  gradeLevel: "",
  staffStatus: "returning",
};

export function InviteTeacherForm() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    id: string;
    email: string;
    name: string;
    loginUrl: string;
    temporaryPassword: string;
    invitation: { subject: string; text: string };
  } | null>(null);
  const [copied, setCopied] = useState(false);

  function update<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const payload: Record<string, string> = {
      email: form.email.trim().toLowerCase(),
      name: form.name.trim(),
    };
    if (form.phone.trim()) payload.phone = form.phone.trim();
    if (form.hireDate.trim()) payload.hireDate = form.hireDate.trim();
    if (form.gradeLevel.trim()) payload.gradeLevel = form.gradeLevel.trim();
    payload.staffStatus = form.staffStatus;

    try {
      const res = await fetch("/api/admin/teachers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? `Request failed (${res.status})`);
        return;
      }
      setSuccess(body);
      setForm(EMPTY);
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  if (success) {
    const copyText = `Subject: ${success.invitation.subject}\n\n${success.invitation.text}`;

    return (
      <div className="bg-white border border-green-200 rounded-xl p-6 max-w-2xl">
        <h2 className="text-lg font-medium text-green-900">Teacher invited</h2>
        <p className="text-sm text-slate-700 mt-1">
          Account created for <span className="font-medium">{success.email}</span>. They&apos;re
          pending activation until they sign in and create their own password.
        </p>

        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">Send this invitation to the teacher.</p>
          <p className="mt-1">
            The temporary password is shown once, here, and is not stored in readable form —
            copy it now. The teacher must change it the first time they sign in.
          </p>

          <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 font-mono text-xs text-slate-900">
            <dt className="text-amber-800">Login URL</dt>
            <dd className="break-all">{success.loginUrl}</dd>
            <dt className="text-amber-800">Email</dt>
            <dd className="break-all">{success.email}</dd>
            <dt className="text-amber-800">Temp password</dt>
            <dd className="break-all">{success.temporaryPassword}</dd>
          </dl>

          <div className="mt-3 space-y-2">
            <label htmlFor="teacher-invitation" className="block font-medium text-amber-950">
              Ready-to-send invitation
            </label>
            <textarea
              id="teacher-invitation"
              readOnly
              value={copyText}
              rows={12}
              className="w-full rounded-md border border-amber-200 bg-white p-3 font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
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

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => {
              setSuccess(null);
              setCopied(false);
            }}
            className="rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2"
          >
            Invite another
          </button>
          <a
            href={`/admin/teachers/${success.id}`}
            className="rounded-md border border-slate-300 text-sm font-medium px-4 py-2 hover:bg-slate-100"
          >
            View teacher
          </a>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 max-w-xl"
    >
      {error && (
        <div role="alert" className="rounded-md bg-red-50 border border-red-200 text-red-800 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-1">
          Name <span className="text-red-600">*</span>
        </label>
        <input
          id="name"
          required
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
          Email <span className="text-red-600">*</span>
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="off"
          value={form.email}
          onChange={(e) => update("email", e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-slate-700 mb-1">
            Phone
          </label>
          <input
            id="phone"
            value={form.phone}
            onChange={(e) => update("phone", e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="hireDate" className="block text-sm font-medium text-slate-700 mb-1">
            Hire date
          </label>
          <input
            id="hireDate"
            type="date"
            value={form.hireDate}
            onChange={(e) => update("hireDate", e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="gradeLevel" className="block text-sm font-medium text-slate-700 mb-1">
            Grade level
          </label>
          <input
            id="gradeLevel"
            value={form.gradeLevel}
            onChange={(e) => update("gradeLevel", e.target.value)}
            placeholder="K, 1, 2..."
            className="w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <fieldset className="rounded-md border border-slate-200 p-4">
        <legend className="px-1 text-sm font-medium text-slate-700">
          Is this a new or current staff member?
        </legend>
        <p className="text-xs text-slate-500 mb-3">
          New staff are asked for all onboarding forms (including the Fingerprinting
          receipt and High school Diploma/ College Degree). Current staff only need the
          Medical Form and the two Health &amp; Safety / Mandated Reporter certificates.
        </p>
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm text-slate-800">
            <input
              type="radio"
              name="staffStatus"
              className="mt-1"
              checked={form.staffStatus === "new_first_year"}
              onChange={() => update("staffStatus", "new_first_year")}
            />
            <span>
              <span className="font-medium">New Staff</span>
              <span className="block text-xs text-slate-500">
                A new hire being onboarded — asked for all 5 forms. Uses the hire date
                above to know when their first year ends.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-800">
            <input
              type="radio"
              name="staffStatus"
              className="mt-1"
              checked={form.staffStatus === "returning"}
              onChange={() => update("staffStatus", "returning")}
            />
            <span>
              <span className="font-medium">Current Staff</span>
              <span className="block text-xs text-slate-500">
                Returning/established staff — only asked for the Medical Form and the two
                certificates.
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 disabled:opacity-50"
      >
        {busy ? "Inviting…" : "Invite teacher"}
      </button>
    </form>
  );
}
