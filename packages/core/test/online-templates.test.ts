import { describe, expect, it } from "vitest";
import { ONLINE_TEMPLATES, PLACEHOLDER_SLOT } from "../src/prompts/online";
import { ONLINE_TEMPLATES_EN } from "../src/prompts/online.en";

const placeholders = (text: string) => [...text.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]!);
/** Slot kinds a text asks for, in order, once each. */
const kinds = (text: string) => [...new Set(placeholders(text).map((p) => PLACEHOLDER_SLOT[p] ?? `UNKNOWN:${p}`))];

describe("online templates, Dutch and English item for item", () => {
  it("same keys in the same order, same families, intents and slots", () => {
    expect(ONLINE_TEMPLATES_EN.map((t) => t.key)).toEqual(ONLINE_TEMPLATES.map((t) => t.key));
    expect(ONLINE_TEMPLATES_EN.map((t) => [t.family, t.intent, t.slots])).toEqual(ONLINE_TEMPLATES.map((t) => [t.family, t.intent, t.slots]));
  });

  it("the declared slots are the ones the text uses, in both languages", () => {
    for (const set of [ONLINE_TEMPLATES, ONLINE_TEMPLATES_EN]) for (const t of set) expect(kinds(t.text), t.key).toEqual(t.slots);
  });

  it("keys are unique and start with online.", () => {
    const keys = ONLINE_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => k.startsWith("online."))).toBe(true);
    expect(keys.length).toBe(11);
  });

  it("no template contains a town, a shop-front topic or jargon", () => {
    for (const t of [...ONLINE_TEMPLATES, ...ONLINE_TEMPLATES_EN]) {
      expect(t.text, t.key).not.toMatch(/\b(GEO|AEO|LLM|prompt|credits?|platform|zichtbaarheid|visibility|agent)\b/i);
      expect(t.text, t.key).not.toMatch(/openingstijd|opening hours|zondag|sunday|pinnen|adres|address|\{place\}|\{plaats\}/i);
      expect(t.text, t.key).toMatch(/\?$/);
    }
  });
});
