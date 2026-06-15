/**
 * Teacher-facing helper links + notes shown on each document requirement card.
 *
 * Keyed by the canonical document-type name (see lib/db/document-catalog.ts).
 * A form with no approved resource simply has no entry here — we never render
 * a placeholder or invented link. Every URL below is a real, approved resource
 * supplied by the school.
 *
 * Pure data, no imports — safe to use from Client Components.
 */
export type DocResourceLink = { label: string; url: string };

export const DOCUMENT_RESOURCE_LINKS: Record<string, DocResourceLink[]> = {
  "Foundation in Health and Safety E-learning Certificate of Completion": [
    {
      label: "Foundations in Health and Safety E-Learning",
      // Direct destination of the school's Microsoft SafeLinks wrapper (the
      // wrapper embedded a personal email + expiring tokens).
      url: "https://www.ecetp.pdp.albany.edu/findtraining.aspx?Prog=EL",
    },
  ],
  "Mandated child abuse certificate of completion": [
    {
      label: "Mandated Child Abuse Training Instructions",
      url: "https://drive.google.com/file/d/1qAQKz5Hi0uuhPmiWkmRJVmdX55r8O7PO/view?usp=drive_link",
    },
  ],
  "Medical Form": [
    {
      label: "Medical Form",
      url: "https://drive.google.com/file/d/1nFCnqiKgxpyT85yAkT3hKB_xSgqEkuQ9/view?usp=sharing",
    },
  ],
};

/** Important note shown above the link(s) for specific forms. */
export const DOCUMENT_NOTES: Record<string, string> = {
  "Medical Form":
    "You may not begin working in a classroom until a completed medical form and all required vaccination/immunity documentation have been submitted.",
};

/** Resources (note + links) for a document type, looked up by its name. */
export function getDocumentResources(name: string): {
  note: string | null;
  links: DocResourceLink[];
} {
  return {
    note: DOCUMENT_NOTES[name] ?? null,
    links: DOCUMENT_RESOURCE_LINKS[name] ?? [],
  };
}
