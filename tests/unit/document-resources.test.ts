import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_RESOURCE_LINKS,
  getDocumentResources,
} from "@/lib/teacher/document-resources";
import { REQUIRED_DOCUMENT_TYPE_NAMES } from "@/lib/db/document-catalog";

/**
 * Proves the right helper links + the medical warning note land on the right
 * teacher-facing document requirements — and that Fingerprinting / Diploma stay
 * link-free (no invented URLs).
 */

const MEDICAL = "Medical Form";
const FOUNDATIONS =
  "Foundation in Health and Safety E-learning Certificate of Completion";
const MANDATED = "Mandated child abuse certificate of completion";
const FINGERPRINTING = "Fingerprinting receipt";
const DIPLOMA = "High school Diploma/ College Degree";

describe("document resource links", () => {
  it("every keyed form is a real form in the catalog (no typos / orphans)", () => {
    for (const name of Object.keys(DOCUMENT_RESOURCE_LINKS)) {
      expect(REQUIRED_DOCUMENT_TYPE_NAMES).toContain(name);
    }
  });

  it("Foundations form shows the Health & Safety e-learning link", () => {
    const { note, links } = getDocumentResources(FOUNDATIONS);
    expect(note).toBeNull();
    expect(links).toEqual([
      {
        label: "Foundations in Health and Safety E-Learning",
        url: "https://www.ecetp.pdp.albany.edu/findtraining.aspx?Prog=EL",
      },
    ]);
  });

  it("Mandated child abuse form shows the training instructions link", () => {
    const { note, links } = getDocumentResources(MANDATED);
    expect(note).toBeNull();
    expect(links).toEqual([
      {
        label: "Mandated Child Abuse Training Instructions",
        url: "https://drive.google.com/file/d/1qAQKz5Hi0uuhPmiWkmRJVmdX55r8O7PO/view?usp=drive_link",
      },
    ]);
  });

  it("Medical Form shows the classroom warning note and a 'Medical Form' link", () => {
    const { note, links } = getDocumentResources(MEDICAL);
    expect(note).toBe(
      "You may not begin working in a classroom until a completed medical form and all required vaccination/immunity documentation have been submitted."
    );
    expect(links).toEqual([
      {
        label: "Medical Form",
        url: "https://drive.google.com/file/d/1nFCnqiKgxpyT85yAkT3hKB_xSgqEkuQ9/view?usp=sharing",
      },
    ]);
  });

  it("Fingerprinting and Diploma are upload-only (no links, no notes)", () => {
    for (const name of [FINGERPRINTING, DIPLOMA]) {
      const { note, links } = getDocumentResources(name);
      expect(note).toBeNull();
      expect(links).toEqual([]);
    }
  });

  it("all links are absolute external https URLs with non-vague labels", () => {
    const all = Object.values(DOCUMENT_RESOURCE_LINKS).flat();
    expect(all.length).toBeGreaterThan(0);
    for (const l of all) {
      expect(l.url).toMatch(/^https:\/\//);
      expect(l.label.trim().length).toBeGreaterThan(0);
      expect(l.label.toLowerCase()).not.toContain("click here");
      expect(l.url).not.toContain("example.com");
    }
  });
});

describe("document card wiring", () => {
  const source = readFileSync(
    "components/teacher/document-card.tsx",
    "utf8"
  );

  it("renders resources and opens external links safely in a new tab", () => {
    expect(source).toContain("getDocumentResources");
    expect(source).toContain('target="_blank"');
    expect(source).toContain('rel="noopener noreferrer"');
  });
});
