/**
 * How to reach Vidalo: one record, used by the contact page, the footer, the
 * coming-soon page, /llms.txt and the assistant's knowledge, so they cannot
 * disagree. The phone is A101's company number (A101/_OS/COMPANY.md).
 */
export const CONTACT = {
  email: "hello@vidalo.ai",
  support: "support@vidalo.ai",
  /** Shown as written; `tel:` gets the digits only. */
  phone: "+31 85 109 1393",
  /** WhatsApp Business, on the company number (confirmed by Julian 25 Oct 2026). */
  whatsapp: "+31 85 109 1393",
  /** Working days, Europe/Amsterdam; matches the own facts record (own.ts). */
  hours: "09:00–17:00",
} as const;

/**
 * Who is behind Vidalo, once (feature 003, ADR-0009). Every company line outside
 * `copy.legal` (footer, owner mails, support replies) is built from this and CONTACT;
 * `copy.legal.contact` stays hand-written and a test holds the two together.
 */
export const COMPANY = {
  legalName: "A101 B.V.",
  tradeName: "Vidalo",
  street: "Factorij 80",
  postcode: "3071 AV",
  city: "Rotterdam",
  kvk: "42057858",
  vat: "NL869514192B01",
} as const;

export const telHref = (n: string) => "tel:" + n.replace(/[^\d+]/g, "");
export const waHref = (n: string) => "https://wa.me/" + n.replace(/\D/g, "");
