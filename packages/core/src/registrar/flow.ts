/**
 * What the worker does for the domain add-on. Runs inside withDb() (getDb()
 * answers the job's own handle) and talks to the registrar through
 * getRegistrar(). Each step is saved before the next, so a retry after a
 * timeout never registers the same name twice.
 *
 *   domain_register   paid → holder → register → feiten.{name} CNAME → registered,
 *                     then once the CNAME answers, the facts page moves to it (live)
 *   domain_autorenew  auto-renew on/off at the registrar (renewal not paid, not renewing, paid again)
 *
 * A refusal (RegistrarRefused) is final: the registration is marked failed, the
 * owner is told the money comes back, and support gets an operator task and a
 * mail. Anything else is thrown so the job retries with backoff; after the
 * last attempt support gets the same task, and the status stays "paid".
 */
import type { BusinessRecord } from "../db/types.js";
import { getDb } from "../shared/db.js";
import { log } from "../shared/log.js";
import { checkFactsHost, cnameTarget } from "../publisher/host.js";
import { sendDomainMail } from "../reporter/domain-mails.js";
import { factsHostOn } from "./names.js";
import { getRegistrar } from "./current.js";
import { RegistrarRefused, type DomainRegistration } from "./types.js";

export const SUPPORT_ADDRESS = "support@vidalo.io";

async function save(b: BusinessRecord, patch: Partial<DomainRegistration>): Promise<BusinessRecord> {
  return getDb().upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, domainRegistration: { ...b.domainRegistration!, ...patch } });
}

function message(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 500);
}

/** Support hears about a registration a person must finish or refund: an operator task and a mail. */
export async function escalateDomain(b: BusinessRecord, reason: string, detail: string): Promise<void> {
  const db = getDb();
  const reg = b.domainRegistration;
  await db.enqueueJob("operator_task", { reason, businessId: b.id, domain: reg?.name ?? null, detail, stripeSubscriptionId: reg?.stripeSubscriptionId ?? null });
  await db.enqueueJob("email", {
    to: SUPPORT_ADDRESS,
    subject: `Domein ${reg?.name ?? "?"} voor ${b.name}: ${reason}`,
    text: `Bedrijf: ${b.name} (${b.place}), id ${b.id}\nDomein: ${reg?.name ?? "?"}\nStatus: ${reg?.status ?? "?"}\nStripe-abonnement: ${reg?.stripeSubscriptionId ?? "-"}\nReden: ${reason}\n${detail}\n\nZie docs/DOMAINS.md, "Als het misgaat".`,
    businessId: b.id,
    kind: "support_domain",
  });
}

export type DomainRunResult =
  | { result: "skipped"; reason: string }
  | { result: "refused"; code: string }
  | { result: "registered"; live: boolean }
  | { result: "live" };

/**
 * The domain_register job. `lastAttempt` is true when the job loop will not
 * retry after this one; a transient error then escalates to support.
 */
