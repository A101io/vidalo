import { describe, expect, it } from "vitest";
import { canDeleteMyData } from "../src/shared/my-data";

describe("deleting my data", () => {
  it("only once no subscription runs", () => {
    expect(canDeleteMyData("scanned")).toBe(true);
    expect(canDeleteMyData("churned")).toBe(true);
    for (const s of ["trial", "active", "paused"] as const) expect(canDeleteMyData(s)).toBe(false);
  });
});
