import { afterEach, describe, expect, it, vi } from "vitest";
import { sendEmail, HeaderInjectionError } from "@/lib/email/send";

/**
 * Boundary tests for the dispatcher. Mocks `fetch` to assert the provider
 * payloads byte-for-byte; verifies fail-loud behaviour when provider API
 * keys are missing.
 */

const ORIG_PROVIDER = process.env.EMAIL_PROVIDER;
const ORIG_RESEND_KEY = process.env.RESEND_API_KEY;
const ORIG_SENDGRID_KEY = process.env.SENDGRID_API_KEY;

function validMessage() {
  return {
    to: "teacher@school.org",
    from: { name: "Onboarding Portal", email: "noreply@school.org" },
    subject: "Heads up",
    text: "Hello",
    html: "<p>Hello</p>",
  };
}

afterEach(() => {
  process.env.EMAIL_PROVIDER = ORIG_PROVIDER;
  process.env.RESEND_API_KEY = ORIG_RESEND_KEY;
  process.env.SENDGRID_API_KEY = ORIG_SENDGRID_KEY;
  vi.restoreAllMocks();
});

describe("sendEmail — provider selection", () => {
  it("throws on unknown EMAIL_PROVIDER (no silent fallback)", async () => {
    process.env.EMAIL_PROVIDER = "smtp-via-magic";
    await expect(sendEmail(validMessage())).rejects.toThrow(
      /Unsupported EMAIL_PROVIDER/
    );
  });

  it("defaults to console when EMAIL_PROVIDER is unset", async () => {
    delete process.env.EMAIL_PROVIDER;
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await sendEmail(validMessage());
    expect(res.ok).toBe(true);
    expect(res.providerId).toMatch(/^console-/);
    const printed = spy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("[email:console]");
    expect(printed).toContain("teacher@school.org");
  });
});

describe("sendEmail — sanitisation runs BEFORE provider call", () => {
  it("HeaderInjectionError thrown for a CRLF subject before any fetch", async () => {
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "sk-test-fake-1234567890";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      sendEmail({
        ...validMessage(),
        subject: "evil\r\nBcc: e@v.x",
      })
    ).rejects.toThrow(HeaderInjectionError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects multi-recipient `to` before any fetch", async () => {
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "sk-test-fake-1234567890";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      sendEmail({ ...validMessage(), to: "a@x.com,b@x.com" })
    ).rejects.toThrow(HeaderInjectionError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("sendEmail — resend provider", () => {
  it("FAIL-LOUD: throws when RESEND_API_KEY is missing", async () => {
    process.env.EMAIL_PROVIDER = "resend";
    delete process.env.RESEND_API_KEY;
    await expect(sendEmail(validMessage())).rejects.toThrow(/RESEND_API_KEY/);
  });

  it("POSTs to api.resend.com with the expected JSON body", async () => {
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "sk-test-fake-1234567890";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "msg_abc" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

    const res = await sendEmail(validMessage());
    expect(res).toEqual({ ok: true, providerId: "msg_abc" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("https://api.resend.com/emails");
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-test-fake-1234567890");
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toEqual({
      from: "Onboarding Portal <noreply@school.org>",
      to: "teacher@school.org",
      subject: "Heads up",
      text: "Hello",
      html: "<p>Hello</p>",
    });
  });

  it("returns {ok: false, error} on provider HTTP error — scrubs the key", async () => {
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "sk-test-fake-1234567890";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          message: "Bad Authorization: Bearer sk-test-fake-1234567890",
        }),
        { status: 401 }
      )
    );
    const res = await sendEmail(validMessage());
    expect(res.ok).toBe(false);
    expect(res.error).toBeDefined();
    // Key MUST be scrubbed before any caller persists this string.
    expect(res.error).not.toContain("sk-test-fake-1234567890");
    expect(res.error).toContain("***");
  });

  it("returns {ok: false, error} on network failure — does not throw", async () => {
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "sk-test-fake-1234567890";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNRESET"));
    const res = await sendEmail(validMessage());
    expect(res.ok).toBe(false);
    expect(res.error).toContain("ECONNRESET");
  });
});

describe("sendEmail — sendgrid provider", () => {
  it("FAIL-LOUD: throws when SENDGRID_API_KEY is missing", async () => {
    process.env.EMAIL_PROVIDER = "sendgrid";
    delete process.env.SENDGRID_API_KEY;
    await expect(sendEmail(validMessage())).rejects.toThrow(/SENDGRID_API_KEY/);
  });

  it("POSTs to api.sendgrid.com with the expected JSON body", async () => {
    process.env.EMAIL_PROVIDER = "sendgrid";
    process.env.SENDGRID_API_KEY = "SG.test-fake-1234567890";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(null, {
          status: 202,
          headers: { "x-message-id": "sg_msg_abc" },
        })
      );

    const res = await sendEmail(validMessage());
    expect(res).toEqual({ ok: true, providerId: "sg_msg_abc" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("https://api.sendgrid.com/v3/mail/send");
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer SG.test-fake-1234567890");
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toEqual({
      personalizations: [{ to: [{ email: "teacher@school.org" }] }],
      from: { email: "noreply@school.org", name: "Onboarding Portal" },
      subject: "Heads up",
      content: [
        { type: "text/plain", value: "Hello" },
        { type: "text/html", value: "<p>Hello</p>" },
      ],
    });
  });

  it("returns {ok: false, error} on provider HTTP error — scrubs the key", async () => {
    process.env.EMAIL_PROVIDER = "sendgrid";
    process.env.SENDGRID_API_KEY = "SG.test-fake-1234567890";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          errors: [{ message: "Bad Authorization: Bearer SG.test-fake-1234567890" }],
        }),
        { status: 401 }
      )
    );
    const res = await sendEmail(validMessage());
    expect(res.ok).toBe(false);
    expect(res.error).toBeDefined();
    expect(res.error).not.toContain("SG.test-fake-1234567890");
    expect(res.error).toContain("***");
  });

  it("returns {ok: false, error} on network failure — does not throw", async () => {
    process.env.EMAIL_PROVIDER = "sendgrid";
    process.env.SENDGRID_API_KEY = "SG.test-fake-1234567890";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNRESET"));
    const res = await sendEmail(validMessage());
    expect(res.ok).toBe(false);
    expect(res.error).toContain("ECONNRESET");
  });
});

describe("sendEmail — console provider", () => {
  it("returns synthetic providerId and prints structured payload", async () => {
    process.env.EMAIL_PROVIDER = "console";
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await sendEmail(validMessage());
    expect(res.ok).toBe(true);
    expect(res.providerId).toMatch(/^console-[0-9a-f-]{36}$/);
    const line = String(spy.mock.calls[0][0]);
    expect(line.startsWith("[email:console] ")).toBe(true);
    const json = JSON.parse(line.replace("[email:console] ", ""));
    expect(json.to).toBe("teacher@school.org");
    expect(json.from).toBe("Onboarding Portal <noreply@school.org>");
    expect(json.subject).toBe("Heads up");
  });
});
