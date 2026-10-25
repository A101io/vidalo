/**
 * Mock seed for the domain page: a facts page published on the demo host
 * (waiting for the DNS record, so Google has not been asked yet) and one
 * own-website check with a shut-out robot and missing business data.
 * Runs after seedDemo; kept apart from demo.ts. Mock only.
 */
import type { Db } from "@vidalo/core/db";
import { DEMO_DOMAIN, DEMO_SLUG } from "./demo";

export async function seedDomainStatus(db: Db): Promise<void> {
  const business = await db.getBusiness(DEMO_SLUG);
  if (!business) return;
  if ((await db.listEvents(business.id, 500)).some((e) => e.type === "sitecheck.done")) return;
  const domain = business.domain ?? DEMO_DOMAIN;
  await db.upsertChannel({ businessId: business.id, type: "facts_page", name: "Feitenpagina", externalId: null, url: `https://feiten.${domain}/`, status: "pending", lastSyncedAt: new Date().toISOString() });
  await db.logEvent(business.id, "sitecheck.done", {
    domain,
    mode: "mock",
    robotsStatus: 200,
    homepageStatus: 200,
    issues: [
      { kind: "robots_blocked", robots: ["PerplexityBot"], engines: ["perplexity"], robotsUrl: `https://${domain}/robots.txt` },
      { kind: "no_business_data", pageUrl: `https://${domain}/` },
    ],
    keys: ["robots_blocked:PerplexityBot", "no_business_data"],
  });
}
