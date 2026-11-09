import { runDomainRegistration, setDomainAutoRenew, escalateDomain } from "@vidalo/core/registrar";
import { getDb } from "../compat.js";
import type { Handler } from "./types.js";

/** Rounds of 10 minutes the job waits for feiten.{name} to answer before support looks (12 hours). */
export const DOMAIN_LIVE_ROUNDS = 72;
const ROUND_MS = 10 * 60 * 1000;

/**
 * Not in PAID_ONLY: the add-on is paid on its own (the webhook only queues
 * this after Stripe says paid) and only a proven owner can start its checkout.
 */
export const domainRegister: Handler<"domain_register"> = async (p, job) => {
  const out = await runDomainRegistration(p.businessId, { lastAttempt: job.attempts >= job.maxAttempts });
  if (out.result === "registered" && !out.live) {
    const round = (p.round ?? 0) + 1;
    if (round <= DOMAIN_LIVE_ROUNDS) {
      await getDb().enqueueJob("domain_register", { businessId: p.businessId, round }, new Date(Date.now() + ROUND_MS));
    } else {
      const b = await getDb().getBusiness(p.businessId);
      if (b) await escalateDomain(b, "domain_not_live", `feiten.${b.domainRegistration?.name} wijst na 12 uur nog niet naar Vidalo. DNS-zone bij de registrar nakijken.`);
    }
  }
  return { ...out };
};

export const domainAutoRenew: Handler<"domain_autorenew"> = async (p) => {
  return setDomainAutoRenew(p.businessId, p.on === true);
};
