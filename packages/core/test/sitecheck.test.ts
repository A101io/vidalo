import { beforeEach, describe, expect, it } from "vitest";
import { MemDb } from "../src/db";
import { setDb } from "../src/shared/db";
import {
  businessNodes,
  checkSite,
  issueKey,
  metaNoindex,
  parseRobots,
  robotsAllows,
  runSiteCheck,
  sitecheckEmail,
  type FetchLike,
} from "../src/publisher/sitecheck";
import { facts } from "./worker-fixtures";

/** A fake site: path → [status, body, headers]. Anything else is a 404. */
function site(pages: Record<string, [number, string, Record<string, string>?]>): FetchLike {
  return async (url) => {
    const page = pages[new URL(url).pathname];
    if (!page) return new Response("", { status: 404 });
    return new Response(page[1], { status: page[0], headers: page[2] ?? {} });
  };
}

const ld = (obj: unknown) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
const bakery = ld({ "@context": "https://schema.org", "@type": "Bakery", name: "Bakkerij Jansen", telephone: "023 123 45 67", address: { "@type": "PostalAddress", streetAddress: "Grote Markt 12" } });

describe("robots.txt", () => {
  it("lets a group naming the robot win over *", () => {
    const g = parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nAllow: /\n");
    expect(robotsAllows(g, "Googlebot")).toBe(true);
    expect(robotsAllows(g, "OAI-SearchBot")).toBe(false);
  });

  it("matches agent names case-insensitively and merges groups for the same robot", () => {
    const g = parseRobots("User-agent: oai-searchbot\nDisallow: /private\n\nUser-agent: OAI-SearchBot\nDisallow: /\n");
    expect(robotsAllows(g, "OAI-SearchBot", "/")).toBe(false);
  });

  it("uses the longest match, Allow wins a tie, an empty Disallow allows all", () => {
    expect(robotsAllows(parseRobots("User-agent: *\nDisallow: /\nAllow: /$\n"), "Bingbot", "/")).toBe(true);
    expect(robotsAllows(parseRobots("User-agent: *\nDisallow: /\nAllow: /\n"), "Bingbot", "/")).toBe(true);
    expect(robotsAllows(parseRobots("User-agent: *\nDisallow:\n"), "Bingbot", "/")).toBe(true);
    expect(robotsAllows(parseRobots("User-agent: *\nDisallow: /*\n"), "Bingbot", "/")).toBe(false);
    expect(robotsAllows(parseRobots(""), "Bingbot", "/")).toBe(true);
  });

  it("shares rules between consecutive user-agent lines and ignores comments", () => {
    const g = parseRobots("# AI\nUser-agent: GPTBot\nUser-agent: PerplexityBot # search\nDisallow: / # all\n");
    expect(robotsAllows(g, "PerplexityBot")).toBe(false);
    expect(robotsAllows(g, "GPTBot")).toBe(false);
    expect(robotsAllows(g, "Googlebot")).toBe(true);
  });
});

describe("homepage", () => {
  it("finds business nodes in @graph, subtypes and an Organization with an address", () => {
    expect(businessNodes(ld({ "@graph": [{ "@type": "WebSite" }, { "@type": "Plumber", name: "X" }] }))).toHaveLength(1);
    expect(businessNodes(ld({ "@type": ["Organization"], address: "Markt 1" }))).toHaveLength(1);
    expect(businessNodes(ld({ "@type": "Organization", name: "X" }))).toHaveLength(0);
    expect(businessNodes(`<script type="application/ld+json">{broken</script>`)).toHaveLength(0);
  });

  it("reads noindex from robots and googlebot meta tags", () => {
    expect(metaNoindex('<meta name="robots" content="noindex, follow">')).toBe(true);
    expect(metaNoindex("<meta content='none' name='googlebot'>")).toBe(true);
    expect(metaNoindex('<meta name="robots" content="index, follow">')).toBe(false);
    expect(metaNoindex('<meta name="description" content="noindex">')).toBe(false);
  });
});

