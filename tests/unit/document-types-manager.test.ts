import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("DocumentTypesManager", () => {
  it("keeps the draft editor component stable while typing", () => {
    const source = readFileSync("components/admin/document-types-manager.tsx", "utf8");
    const managerStart = source.indexOf("export function DocumentTypesManager");
    const nestedEditorStart = source.indexOf("function DraftRowEditor", managerStart);

    expect(managerStart).toBeGreaterThan(-1);
    expect(nestedEditorStart).toBe(-1);
  });
});
