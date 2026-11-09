/**
 * The holder's details: prefilled on /app/domein from the business and its
 * facts, checked here when the owner submits them. Pure, tested.
 */
import type { BusinessRecord } from "../db/types.js";
import type { Facts } from "../types.js";
import { normalizePhone } from "../scanner/normalize.js";
import type { Holder } from "./types.js";

export const HOLDER_FIELDS = ["company", "firstName", "lastName", "street", "houseNumber", "postcode", "city", "phone", "email"] as const;
export type HolderField = (typeof HOLDER_FIELDS)[number];
export type HolderDraft = Record<HolderField, string>;

/** "Kerkstraat 12a" → ["Kerkstraat", "12a"]; without a number the whole line is the street. */
export function splitStreet(address: string | null | undefined): [string, string] {
  const line = (address ?? "").split(",")[0]!.trim();
  const m = line.match(/^(.*\D)\s+(\d+\s*[a-zA-Z]?(?:[-\s]?\d+)?)$/);
  return m ? [m[1]!.trim(), m[2]!.replace(/\s+/g, "")] : [line, ""];
}

/** What the form starts with: business name, address, phone and the owner's e-mail. The contact person's name is the owner's to type. */
export function holderDraft(b: Pick<BusinessRecord, "name" | "place" | "ownerEmail">, facts: Pick<Facts, "address" | "postcode" | "phone" | "email"> | null): HolderDraft {
  const [street, houseNumber] = splitStreet(facts?.address);
  return {
    company: b.name,
    firstName: "",
    lastName: "",
    street,
    houseNumber,
    postcode: facts?.postcode ?? "",
    city: b.place,
    phone: facts?.phone ?? "",
    email: b.ownerEmail ?? facts?.email ?? "",
  };
}

export type HolderCheck = { ok: true; holder: Holder } | { ok: false; error: "incomplete" | "phone" };

export function parseHolder(input: Partial<Record<HolderField, unknown>>, country: string, kvk: string | null): HolderCheck {
  const v = Object.fromEntries(HOLDER_FIELDS.map((k) => [k, String(input[k] ?? "").trim().slice(0, 200)])) as HolderDraft;
  if (HOLDER_FIELDS.some((k) => !v[k]) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) return { ok: false, error: "incomplete" };
  const phone = normalizePhone(v.phone, country);
  if (!phone) return { ok: false, error: "phone" };
  const postcode = country === "NL" ? v.postcode.replace(/\s+/g, "").toUpperCase().replace(/^(\d{4})([A-Z]{2})$/, "$1 $2") : v.postcode;
  return { ok: true, holder: { ...v, postcode, phone, email: v.email.toLowerCase(), country, kvk } };
}
