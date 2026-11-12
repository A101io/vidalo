/**
 * Mock seed for the account lifecycle (feature 002, lane A). Runs after seedOwnerArea. Mock only.
 * Two owners besides the demo bakery, each with a login of their own, for the delete flows:
 *  - scan-eigenaar@example.nl: Vidalo Scan (plan setup, trial): "Verwijder alles" deletes at once.
 *  - maand-eigenaar@example.nl: a running Vidalo Monthly with a verified custom facts host and a
 *    Google connection: "Verwijder alles" cancels at the period end and deletes on that date.
 *  - eind-eigenaar@example.nl: a Vidalo Monthly that has ended (the end state, A-06).
 */
import type { Db } from "@vidalo/core/db";

export const SCAN_OWNER_EMAIL = "scan-eigenaar@example.nl";
export const MONTHLY_OWNER_EMAIL = "maand-eigenaar@example.nl";
/** A-06: a Monthly that has ended (churned), for the end state on /app/abonnement. */
export const ENDED_OWNER_EMAIL = "eind-eigenaar@example.nl";

export async function seedAccountLifecycle(db: Db): Promise<void> {
  if (await db.getBusinessByOwner({ email: SCAN_OWNER_EMAIL })) return;
  const scan = await db.upsertBusiness({
    name: "Fietsenmaker Scan",
    place: "Leiden",
    plan: "setup",
    status: "trial",
    ownerEmail: SCAN_OWNER_EMAIL,
    ownerUserId: "5ca9a000-0000-4000-8000-000000000001",
    ownerVerifiedAt: new Date().toISOString(),
    ownerVerifiedVia: "google_business_profile",
  });
  await db.logEvent(scan.id, "checkout.mock", { plan: "setup" });
  const monthly = await db.upsertBusiness({
    name: "Kapsalon Maand",
    place: "Delft",
    plan: "monitor",
    status: "active",
    ownerEmail: MONTHLY_OWNER_EMAIL,
    ownerUserId: "5ca9a000-0000-4000-8000-000000000002",
    ownerVerifiedAt: new Date().toISOString(),
    ownerVerifiedVia: "google_business_profile",
    factsHost: "feiten.kapsalonmaand.nl",
    factsHostVerifiedAt: new Date().toISOString(),
    stripeCustomerId: "cus_mock_maand",
    stripeSubscriptionId: "sub_mock_maand",
    anniversaryDay: 3,
  });
  await db.upsertChannel({ businessId: monthly.id, type: "gbp", name: "Google Bedrijfsprofiel", externalId: "locations/mock-maand", url: null, status: "synced", meta: { refreshToken: "mock-refresh-maand", accessToken: "mock-access-maand" } });
  await db.logEvent(monthly.id, "checkout.mock", { plan: "monitor" });
  const ended = await db.upsertBusiness({ name: "Bloemist Eind", place: "Gouda", plan: "monitor", status: "active", ownerEmail: ENDED_OWNER_EMAIL, ownerUserId: "5ca9a000-0000-4000-8000-000000000003" });
  await db.upsertBusiness({ id: ended.id, slug: ended.slug, name: ended.name, place: ended.place, status: "churned" });
  await db.logEvent(ended.id, "business.status", { status: "churned", from: "active" });
}
