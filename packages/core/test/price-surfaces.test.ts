/**
 * Vidalo Monthly is never quoted as €49 per month alone to someone who has not paid Vidalo
 * Scan: the assistant's price reply, /llms.txt and Vidalo's own facts record all name the
 * €149 start (feature 003, AC-11, F-002).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mockAnswer } from "../src/chat/index";
import { copy, PRICES } from "../src/copy/index";
import { en } from "../src/copy/en";
import { OWN_FACTS } from "../src/shared/own";

const START = String(PRICES.setupEur);

describe("Monthly price surfaces name the start fee", () => {
  for (const [lang, c, q] of [["nl", copy, "Wat kost het?"], ["en", en, "What does it cost?"]] as const) {
    it(`the assistant's price reply (${lang})`, () => {
      const r = mockAnswer(q, c);
      expect(r.matched).toBe(true);
      expect(r.reply).toContain(`€${PRICES.monitorEurPerMonth}`);
      // the Monthly sentence itself, not the Scan sentence before it
      const monthly = r.reply.split(`${c.landing.prijs.monitor.name}:`)[1] ?? "";
      expect(monthly.slice(0, monthly.indexOf("excl") + 6)).toContain(START);
    });
  }

  it("/llms.txt (read as source: the route imports app aliases core cannot resolve)", () => {
    const src = readFileSync(join(__dirname, "../../../apps/web/app/llms.txt/route.ts"), "utf8");
    const line = src.split("\n").find((l) => l.includes("monitor.name") && l.includes("monitorEurPerMonth"));
    expect(line).toBeDefined();
    expect(line).toContain("PRICES.setupEur");
  });

  it("Vidalo's own facts record", () => {
    const row = OWN_FACTS.prices.find((p) => p.label === "Vidalo Monthly");
    expect(row?.amount).toBe(PRICES.monitorEurPerMonth);
    expect(row?.unit).toContain(START);
  });
});
