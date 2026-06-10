import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import { AdminNav } from "@/components/admin/nav";
import {
  getReminderSettings,
  updateReminderSettings,
} from "@/lib/db/queries/reminder-settings";
import { ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

function parseIntList(raw: string): number[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isFinite(n));
}

function toIntOrThrow(raw: string, field: string, min: number, max: number): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new ValidationError(`${field} must be ${min}-${max}`);
  }
  return n;
}

export default async function AdminRemindersSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const user = await requireAdmin();
  const settings = await getReminderSettings();
  const params = await searchParams;

  async function save(formData: FormData) {
    "use server";
    const actor = await requireAdmin();
    try {
      const patch = {
        enabled: formData.get("enabled") === "on",
        senderName: String(formData.get("senderName") ?? "").trim(),
        senderEmail: String(formData.get("senderEmail") ?? "").trim(),
        portalUrl: String(formData.get("portalUrl") ?? "").trim(),
        reminderDaysBeforeExpiration: parseIntList(
          String(formData.get("reminderDaysBeforeExpiration") ?? "")
        ),
        postExpirationIntervalDays: toIntOrThrow(
          String(formData.get("postExpirationIntervalDays") ?? ""),
          "postExpirationIntervalDays",
          1,
          365
        ),
        maxOneEmailPerTeacherPerDay:
          formData.get("maxOneEmailPerTeacherPerDay") === "on",
        pendingReviewDaysBeforeAdminAlert: (() => {
          const raw = String(formData.get("pendingReviewDaysBeforeAdminAlert") ?? "").trim();
          if (raw === "") return null;
          return toIntOrThrow(raw, "pendingReviewDaysBeforeAdminAlert", 1, 365);
        })(),
        missingDocReminderIntervalDays: toIntOrThrow(
          String(formData.get("missingDocReminderIntervalDays") ?? ""),
          "missingDocReminderIntervalDays",
          1,
          365
        ),
        rejectedDocReminderIntervalDays: toIntOrThrow(
          String(formData.get("rejectedDocReminderIntervalDays") ?? ""),
          "rejectedDocReminderIntervalDays",
          1,
          365
        ),
      };
      await updateReminderSettings(actor, patch);
      revalidatePath("/admin/reminders/settings");
      revalidatePath("/admin/reminders");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "save failed";
      const { redirect } = await import("next/navigation");
      redirect(
        "/admin/reminders/settings?error=" + encodeURIComponent(msg.slice(0, 200))
      );
    }
    const { redirect } = await import("next/navigation");
    redirect("/admin/reminders/settings?saved=1");
  }

  return (
    <>
      <AdminNav email={user.email} active="reminders" />
      <main className="max-w-3xl mx-auto px-6 py-8">
        <Link
          href="/admin/reminders"
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← Back to reminders
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900 mt-3 mb-2">
          Set up email reminders
        </h1>
        <p className="text-slate-600 mb-6">
          Set this once. The system will keep checking all teachers and send
          reminder emails until their documents are complete.
        </p>

        {params.saved ? (
          <div className="mb-4 rounded-md bg-green-50 border border-green-200 px-4 py-2 text-sm text-green-800">
            Settings saved.
          </div>
        ) : null}
        {params.error ? (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-800">
            {params.error}
          </div>
        ) : null}

        <form action={save} className="space-y-5">
          <fieldset className="rounded-lg border border-slate-200 p-5">
            <legend className="px-2 text-sm font-medium text-slate-700">
              Turn reminders on or off
            </legend>
            <label className="flex items-center gap-3 mt-2">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={settings.enabled}
                className="h-4 w-4"
              />
              <span className="text-slate-900">
                Automatically send reminders to all teachers who need them
              </span>
            </label>
          </fieldset>

          <fieldset className="rounded-lg border border-slate-200 p-5 space-y-4">
            <legend className="px-2 text-sm font-medium text-slate-700">
              What teachers see
            </legend>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Sender name
              </label>
              <input
                name="senderName"
                defaultValue={settings.senderName}
                required
                maxLength={100}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Sender email address
              </label>
              <input
                name="senderEmail"
                type="email"
                defaultValue={settings.senderEmail}
                required
                maxLength={254}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Link teachers should click
              </label>
              <input
                name="portalUrl"
                type="url"
                defaultValue={settings.portalUrl}
                required
                maxLength={500}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </div>
          </fieldset>

          <fieldset className="rounded-lg border border-slate-200 p-5 space-y-4">
            <legend className="px-2 text-sm font-medium text-slate-700">
              When reminders are sent
            </legend>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Remind before a document expires
              </label>
              <input
                name="reminderDaysBeforeExpiration"
                defaultValue={settings.reminderDaysBeforeExpiration.join(", ")}
                required
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              />
              <p className="text-xs text-slate-500 mt-1">
                Example: 90, 60, 30, 14, 7 means teachers get reminders at
                each of those points before expiration.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Missing documents: repeat every this many days
                </label>
                <input
                  type="number"
                  name="missingDocReminderIntervalDays"
                  min={1}
                  max={365}
                  defaultValue={settings.missingDocReminderIntervalDays}
                  required
                  className="w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Rejected documents: repeat every this many days
                </label>
                <input
                  type="number"
                  name="rejectedDocReminderIntervalDays"
                  min={1}
                  max={365}
                  defaultValue={settings.rejectedDocReminderIntervalDays}
                  required
                  className="w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Expired documents: repeat every this many days
                </label>
                <input
                  type="number"
                  name="postExpirationIntervalDays"
                  min={1}
                  max={365}
                  defaultValue={settings.postExpirationIntervalDays}
                  required
                  className="w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </div>
            </div>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                name="maxOneEmailPerTeacherPerDay"
                defaultChecked={settings.maxOneEmailPerTeacherPerDay}
                className="h-4 w-4"
              />
              <span className="text-slate-900">
                Send at most one reminder to each teacher per day (recommended)
              </span>
            </label>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Tell admins when a document has been waiting for review this
                many days (leave blank to turn off)
              </label>
              <input
                type="number"
                name="pendingReviewDaysBeforeAdminAlert"
                min={1}
                max={365}
                defaultValue={settings.pendingReviewDaysBeforeAdminAlert ?? ""}
                className="w-40 rounded-md border border-slate-300 px-3 py-2"
              />
            </div>
          </fieldset>

          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded-md bg-blue-600 px-5 py-2 text-white font-medium hover:bg-blue-700"
            >
              Save settings
            </button>
          </div>
        </form>
      </main>
    </>
  );
}
