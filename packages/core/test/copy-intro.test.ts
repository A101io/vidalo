import { describe, expect, it } from "vitest";
import { copyFor } from "../src/copy";

// apps/web/app/logo-intro.css types each line in a fixed number of steps.
describe("logo animation copy", () => {
  it.each(["nl", "en"] as const)("%s keeps 28, 23 and 27 characters and a six-letter name", (lang) => {
    const c = copyFor(lang);
    expect(c.comingSoon.intro.questions.map((q) => [...q].length)).toEqual([28, 23, 27]);
    expect([...c.nav.wordmark].length).toBe(6);
  });
});
