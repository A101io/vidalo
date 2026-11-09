/**
 * The domain add-on: price, who may buy, what the owner may do, which mail is
 * due, and what a Stripe event about the add-on means. Pure where it can be;
 * the webhook part writes through getDb() like the rest of billing.
 *
 * The rules (docs/DOMAINS.md has the reasoning):
 * - One price for .nl, .com and .eu: DOMAIN_PRICE_EUR_PER_YEAR excl. btw,
 *   billed yearly by its own Stripe subscription, separate from Vidalo Monthly.
 * - The owner's business is the holder (registrant); Vidalo is the reseller
 *   and the technical contact. The domain is theirs from day one.
 * - A registered domain is not refundable: the registry charges for the year
 *   the moment it registers. Said before purchase, ticked by the owner.
 *   Nothing registered (the registrar refused) = full refund by support.
 * - Not renewing: the owner says so on /app/domein (cancel at period end); the
 *   domain stays theirs until the end of the paid year and the transfer code
 *   is one click away. A renewal that cannot be collected turns auto-renew off
 *   at the registrar and mails the owner; paying turns it on again.
 * - Reminder 30 days before each renewal, with the price and how to stop.
 */
import type { BusinessRecord } from "../db/types.js";
import type { DomainRegistration } from "../registrar/types.js";
import { factsHostOn } from "../registrar/names.js";
import type { SubscriptionApi } from "./lifecycle.js";
import type { Db } from "../db/types.js";
import { PRICES } from "../copy/index.js";

export const DOMAIN_PRICE_EUR_PER_YEAR: number = PRICES.domainEurPerYear;
export const VAT_RATE = 0.21;
/** Days before the renewal date that the reminder mail goes out. */
export const DOMAIN_RENEWAL_REMINDER_DAYS = 30;

const DAY = 24 * 60 * 60 * 1000;

/** €25 → 30.25: the btw-inclusive amount, shown next to the price excl. btw. */
export function inclVat(eur: number): number {
  return Math.round(eur * (1 + VAT_RATE) * 100) / 100;
}

export type DomainBuyRefusal = "not_verified" | "not_paying" | "own_domain_live" | "already";

/**
 * Who may buy: a proven owner of a paying business (the facts page only runs
 * for one), whose facts page is not already live on their own domain, and
 * who has no domain from us in progress or running.
 */
export function domainBuyRefusal(b: BusinessRecord): DomainBuyRefusal | null {
  if (!b.ownerVerifiedAt) return "not_verified";
  if (b.status !== "trial" && b.status !== "active") return "not_paying";
  const reg = b.domainRegistration;
  if (reg && (reg.status === "paid" || reg.status === "registered")) return "already";
  if (b.factsHostVerifiedAt && b.factsHost && !b.factsHost.includes(".feiten.") && !(reg && b.factsHost === factsHostOn(reg.name))) return "own_domain_live";
  return null;
}

/** The status line on /app/domein: requested → registered → live. */
export type DomainState = "none" | "checkout" | "requested" | "registered" | "live" | "failed" | "ended";

export function domainState(b: Pick<BusinessRecord, "domainRegistration" | "factsHost" | "factsHostVerifiedAt">): DomainState {
  const reg = b.domainRegistration;
  if (!reg) return "none";
  switch (reg.status) {
    case "checkout":
      return "checkout";
    case "paid":
      return "requested";
    case "failed":
      return "failed";
    case "ended":
      return "ended";
    case "registered":
      return b.factsHostVerifiedAt && b.factsHost === factsHostOn(reg.name) ? "live" : "registered";
  }
}

export interface DomainOptions {
  canCancel: boolean;
  canUndoCancel: boolean;
  canGetAuthCode: boolean;
}

export function domainOptions(reg: DomainRegistration | null, now = new Date()): DomainOptions {
  const running = reg?.status === "registered";
  const notExpired = Boolean(reg?.expiresAt && new Date(reg.expiresAt) > now);
  return {
    canCancel: running && !reg!.cancelAt,
    canUndoCancel: running && Boolean(reg!.cancelAt && new Date(reg!.cancelAt) > now),
    // The holder may move the domain away at any time while it exists, also after not renewing.
    canGetAuthCode: (reg?.status === "registered" || reg?.status === "ended") && notExpired,
  };
}

/** Which renewal reminder is due now, given the mails already logged (one per renewal date). */
export function dueDomainReminder(reg: DomainRegistration | null, events: { type: string; payload: Record<string, unknown> }[], now = new Date()): boolean {
  if (!reg || reg.status !== "registered" || !reg.expiresAt || reg.cancelAt || !reg.autoRenew) return false;
  const left = new Date(reg.expiresAt).getTime() - now.getTime();
  if (left <= 0 || left > DOMAIN_RENEWAL_REMINDER_DAYS * DAY) return false;
  return !events.some((e) => e.type === "mail.domain_renewal" && e.payload.until === reg.expiresAt);
}

/** One year on, same day (29 Feb → 28 Feb). */
export function plusYear(iso: string): string {
  const d = new Date(iso);
  const next = new Date(Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()));
  if (next.getUTCDate() !== d.getUTCDate()) next.setUTCDate(0);
  return next.toISOString();
}

function patch(db: Db, b: BusinessRecord, reg: Partial<DomainRegistration>) {
  return db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, domainRegistration: { ...b.domainRegistration!, ...reg } });
}

export type DomainLifecycleResult = { ok: true; at: string } | { ok: false; reason: "not_allowed" };

/** "Niet verlengen": the add-on ends with the paid year; auto-renew goes off at the registrar (the worker does that). */
export async function cancelDomain(db: Db, api: SubscriptionApi | null, b: BusinessRecord, now = new Date()): Promise<DomainLifecycleResult> {
  const reg = b.domainRegistration;
  if (!domainOptions(reg, now).canCancel) return { ok: false, reason: "not_allowed" };
  let end = new Date(reg!.expiresAt ?? now.getTime() + 365 * DAY);
  if (api && reg!.stripeSubscriptionId) end = (await api.setCancelAtPeriodEnd(reg!.stripeSubscriptionId, true)).periodEnd ?? end;
  await patch(db, b, { cancelAt: end.toISOString(), autoRenew: false });
  await db.enqueueJob("domain_autorenew", { businessId: b.id, on: false });
  await db.logEvent(b.id, "domain.cancel_requested", { name: reg!.name, endsAt: end.toISOString() });
  return { ok: true, at: end.toISOString() };
}

/** "Toch verlengen": until the end date the owner can change their mind. */
export async function undoDomainCancel(db: Db, api: SubscriptionApi | null, b: BusinessRecord, now = new Date()): Promise<DomainLifecycleResult> {
  const reg = b.domainRegistration;
  if (!domainOptions(reg, now).canUndoCancel) return { ok: false, reason: "not_allowed" };
  if (api && reg!.stripeSubscriptionId) await api.setCancelAtPeriodEnd(reg!.stripeSubscriptionId, false);
  await patch(db, b, { cancelAt: null, autoRenew: true });
  await db.enqueueJob("domain_autorenew", { businessId: b.id, on: true });
  await db.logEvent(b.id, "domain.cancel_undone", { name: reg!.name });
  return { ok: true, at: now.toISOString() };
}
