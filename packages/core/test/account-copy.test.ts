import { describe, expect, it } from "vitest";
import { copy } from "../src/copy";
import { en } from "../src/copy/en";

/** Feature 002, V-COMP-13 (COMP-19): "Je gegevens" says the file covers the login too, and where the invoices are. */
describe("account: Je gegevens", () => {
  it("NL names the sign-in and the customer portal", () => {
    expect(copy.account.myData.body).toContain("je inlog");
    expect(copy.account.myData.body).toContain("klantportaal");
  });
  it("EN says the same", () => {
    expect(en.account.myData.body).toContain("your sign-in");
    expect(en.account.myData.body).toContain("customer portal");
  });
});
