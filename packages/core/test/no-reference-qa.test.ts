/**
 * QA controls for the Sonable fix (11 Nov 2026) that no-reference.test.ts left
 * without a failing test: the two widened not-found phrasings it does not
 * exercise on their own, and the address wording that mails and letters use.
 */
import { describe, expect, it } from "vitest";
import { looksSoftNotFound } from "../src/scanner/extract";
import { valueNl } from "../src/shared/facts-nl";
import { valueEn } from "../src/shared/facts-en";

describe("widened not-found phrasings, each on its own", () => {
  it("reads 'kon het niet vinden' as not found", () => {
    expect(looksSoftNotFound("Ik heb het adres van Sonable niet kunnen vinden.")).toBe(true);
  });

  it("reads 'no specific information' as not found", () => {
    expect(looksSoftNotFound("I have no specific information about Sonable in Rotterdam.")).toBe(true);
  });
});

describe("addresses in mails and letters read the way people write them", () => {
  it("words a normalised address in both languages", () => {
    expect(valueNl("address", "factorij 80 3071av rotterdam")).toBe("Factorij 80, 3071 AV Rotterdam");
    expect(valueEn("address", "factorij 80 3071av rotterdam")).toBe("Factorij 80, 3071 AV Rotterdam");
  });

  it("words an empty value (no fact) as not known yet", () => {
    expect(valueNl("phone", "")).toBe("nog niet bekend");
    expect(valueEn("phone", "")).toBe("not known yet");
  });
});