export async function runDomainRegistration(businessId: string, opts: { lastAttempt?: boolean } = {}): Promise<DomainRunResult> {
  const db = getDb();
  let b = await db.getBusiness(businessId);
  const reg = b?.domainRegistration;
  if (!b || !reg) return { result: "skipped", reason: "no_registration" };
  if (reg.status === "registered") return (await moveFactsPage(b)) ? { result: "live" } : { result: "registered", live: false };
  if (reg.status !== "paid") return { result: "skipped", reason: `status_${reg.status}` };

  const registrar = getRegistrar();
  try {
    // Missing secrets are a switch (docs/RUNBOOK.md), not a refusal: retried, then support, never "failed" to the owner.
    if (!registrar) throw new Error("no registrar configured (OPENPROVIDER_* secrets missing)");
    let cur = reg;
    if (!cur.holderHandle) {
      b = await save(b, { holderHandle: await registrar.ensureHolder(cur.holder) });
      cur = b.domainRegistration!;
    }
    if (!cur.registrarId) {
      const done = await registrar.register(cur.name, cur.holderHandle!);
      b = await save(b, { registrarId: done.id, expiresAt: done.expiresAt, registeredAt: new Date().toISOString(), autoRenew: true });
      await db.logEvent(b.id, "domain.registered", { name: cur.name, registrar: registrar.name, expiresAt: done.expiresAt });
    }
    await registrar.pointCname(cur.name, factsHostOn(cur.name), cnameTarget());
    b = await save(b, { status: "registered", lastError: null });
    await db.logEvent(b.id, "domain.dns_set", { name: cur.name, host: factsHostOn(cur.name), target: cnameTarget() });
    await sendDomainMail(b, "domain_registered");
  } catch (err) {
    if (err instanceof RegistrarRefused) {
      b = await save(b, { status: "failed", lastError: message(err) });
      await db.logEvent(b.id, "domain.refused", { name: reg.name, code: err.code });
      await sendDomainMail(b, "domain_failed");
      await escalateDomain(b, "domain_register_refused", `Registrar: ${message(err)}\nTerugbetalen in Stripe en contact opnemen met de eigenaar.`);
      return { result: "refused", code: err.code };
    }
    await save(b, { lastError: message(err) });
    log.warn("domain.register.retry", { businessId, error: message(err), lastAttempt: Boolean(opts.lastAttempt) });
    if (opts.lastAttempt) await escalateDomain(b, "domain_register_stuck", `Laatste poging mislukt: ${message(err)}\nOpnieuw starten: job domain_register met businessId ${b.id}.`);
    throw err;
  }
  return (await moveFactsPage(b)) ? { result: "live" } : { result: "registered", live: false };
}

/**
 * The facts page moves to feiten.{name} once that host answers (CNAME and,
 * when configured, the Cloudflare custom hostname). Until then the current
 * host keeps serving, so nothing is offline in between. True when it moved.
 */
async function moveFactsPage(b: BusinessRecord): Promise<boolean> {
  const db = getDb();
  const host = factsHostOn(b.domainRegistration!.name);
  if (b.factsHost === host && b.factsHostVerifiedAt) return true;
  const check = await checkFactsHost(host);
  if (!check.verified) {
    // Nothing live yet at all: hand the host to the 10-minute poll as well (cron.pollUnverifiedHosts).
    if (!b.factsHostVerifiedAt) await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, factsHost: host });
    return false;
  }
  await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, factsHost: host, factsHostVerifiedAt: new Date().toISOString() });
  await db.upsertChannel({ businessId: b.id, type: "facts_page", name: "Feitenpagina", url: `https://${host}`, externalId: null, status: "pending" });
  await db.enqueueJob("publish", { businessId: b.id, reason: "domain_registered" });
  await db.logEvent(b.id, "domain.live", { host, previous: b.factsHost });
  return true;
}

/** The domain_autorenew job. Skipped when nothing is registered at the registrar. */
export async function setDomainAutoRenew(businessId: string, on: boolean): Promise<{ done: boolean; reason?: string }> {
  const db = getDb();
  const b = await db.getBusiness(businessId);
  const reg = b?.domainRegistration;
  if (!b || !reg?.registrarId) return { done: false, reason: "not_registered" };
  const registrar = getRegistrar();
  if (!registrar) throw new Error("no registrar configured (OPENPROVIDER_* secrets missing)");
  await registrar.setAutoRenew(reg.name, on);
  await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, domainRegistration: { ...reg, autoRenew: on } });
  await db.logEvent(b.id, "domain.autorenew", { name: reg.name, on });
  return { done: true };
}

/** "Mail me de verhuiscode": fetched from the registrar and mailed to the owner's address only, never shown or logged. */
export async function mailDomainAuthCode(b: BusinessRecord): Promise<boolean> {
  const reg = b.domainRegistration;
  const registrar = getRegistrar();
  if (!reg?.registrarId || !registrar || !b.ownerEmail) return false;
  const code = await registrar.authCode(reg.name);
  await sendDomainMail(b, "domain_authcode", { code });
  return true;
}
