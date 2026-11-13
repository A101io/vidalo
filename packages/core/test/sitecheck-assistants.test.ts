import { beforeEach, describe, expect, it } from "vitest";
import { MemDb } from "../src/db";
import { setDb } from "../src/shared/db";
import { copyFor } from "../src/copy/index";
import { checkSite, runSiteCheck, sitecheckEmail, type FetchLike } from "../src/publisher/sitecheck";
import { facts } from "./worker-fixtures";

const page = `<footer><a href="tel:+31231234567">023 123 45 67</a></footer>`;
/** Counts every request; turns away user-agents containing one of `refuse`. */
function counting(status: number, refuse: string[]) {
  const uas: string[] = [];
  const f: FetchLike = async (url, init) => {
    const ua = new Headers(init?.headers).get("user-agent") ?? "";
    if (new URL(url).pathname !== "/") return new Response("", { status: 404 });
    uas.push(ua);
    if (refuse.some((n) => ua.includes(n))) return new Response("no", { status: 403 });
    return new Response(page, { status });
  };
  return { f, uas };
}
const banned = /!|\b(GEO|AEO|LLM|prompt|credits|zichtbaarheid|visibility|platform|agent)\b/i;

describe("assistants_refused / phone_not_in_page (QA)", () => {
  it("AC2: no assistant fetches when our own homepage request is not 200", async () => {
    for (const status of [403, 404, 500]) {
      const c = counting(status, []);
      const r = await checkSite("x.nl", facts, { fetch: c.f });
      expect(r.issues).toEqual([]);
      expect(c.uas).toHaveLength(1);
    }
    const ok = counting(200, []);
    await checkSite("x.nl", facts, { fetch: ok.f });
    expect(ok.uas.filter((u) => /ChatGPT-User|Claude-User|Perplexity-User/.test(u))).toHaveLength(3);
  });

  it("AC2: a 404 for an assistant is not a refusal", async () => {
    const f: FetchLike = async (url, init) => {
      const ua = new Headers(init?.headers).get("user-agent") ?? "";
      if (new URL(url).pathname !== "/") return new Response("", { status: 404 });
      return new Response(page, { status: ua.includes("ChatGPT-User") ? 404 : 200 });
    };
    expect((await checkSite("x.nl", facts, { fetch: f })).issues.map((i) => i.kind)).toEqual(["no_business_data"]);
  });

  describe("AC3", () => {
    let db: MemDb;
    beforeEach(() => { db = new MemDb(); setDb(db); });
    it("mails once per new set of refused fetchers", async () => {
      const b = await db.upsertBusiness({ name: "Bakkerij Jansen", place: "Haarlem", domain: "bakkerijjansen.nl", ownerEmail: "e@bakkerijjansen.nl", status: "active" });
      await db.insertFacts(b.id, { ...facts, website: "https://bakkerijjansen.nl" });
      const emails = () => [...db.jobs.values()].filter((j) => j.kind === "email");
      expect(await runSiteCheck(b.id, { fetch: counting(200, ["Claude-User"]).f })).toMatchObject({ notified: true });
      expect(await runSiteCheck(b.id, { fetch: counting(200, ["Claude-User"]).f })).toMatchObject({ newIssues: [], notified: false });
      expect(emails()).toHaveLength(1);
      expect(await runSiteCheck(b.id, { fetch: counting(200, ["Claude-User", "Perplexity-User"]).f })).toMatchObject({ newIssues: ["assistants_refused:Claude-User,Perplexity-User"], notified: true });
      expect(emails()).toHaveLength(2);
    });
  });

  it("AC6: owner mail names both issues in NL and EN, no banned words", async () => {
    const f: FetchLike = async (url, init) => {
      const ua = new Headers(init?.headers).get("user-agent") ?? "";
      if (new URL(url).pathname !== "/") return new Response("", { status: 404 });
      return new Response("<html>geen nummer</html>", { status: ua.includes("ChatGPT-User") ? 403 : 200 });
    };
    const r = await checkSite("bakkerijjansen.nl", facts, { fetch: f });
    expect(r.issues.map((i) => i.kind).sort()).toEqual(["assistants_refused", "no_business_data", "phone_not_in_page"]);
    const links = { factsPageUrl: "https://feiten.bakkerijjansen.nl/", dashboardUrl: "https://vidalo.io/app" };
    const nl = sitecheckEmail({ name: "Bakkerij Jansen" }, r, links);
    expect(nl.text).toContain("Je website stuurt mogelijk ChatGPT weg");
    expect(nl.text).toContain("je telefoonnummer in de tekst van je homepage");
    const en = sitecheckEmail({ name: "Bakkerij Jansen" }, r, links, "en");
    expect(en.text).toContain("Your website may turn ChatGPT away");
    expect(en.text).toContain("your phone number in the text of your homepage");
    for (const t of [nl.text, en.text]) expect(t.replace(/User-agent|ChatGPT-User|Claude-User|Perplexity-User/g, "")).not.toMatch(banned);
  });

  it("AC6: /app/domein fix copy in NL and EN, no banned words", () => {
    for (const lang of ["nl", "en"] as const) {
      const F = (copyFor(lang) as any).domain.site.fix;
      const texts = [F.refusedTitle("ChatGPT"), F.refusedBody("ChatGPT"), F.refusedFix("ChatGPT-User"), F.phoneTextTitle, F.phoneTextBody("023-1234567"), F.phoneTextFix];
      for (const t of texts) { expect(typeof t).toBe("string"); expect(t.replace(/ChatGPT-User/g, "")).not.toMatch(banned); }
    }
  });
});
