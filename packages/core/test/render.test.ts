import { describe, expect, it } from "vitest";
import { renderFactsPage, buildSitemap, formatDateNl, safeWebUrl } from "../src/publisher/render";
import { business, facts } from "./worker-fixtures";

describe("renderFactsPage", () => {
  const page = renderFactsPage(facts, business, { host: "feiten.bakkerijjansen.nl", verifiedAt: "2026-10-07T02:00:00.000Z" });

  it("has the Dutch title, dates and canonical link", () => {
    expect(page.html).toContain("<title>Bakkerij Jansen in Haarlem – feiten en openingstijden</title>");
    expect(page.html).toContain('<html lang="nl">');
    expect(page.html).toContain("Laatst gecontroleerd op <time datetime=\"2026-10-07\">7 oktober 2026</time>");
    expect(page.html).toContain("Laatst bevestigd door de eigenaar op <time datetime=\"2026-10-01\">1 oktober 2026</time>");
    expect(page.html).toContain('<link rel="canonical" href="https://feiten.bakkerijjansen.nl/">');
    expect(page.html).toContain('<link rel="alternate" type="text/plain" href="/llms.txt">');
    expect(page.canonicalUrl).toBe("https://feiten.bakkerijjansen.nl/");
    expect(page.html).not.toContain("<script src");
  });

  it("renders the hours table with Dutch day names and 'gesloten'", () => {
    expect(page.html).toContain("<h2>Openingstijden</h2>");
    expect(page.html).toMatch(/<tr><th scope="row">maandag<\/th><td>08:00 – 18:00<\/td><\/tr>/);
    expect(page.html).toMatch(/<tr><th scope="row">zaterdag<\/th><td>08:00 – 16:00<\/td><\/tr>/);
    expect(page.html).toMatch(/<tr><th scope="row">zondag<\/th><td>gesloten<\/td><\/tr>/);
  });

  it("lists services as wel / niet, prices, policies, payment and disambiguation", () => {
    expect(page.html).toContain("<h2>Diensten</h2>");
    expect(page.html).toContain("<li>desembrood</li>");
    expect(page.html).toContain("<li>Niet: verhuur</li>");
    expect(page.html).toContain("<h2>Prijzen</h2>");
    expect(page.html).toContain("€ 4,50 per stuk");
    expect(page.html).toContain("<h2>Afspraken en beleid</h2>");
    expect(page.html).toContain("<h2>Betalen</h2>");
    expect(page.html).toContain("pin, contant, iDEAL");
    expect(page.html).toContain("<h2>Niet te verwarren met</h2>");
    expect(page.html).toContain("Bakkerij Jansen in Zaandam (ander bedrijf)");
  });

  it("embeds JSON-LD LocalBusiness with the basic fields", () => {
    const m = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(page.html);
    expect(m).not.toBeNull();
    const ld = JSON.parse(m![1]!) as Record<string, unknown>;
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("LocalBusiness");
    expect(ld.name).toBe("Bakkerij Jansen");
    expect(ld.telephone).toBe("023 123 45 67");
    expect(ld.url).toBe("https://www.bakkerijjansen.nl");
    expect(ld.address).toMatchObject({ "@type": "PostalAddress", streetAddress: "Grote Markt 12", postalCode: "2011 RD", addressLocality: "Haarlem", addressCountry: "NL" });
    const hours = ld.openingHoursSpecification as { dayOfWeek: string; opens: string; closes: string }[];
    expect(hours).toHaveLength(6); // Sunday closed
    expect(hours[0]).toMatchObject({ "@type": "OpeningHoursSpecification", dayOfWeek: "https://schema.org/Monday", opens: "08:00", closes: "18:00" });
    expect(ld.sameAs).toContain("https://www.bakkerijjansen.nl");
    expect(page.jsonLd).toEqual(ld);
  });

  it("writes a terse llms.txt", () => {
    const lines = page.llmsTxt.split("\n");
    expect(lines[0]).toBe("# Bakkerij Jansen (Haarlem)");
    expect(page.llmsTxt).toContain("- Telefoon: 023 123 45 67");
    expect(page.llmsTxt).toContain("- Adres: Grote Markt 12, 2011 RD Haarlem");
    expect(page.llmsTxt).toContain("- zondag: gesloten");
    expect(page.llmsTxt).toContain("- vrijdag: 08:00 – 18:00");
    expect(page.llmsTxt).toContain("- Niet: verhuur");
    expect(page.llmsTxt).toContain("- Desembrood: € 4,50 per stuk");
    expect(page.llmsTxt).toContain("Laatst gecontroleerd: 2026-10-07");
    expect(page.llmsTxt).toContain("Laatst bevestigd door de eigenaar: 2026-10-01");
  });

  it("produces a sitemap with lastmod", () => {
    expect(page.sitemapXml).toContain("<loc>https://feiten.bakkerijjansen.nl/</loc>");
    expect(page.sitemapXml).toContain("<lastmod>2026-10-07</lastmod>");
    expect(buildSitemap("https://x.nl/", "2026-01-02T00:00:00Z")).toContain("<lastmod>2026-01-02</lastmod>");
  });

  it("escapes HTML in facts", () => {
    const p = renderFactsPage({ ...facts, name: "A <b> & C" }, business, { host: "h.nl" });
    expect(p.html).toContain("A &lt;b&gt; &amp; C");
    expect(p.html).not.toContain("A <b> & C");
  });

  it("falls back to the vidalo host when none is given", () => {
    const p = renderFactsPage(facts, business);
    expect(p.canonicalUrl).toBe("https://bakkerij-jansen-haarlem.feiten.vidalo.io/");
  });

  it("formats Dutch dates", () => {
    expect(formatDateNl("2026-03-01T12:00:00Z")).toBe("1 maart 2026");
  });
});

