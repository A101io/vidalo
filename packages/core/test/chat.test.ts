import { describe, expect, it } from "vitest";
import { copy, copyFor } from "../src/copy/index.js";
import { buildKnowledge, mockAnswer, systemPrompt, validMessages } from "../src/chat/index.js";

describe("website assistant", () => {
  it("knows the prices from the one place they are defined, in both languages", () => {
    expect(buildKnowledge(copy, "nl")).toContain("€149");
    expect(buildKnowledge(copy, "nl")).toContain("€49");
    expect(buildKnowledge(copyFor("en"), "en")).toContain("€149");
  });

  it("carries the rules: says it is an AI, never claims control, bans the jargon, points to the mailbox", () => {
    const p = systemPrompt(copy, "nl");
    expect(p).toMatch(/Je bent een AI/);
    expect(p).toMatch(/Beloof nooit/);
    expect(p).toMatch(/GEO, AEO, LLM, prompt, credits, platform/);
    expect(p).toContain("hello@vidalo.io");
  });

  it("answers a price question from the pricing copy without a model", () => {
    const { reply, matched } = mockAnswer("Wat kost het?", copy);
    expect(matched).toBe(true);
    expect(reply).toContain("€149");
    expect(reply).toContain("excl. btw");
  });

  it("answers a cancellation question from the FAQ", () => {
    const { reply, matched } = mockAnswer("Hoe kan ik opzeggen?", copy);
    expect(matched).toBe(true);
    expect(reply).toBe(copy.pricing.faq.find((f) => /zeg ik op/i.test(f.q))!.a);
  });

  it("control: an unrelated question gets the fallback, never an invented answer", () => {
    const { reply, matched } = mockAnswer("Wat is de hoofdstad van Peru?", copy);
    expect(matched).toBe(false);
    expect(reply).toBe(copy.chat.fallback);
  });

  it("validates the request shape and size", () => {
    expect(validMessages([{ role: "user", content: "hoi" }])).toEqual([{ role: "user", content: "hoi" }]);
    expect(validMessages([])).toBeNull();
    expect(validMessages([{ role: "assistant", content: "x" }])).toBeNull();
    expect(validMessages([{ role: "system", content: "x" }])).toBeNull();
    expect(validMessages([{ role: "user", content: "x".repeat(601) }])).toBeNull();
    expect(validMessages(Array.from({ length: 13 }, () => ({ role: "user", content: "x" })))).toBeNull();
  });
});
