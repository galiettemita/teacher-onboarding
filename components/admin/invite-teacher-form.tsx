"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface FormState {
  email: string;
  name: string;
  phone: string;
  hireDate: string;
  gradeLevel: string;
}

const EMPTY: FormState = {
  email: "",
  name: "",
  phone: "",
  hireDate: "",
  gradeLevel: "",
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
    inviteEmailSent: boolean;
  } | null>(null);

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
    return (
      <div className="bg-white border border-green-200 rounded-xl p-6">
        <h2 className="text-lg font-medium text-green-900">Teacher created</h2>
        <p className="text-sm text-slate-700 mt-1">
          Account created for <span className="font-medium">{success.email}</span>.
        </p>
        {success.inviteEmailSent ? (
          <p className="text-sm text-slate-700 mt-2">A magic-link invite email has been sent.</p>
        ) : (
          <p className="text-sm text-amber-800 mt-2 bg-amber-50 border border-amber-200 rounded-md p-3">
            Invite email delivery is not yet enabled in this environment. Share the
            login URL and a temporary credential with the teacher out-of-band until
            the email provider is configured (Phase 6).
          </p>
        )}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setSuccess(null)}
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

      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create teacher"}
      </button>
    </form>
  );
}
