"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Facts, Hours, PriceItem, SectorSlug } from "@vidalo/core/types";
import { SECTOR_SLUGS } from "@vidalo/core/types";
import { ready } from "@/lib/db";
import { getI18n } from "@/lib/i18n";
import { requireVerifiedOwner } from "@/lib/owner";
import { lastConfirmed } from "@vidalo/core/facts-history";
import { isCountryCode } from "@vidalo/core/shared";

const str = (form: FormData, k: string): string | null => {
  const v = String(form.get(k) ?? "").trim();
  return v === "" ? null : v;
};

function parseFacts(form: FormData, businessId: string): Omit<Facts, "businessId" | "version" | "provisional" | "verifiedAt"> {
  const hours: Hours[] = ([0, 1, 2, 3, 4, 5, 6] as const).map((day) => {
    const closed = form.get(`hours.${day}.closed`) === "on";
    return { day, closed, open: closed ? null : str(form, `hours.${day}.open`), close: closed ? null : str(form, `hours.${day}.close`) };
  });
  const prices: PriceItem[] = [];
  for (let i = 0; i < 50; i++) {
    const label = str(form, `price.${i}.label`);
    if (label == null && form.get(`price.${i}.amount`) == null) break;
    const amount = Number(form.get(`price.${i}.amount`) ?? 0);
    if (label && Number.isFinite(amount)) prices.push({ label, amount, unit: str(form, `price.${i}.unit`) ?? undefined });
  }
  const list = (k: string) => form.getAll(k).map((v) => String(v).trim()).filter(Boolean);
  const openStatus = str(form, "openStatus");
  // Sector-layer fields (criteria 4, 5, 12). The form may omit them; then they stay empty / unknown.
  const radiusRaw = str(form, "serviceAreaRadiusKm");
  const radiusKm = radiusRaw != null && Number.isFinite(Number(radiusRaw)) && Number(radiusRaw) > 0 ? Number(radiusRaw) : null;
  const urgencyAvailable = form.has("urgencyAvailable") ? form.get("urgencyAvailable") === "on" || form.get("urgencyAvailable") === "true" : null;
  const sectorRaw = str(form, "sector");
  const sector: SectorSlug | null = sectorRaw && (SECTOR_SLUGS as string[]).includes(sectorRaw) ? (sectorRaw as SectorSlug) : null;
  return {
    name: str(form, "name") ?? "",
    place: str(form, "place") ?? "",
    address: str(form, "address"),
    postcode: str(form, "postcode"),
    phone: str(form, "phone"),
    email: str(form, "email"),
    website: str(form, "website"),
    openStatus: openStatus === "temporarily_closed" || openStatus === "permanently_closed" ? openStatus : "open",
    hours,
    servicesYes: list("servicesYes"),
    servicesNo: list("servicesNo"),
    prices,
    policies: list("policies"),
    paymentMethods: list("paymentMethods"),
    notConfusedWith: list("notConfusedWith"),
    serviceArea: { places: list("serviceAreaPlaces"), radiusKm },
    urgency: urgencyAvailable == null ? undefined : { available: urgencyAvailable, hoursNl: str(form, "urgencyHours") },
    credentials: list("credentials"),
    sector,
  };
}

/** Confirm facts: new version, provisional=false, verified_at=now; then publish + sync jobs. */
export async function saveFacts(form: FormData) {
  const { business } = await requireVerifiedOwner("/app/gegevens");
  const db = await ready();
  const data = parseFacts(form, business.id);
  if (!data.name || !data.place) redirect((await getI18n()).href("/app/gegevens?fout=1"));
  // Not on the form: the Google types (they pick the question word) carry over from the version before.
  data.googleTypes = (await db.latestFacts(business.id))?.googleTypes;
  const now = new Date().toISOString();
  const facts = await db.insertFacts(business.id, data, { provisional: false, verifiedAt: now });
  const countryRaw = str(form, "country");
  const country = isCountryCode(countryRaw) ? countryRaw : business.country;
  await db.upsertBusiness({
    id: business.id,
    slug: business.slug,
    name: data.name,
    place: data.place,
    country,
    domain: business.domain ?? (data.website ? data.website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]! : null),
    ...(data.sector ? { sector: data.sector } : {}),
  });
  await db.enqueueJob("publish", { businessId: business.id, reason: `facts v${facts.version} confirmed` });
  // Google, Bing and Apple everywhere; the Dutch directories only for a business in the Netherlands (syncAllChannels).
  await db.enqueueJob("sync", { businessId: business.id }, new Date(Date.now() + 1000));
  await db.logEvent(business.id, "facts.confirmed", { version: facts.version, ...(country !== business.country ? { country } : {}) });
  revalidatePath("/app");
  revalidatePath("/app/gegevens");
  redirect((await getI18n()).href("/app/gegevens?opgeslagen=1"));
}

/**
 * "Alles klopt nog" (the yearly question): the owner confirms the last
 * confirmed facts unchanged. Recorded as a new confirmed version with the same
 * content, so verifiedAt stays the one date that says when the owner last
 * vouched for the facts (the facts page shows it, the history lists it, the
 * yearly rule counts from it). Republished for the new date; nothing to sync,
 * nothing changed.
 */
export async function reconfirmFacts() {
  const { business } = await requireVerifiedOwner("/app/gegevens/versies");
  const db = await ready();
  const confirmed = lastConfirmed(await db.listFacts(business.id));
  if (!confirmed) redirect((await getI18n()).href("/app/gegevens"));
  const { businessId: _b, version: _v, provisional: _p, verifiedAt: _va, createdAt: _c, ...data } = confirmed;
  const facts = await db.insertFacts(business.id, data, { provisional: false, verifiedAt: new Date().toISOString() });
  await db.enqueueJob("publish", { businessId: business.id, reason: `facts v${facts.version} confirmed again (yearly)` });
  await db.logEvent(business.id, "facts.confirmed", { version: facts.version, reconfirmed: confirmed.version });
  revalidatePath("/app", "layout");
  redirect((await getI18n()).href("/app/gegevens/versies?bevestigd=1"));
}
