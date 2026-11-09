/**
 * Domain registration (option B on /app/domein, docs/DOMAINS.md).
 *
 * One interface for "a registrar": availability, a holder contact, register,
 * point the facts host, the transfer code and auto-renew. The real one is
 * Openprovider (openprovider.ts); the mock answers without network in
 * VIDALO_MOCK=1 and in tests. Everything else (the job, the webhook, the page)
 * talks to this interface only.
 */

/** The extensions Vidalo sells. .nl first: the businesses are Dutch. */
export const DOMAIN_TLDS = ["nl", "com", "eu"] as const;
export type DomainTld = (typeof DOMAIN_TLDS)[number];

export interface Availability {
  /** full name, lower case: "bakkerijdevries.nl" */
  name: string;
  available: boolean;
  /** "taken", "invalid", "unsupported" or the registrar's own word; only when not available */
  reason?: string;
}

/**
 * The registrant (domain holder): the owner's business, never Vidalo.
 * SIDN and ICANN require the real holder's details; they come from the
 * business and its confirmed facts, plus the contact person the owner types.
 */
export interface Holder {
  company: string;
  /** contact person at the business ("Jan de Vries") */
  firstName: string;
  lastName: string;
  street: string;
  houseNumber: string;
  postcode: string;
  city: string;
  /** ISO alpha-2 */
  country: string;
  /** E.164 ("+31612345678") */
  phone: string;
  email: string;
  kvk?: string | null;
}

export interface Registered {
  /** the registrar's id for the domain (Openprovider: numeric id as a string) */
  id: string;
  /** when the first year ends */
  expiresAt: string;
}

/**
 * A registrar said no in a way that retrying will not change (name taken
 * meanwhile, holder data refused, account blocked). Anything else that is
 * thrown is treated as transient and the job retries with backoff.
 */
export class RegistrarRefused extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "RegistrarRefused";
  }
}

export interface Registrar {
  readonly name: "openprovider" | "mock";
  check(names: string[]): Promise<Availability[]>;
  /** Creates (or finds) the holder contact and returns its handle. */
  ensureHolder(holder: Holder): Promise<string>;
  /** The domain if it is already in our account (a registration whose answer got lost), else null. */
  find(name: string): Promise<Registered | null>;
  /** Registers for one year with auto-renew on and the registrar's nameservers. */
  register(name: string, holderHandle: string): Promise<Registered>;
  /** DNS at the registrar: `host` CNAME → `target`. Idempotent. */
  pointCname(name: string, host: string, target: string): Promise<void>;
  /** The transfer code (.nl: "token") the owner needs to move the domain elsewhere. */
  authCode(name: string): Promise<string>;
  setAutoRenew(name: string, on: boolean): Promise<void>;
}

/**
 * Where a registration stands, stored on the business (business.domain_registration,
 * migration 0015). One domain per business.
 *
 *   checkout    the owner started paying; nothing registered, nothing owed
 *   paid        Stripe says paid; the domain_register job is queued
 *   registered  the registrar has it and feiten.{name} points at Vidalo
 *   failed      the registrar refused; support refunds and contacts the owner
 *   ended       the add-on ended (not renewed); the domain runs out on expiresAt
 *
 * "live" is not stored: it is registered plus a verified facts host on this domain.
 */
export type DomainRegistrationStatus = "checkout" | "paid" | "registered" | "failed" | "ended";

export interface DomainRegistration {
  name: string;
  status: DomainRegistrationStatus;
  holder: Holder;
  registrar: Registrar["name"];
  /** the owner ticked the sentence that a registered domain is not refundable, at this moment */
  acceptedAt: string;
  checkoutSessionId: string | null;
  /** the add-on's own yearly Stripe subscription, separate from Vidalo Monthly */
  stripeSubscriptionId: string | null;
  holderHandle: string | null;
  registrarId: string | null;
  paidAt: string | null;
  registeredAt: string | null;
  expiresAt: string | null;
  autoRenew: boolean;
  /** the owner chose not to renew; the subscription and the domain end on this date */
  cancelAt: string | null;
  lastError: string | null;
}
