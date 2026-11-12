import { describe, expect, it } from "vitest";
import { safeNext } from "../src/shared/safe-next";

/** Feature 002 AC-4(c), SEC-29, F-023: no `next` leaves the site. Control characters as escapes (SEC-58). */
describe("safeNext", () => {
  const refused = [
    "//evil.example",
    "/\\evil.example",
    "/%2F%2Fevil.example",
    "/%5Cevil.example",
    "https://evil.example",
    "javascript:alert(1)",
    "/%252F%252Fevil.example",
    "/\t/evil.example",
    "/.//evil.example",
    "/app/..//evil.example",
    "/%2e%2e//evil.example",
    "/a/../%09/evil",
    "/%0d%0aSet-Cookie:x",
    "/\u0000x",
    "",
  ];
  for (const raw of refused) it(`refuses ${JSON.stringify(raw)}`, () => expect(safeNext(raw)).toBe("/app"));
  it("refuses null and undefined", () => {
    expect(safeNext(null)).toBe("/app");
    expect(safeNext(undefined)).toBe("/app");
  });
  it("keeps a path with query and hash", () => expect(safeNext("/app?x=1#y")).toBe("/app?x=1#y"));
  it("keeps an English path", () => expect(safeNext("/en/app/account")).toBe("/en/app/account"));
  it("keeps the delete step and the open address form", () => {
    expect(safeNext("/app/account/verwijderen")).toBe("/app/account/verwijderen");
    expect(safeNext(encodeURIComponent("/app/account?stap=email#inlog"))).toBe("/app/account?stap=email#inlog");
  });
  it("uses the fallback it is given", () => expect(safeNext("//x.example", "/")).toBe("/"));
});
