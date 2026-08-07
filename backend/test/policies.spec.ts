import { describe, expect, it } from "vitest";
import { assertDailyMediaCapacity, canDeleteMedia } from "../src/media/policies.js";

describe("media policies", () => {
  it("rejects an eleventh active media for the same date", () => {
    try {
      assertDailyMediaCapacity(10);
      throw new Error("expected daily limit rejection");
    } catch (error) {
      expect((error as { getResponse(): unknown }).getResponse()).toMatchObject({
        code: "DAILY_MEDIA_LIMIT"
      });
    }
  });

  it("lets owners delete any media and members only their own", () => {
    expect(canDeleteMedia("OWNER", "owner", "member")).toBe(true);
    expect(canDeleteMedia("MEMBER", "member", "member")).toBe(true);
    expect(canDeleteMedia("MEMBER", "member", "other")).toBe(false);
  });
});
