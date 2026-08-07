import { describe, expect, it } from "vitest";
import { safeReturnTo } from "./return-to";

describe("safeReturnTo", () => {
  it("keeps local paths and rejects external redirects", () => {
    expect(safeReturnTo("/invite/token?from=login")).toBe("/invite/token?from=login");
    expect(safeReturnTo("https://example.com/invite")).toBe("/families");
    expect(safeReturnTo("//example.com/invite")).toBe("/families");
    expect(safeReturnTo("/\\example.com/invite")).toBe("/families");
  });
});
