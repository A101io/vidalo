/**
 * Claims the site may not make again (feature 003, AC-6, AC-8, AC-10, AC-11, AC-17):
 * a popularity claim, a statistic without its country, a Monthly price without its start
 * fee, a company line without the btw number. Runs over the customer-facing copy in both
 * languages; `copy.legal` is Julian's and is not read here (legal.test.ts guards it).
 * Each rule was shown red against the old string before it was written down (04-build.md).
 */
import { describe, expect, it } from "vitest";
import { copy } from "../src/copy/index";
import { en } from "../src/copy/en";
import { COMPANY, CONTACT } from "../src/shared/contact";

type Leaf = { path: string; text: string };

/** Every string in the copy tree, `legal` left out; functions are called with plain arguments. */
function leaves(node: unknown, path: string, out: Leaf[] = []): Leaf[] {
  if (typeof node === "string") out.push({ path, text: node });
  else if (typeof node === "function") {
    try {
      const r = (node as (...a: string[]) => unknown)("x", "x", "x");
      leaves(r, path + "()", out);
    } catch {
      /* a function that needs real arguments is not a claim */
    }
  } else if (Array.isArray(node)) node.forEach((v, i) => leaves(v, `${path}[${i}]`, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (path === "" && k === "legal") continue;
      leaves(v, path ? `${path}.${k}` : k, out);
    }
  }
  return out;
}

const NL = leaves(copy, "");
const EN = leaves(en, "");
const ALL: Array<Leaf & { lang: "nl" | "en" }> = [...NL.map((l) => ({ ...l, lang: "nl" as const })), ...EN.map((l) => ({ ...l, lang: "en" as const }))];

const sentences = (s: string) => s.split(/(?<=[.!?])\s+/);