describe("owner-typed website", () => {
  it("never becomes a script link", () => {
    for (const bad of ["javascript:alert(document.cookie)", " JavaScript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x"]) {
      const page = renderFactsPage({ ...facts, website: bad }, business, { host: "feiten.bakkerijjansen.nl" });
      expect(page.html.toLowerCase()).not.toMatch(/href="\s*(javascript|data|vbscript):/);
      expect(page.llmsTxt ?? "").not.toMatch(/javascript:/i);
      expect(safeWebUrl(bad)).toBeNull();
    }
  });

  it("keeps http(s) and completes a bare domain", () => {
    expect(safeWebUrl("https://bakkerijjansen.nl")).toBe("https://bakkerijjansen.nl");
    expect(safeWebUrl("http://x.nl/a")).toBe("http://x.nl/a");
    expect(safeWebUrl("bakkerijjansen.nl")).toBe("https://bakkerijjansen.nl");
    const page = renderFactsPage({ ...facts, website: "bakkerijjansen.nl" }, business, { host: "feiten.bakkerijjansen.nl" });
    expect(page.html).toContain('href="https://bakkerijjansen.nl" rel="me"');
  });

  it("has call and route buttons and names the kind of business", () => {
    const page = renderFactsPage(facts, business, { host: "feiten.bakkerijjansen.nl" });
    expect(page.html).toContain('<a class="btn btn-primary" href="tel:0231234567">Bellen</a>');
    expect(page.html).toContain('href="https://www.google.com/maps/dir/?api=1&amp;destination=Bakkerij%20Jansen%2C%20Grote%20Markt%2012%2C%202011%20RD%20Haarlem">Route</a>');
    const withSector = renderFactsPage({ ...facts, sector: "horeca", name: "Top Exotic", googleTypes: ["meal_takeaway"], servicesNo: [] }, business, { host: "x.nl" });
    expect(withSector.html).toContain("Top Exotic is een restaurant in Haarlem.");
    expect(withSector.html).toContain('<ul class="chips">');
  });
});