describe("checkSite", () => {
  it("is clean for a readable site with matching business data", async () => {
    const r = await checkSite("https://www.bakkerijjansen.nl/", facts, { fetch: site({ "/robots.txt": [200, "User-agent: *\nDisallow: /admin\n"], "/": [200, `<html>${bakery}</html>`] }) });
    expect(r.domain).toBe("bakkerijjansen.nl");
    expect(r.mode).toBe("live");
    expect(r.issues).toEqual([]);
  });

  it("names the blocked answer robots and the engines they serve, not training crawlers", async () => {
    const robots = "User-agent: GPTBot\nDisallow: /\n\nUser-agent: OAI-SearchBot\nUser-agent: PerplexityBot\nDisallow: /\n";
    const r = await checkSite("bakkerijjansen.nl", facts, { fetch: site({ "/robots.txt": [200, robots], "/": [200, bakery] }) });
    expect(r.issues).toEqual([{ kind: "robots_blocked", robots: ["OAI-SearchBot", "PerplexityBot"], engines: ["chatgpt", "perplexity"], robotsUrl: "https://bakkerijjansen.nl/robots.txt" }]);
  });

  it("flags noindex, a wrong phone in the business data, and missing business data", async () => {
    const wrongPhone = ld({ "@type": "LocalBusiness", telephone: "+31 23 999 88 77" });
    const a = await checkSite("x.nl", facts, { fetch: site({ "/": [200, wrongPhone, { "x-robots-tag": "noindex" }] }) });
    expect(a.issues).toEqual([
      { kind: "noindex", via: "header", pageUrl: "https://x.nl/" },
      { kind: "phone_mismatch", found: "+31 23 999 88 77", expected: "023-1234567", pageUrl: "https://x.nl/" },
    ]);
    const b = await checkSite("x.nl", facts, { fetch: site({ "/": [200, "<html>geen gegevens</html>"] }) });
    expect(b.issues).toEqual([{ kind: "no_business_data", pageUrl: "https://x.nl/" }]);
  });

  it("never fetches localhost, IP literals or bare names", async () => {
    let calls = 0;
    const spy: FetchLike = async () => {
      calls++;
      return new Response("", { status: 200 });
    };
    for (const d of ["localhost", "127.0.0.1", "http://10.0.0.5/", "intranet", "printer.local", "[::1]"]) {
      expect((await checkSite(d, facts, { fetch: spy })).issues).toEqual([]);
    }
    expect(calls).toBe(0);
  });

  it("gives no issue for what it could not read", async () => {
    const down: FetchLike = async () => {
      throw new Error("ECONNREFUSED");
    };
    const r = await checkSite("x.nl", facts, { fetch: down });
    expect(r).toMatchObject({ robotsStatus: null, homepageStatus: null, issues: [] });
    const err = await checkSite("x.nl", facts, { fetch: site({ "/robots.txt": [503, "User-agent: *\nDisallow: /"], "/": [500, ""] }) });
    expect(err.issues).toEqual([]);
  });
});

describe("sitecheckEmail", () => {
  it("gives the owner the exact change, in plain Dutch", async () => {
    const r = await checkSite("bakkerijjansen.nl", facts, {
      fetch: site({ "/robots.txt": [200, "User-agent: OAI-SearchBot\nDisallow: /\n"], "/": [200, "<html></html>"] }),
    });
    const m = sitecheckEmail({ name: "Bakkerij Jansen" }, r, { factsPageUrl: "https://feiten.bakkerijjansen.nl/", dashboardUrl: "https://vidalo.io/app" });
    expect(m.subject).toBe("2 aanpassingen op je website voor Bakkerij Jansen");
    expect(m.text).toContain("ChatGPT mag je website niet lezen");
    expect(m.text).toContain("https://bakkerijjansen.nl/robots.txt");
    expect(m.text).toContain("User-agent: OAI-SearchBot\nAllow: /");
    expect(m.text).toContain("https://feiten.bakkerijjansen.nl/feiten.json");
    expect(m.text.replace(/User-agent/g, "")).not.toMatch(/!|\b(GEO|AEO|LLM|prompt|credits|zichtbaarheid|platform|agent)\b/i);
  });
});

describe("runSiteCheck", () => {
  let db: MemDb;
  beforeEach(() => {
    db = new MemDb();
    setDb(db);
  });

  async function seed(domain: string | null = "bakkerijjansen.nl") {
    const b = await db.upsertBusiness({ name: "Bakkerij Jansen", place: "Haarlem", domain, ownerEmail: "eigenaar@bakkerijjansen.nl", status: "active" });
    await db.insertFacts(b.id, { ...facts, website: domain ? `https://${domain}` : null });
    return b;
  }
  const emails = () => [...db.jobs.values()].filter((j) => j.kind === "email");
  const blocked = site({ "/robots.txt": [200, "User-agent: Bingbot\nDisallow: /\n"], "/": [200, bakery] });

  it("mails the owner once per new blocking problem", async () => {
    const b = await seed();
    const first = await runSiteCheck(b.id, { fetch: blocked });
    expect(first).toMatchObject({ newIssues: ["robots_blocked:Bingbot"], notified: true });
    expect(emails()).toHaveLength(1);
    expect(emails()[0]!.payload).toMatchObject({ to: "eigenaar@bakkerijjansen.nl", kind: "site_instruction" });

    const again = await runSiteCheck(b.id, { fetch: blocked });
    expect(again).toMatchObject({ newIssues: [], notified: false });
    expect(emails()).toHaveLength(1);

    const worse = site({ "/robots.txt": [200, "User-agent: Bingbot\nDisallow: /\n"], "/": [200, bakery, { "x-robots-tag": "noindex" }] });
    expect(await runSiteCheck(b.id, { fetch: worse })).toMatchObject({ newIssues: ["noindex"], notified: true });
    expect(emails()).toHaveLength(2);
  });

  it("does not mail for advice alone, and skips a business without a website", async () => {
    const b = await seed();
    const bare = await runSiteCheck(b.id, { fetch: site({ "/": [200, "<html></html>"] }) });
    expect(bare.result?.issues.map(issueKey)).toEqual(["no_business_data"]);
    expect(bare.notified).toBe(false);
    expect(emails()).toHaveLength(0);

    const none = await seed(null);
    expect(await runSiteCheck(none.id)).toMatchObject({ skipped: "no_domain", notified: false });
  });
});