describe("copy claims", () => {
  it("collects a sensible number of strings (the scan is not empty)", () => {
    expect(NL.length).toBeGreaterThan(1500);
    expect(EN.length).toBeGreaterThan(1500);
  });

  it("1. no popularity claim", () => {
    const hits = ALL.filter((l) => /meest gekozen|most chosen|populair|popular|bestseller/i.test(l.text)).map((l) => `${l.lang}:${l.path}`);
    expect(hits).toEqual([]);
  });

  it("2. every 10,000 businesses figure names its country in the same sentence", () => {
    const bad: string[] = [];
    for (const l of ALL) {
      for (const s of sentences(l.text)) {
        if (/10[.,]000 (Amerikaanse )?(bedrijven|businesses)/.test(s) && !/\(VS\)|\(US\)|Amerikaanse|\bUS\b/.test(s)) bad.push(`${l.lang}:${l.path}`);
      }
    }
    expect(bad).toEqual([]);
  });

  /**
   * Rule 3: €49 per month is never the whole price of Vidalo Monthly. Allowed without the
   * €149: the figure itself (`total` sits under it), and the strings only a customer who
   * already paid Vidalo Scan sees (canAdd in app/app/abonnement/page.tsx), for whom €49 is
   * the whole price.
   */
  const FEE_EXEMPT = new Set([
    "landing.prijs.monitor.price", // the figure; landing.prijs.monitor.total sits under it
    "billing.plans.monitor", // add-on, shown after Vidalo Scan was paid
    "billing.addonBody", // same
    "dashboard.scanOnly.body", // owner who has had Vidalo Scan
  ]);
  it("3. every €49 per month string also names the €149 start, unless exempt", () => {
    const bad = ALL.filter((l) => /€\s?49\b.*(per maand|per month|\/mnd|\/month)/.test(l.text) && !/€\s?149\b/.test(l.text) && !FEE_EXEMPT.has(l.path)).map((l) => `${l.lang}:${l.path}: ${l.text.slice(0, 70)}`);
    expect(bad).toEqual([]);
  });

  it("4. the company line carries every identity field, in the footer and in the legal contact line", () => {
    const need = [COMPANY.legalName, COMPANY.street, COMPANY.kvk, COMPANY.vat, CONTACT.phone];
    for (const [name, line] of [
      ["copy.landing.footer.legal", copy.landing.footer.legal],
      ["en.landing.footer.legal", en.landing.footer.legal],
      ["copy.legal.contact", copy.legal.contact],
      ["en.legal.contact", en.legal.contact],
    ] as const) {
      for (const v of need) expect(line, `${name} lacks ${v}`).toContain(v);
    }
  });

  it("5. the words gratis / free sit on these keys only (Julian reads this list once)", () => {
    const keys = ALL.filter((l) => /gratis|\bfree\b/i.test(l.text)).map((l) => `${l.lang}:${l.path}`);
    expect(keys).toMatchInlineSnapshot(`
      [
        "nl:scanField.button",
        "nl:landing.prijs.setup.chip",
        "nl:landing.prijs.setup.button",
        "nl:landing.prijs.monitor.button",
        "nl:landing.cta.body",
        "nl:pages.home.title",
        "nl:pages.home.description",
        "nl:comingSoon.body",
        "nl:scanBusy.title",
        "nl:scanBusy.body",
        "nl:checks.newH1",
        "nl:result.more.h2()",
        "nl:sectorPages.aannemers-dakdekkers-schilders.chat.question",
        "nl:sectorPages.aannemers-dakdekkers-schilders.example.before[1].q",
        "nl:sectorPages.aannemers-dakdekkers-schilders.example.after[1].q",
        "nl:sectorPages.aannemers-dakdekkers-schilders.example.after[1].a",
        "nl:sectorPages.aannemers-dakdekkers-schilders.sample.policies[0]",
        "nl:sectorPages.advocaten-notarissen-accountants.example.after[2].a",
        "nl:pricing.lead",
        "nl:pricing.start",
        "nl:pricing.faq[6].a",
        "nl:billing.manage.cancel.what[4]",
        "nl:auth.noAccount",
        "nl:auth.noBusiness",
        "nl:auth.myChecksNote",
        "nl:auth.noBusinessSignedIn()",
        "nl:auth.startCheck",
        "nl:progress.scanKind.free",
        "nl:account.mails.optional.followup.label",
        "nl:account.mails.optional.followup.body",
        "nl:account.runKind.free",
        "nl:mails.deletionScheduled().body",
        "nl:ownerArea.archive.kind.free",
        "en:scanField.button",
        "en:landing.rapport.rows[3].q",
        "en:landing.prijs.setup.chip",
        "en:landing.prijs.setup.button",
        "en:landing.prijs.monitor.button",
        "en:landing.cta.body",
        "en:pages.home.title",
        "en:pages.home.description",
        "en:comingSoon.body",
        "en:scanBusy.title",
        "en:scanBusy.body",
        "en:checks.newH1",
        "en:result.more.h2()",
        "en:sectorPages.aannemers-dakdekkers-schilders.chat.question",
        "en:sectorPages.aannemers-dakdekkers-schilders.example.before[1].q",
        "en:sectorPages.aannemers-dakdekkers-schilders.example.after[1].q",
        "en:sectorPages.aannemers-dakdekkers-schilders.example.after[1].a",
        "en:sectorPages.aannemers-dakdekkers-schilders.sample.policies[0]",
        "en:sectorPages.winkels.facts[2].question",
        "en:sectorPages.winkels.example.before[2].q",
        "en:sectorPages.winkels.example.after[2].q",
        "en:sectorPages.winkels.sample.servicesYes[0]",
        "en:sectorPages.advocaten-notarissen-accountants.example.after[2].a",
        "en:pricing.lead",
        "en:pricing.start",
        "en:pricing.faq[6].a",
        "en:billing.manage.cancel.what[4]",
        "en:auth.noAccount",
        "en:auth.noBusiness",
        "en:auth.myChecksNote",
        "en:auth.noBusinessSignedIn()",
        "en:auth.startCheck",
        "en:progress.scanKind.free",
        "en:account.mails.optional.followup.label",
        "en:account.mails.optional.followup.body",
        "en:account.runKind.free",
        "en:mails.deletionScheduled().body",
        "en:ownerArea.archive.kind.free",
      ]
    `);
  });
});
