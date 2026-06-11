import { describe, expect, it } from "vitest";
import {
  isExpiringCategory,
  defaultRenewalMonthsForCategory,
  categoryLabel,
  DEFAULT_EXPIRING_RENEWAL_MONTHS,
} from "@/lib/expiry/category";

describe("document categories", () => {
  it("medical and training are expiring categories (tests 6, 7)", () => {
    expect(isExpiringCategory("medical")).toBe(true);
    expect(isExpiringCategory("training")).toBe(true);
  });

  it("general and other do not expire (test 8)", () => {
    expect(isExpiringCategory("general")).toBe(false);
    expect(isExpiringCategory("other")).toBe(false);
  });

  it("default renewal cadence is 24 months for expiring categories", () => {
    expect(DEFAULT_EXPIRING_RENEWAL_MONTHS).toBe(24);
    expect(defaultRenewalMonthsForCategory("medical")).toBe(24);
    expect(defaultRenewalMonthsForCategory("training")).toBe(24);
  });

  it("default renewal cadence is 0 (non-expiring) for general/other", () => {
    expect(defaultRenewalMonthsForCategory("general")).toBe(0);
    expect(defaultRenewalMonthsForCategory("other")).toBe(0);
  });

  it("labels are plain English, no jargon", () => {
    expect(categoryLabel("medical")).toBe("Medical form");
    expect(categoryLabel("training")).toBe("Training certification");
    expect(categoryLabel("general")).toBe("General");
  });
});
