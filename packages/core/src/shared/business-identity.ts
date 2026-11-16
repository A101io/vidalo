/**
 * What tells one business from another on the free check (16 Nov 2026). A name is not enough: Google
 * answers "Vidalo" with the nearest name it knows ("Voila ! Damesmode") and the check ran on that shop.
 * So the form also asks for the postcode and house number, or the website, and a Google candidate is only
 * taken without a click when one of those matches it exactly. Anything else goes to /scan/kies, where the
 * visitor picks a business by its full address or says theirs is not listed.
 *
 * The value is only compared, never stored or logged: it rides in the signed check cookie for 15 minutes.
 */
import { parseTypedWebsite } from "./typed-website.js";

export type BusinessIdentity = { kind: "postcode"; postcode: string; number: string } | { kind: "website"; host: string; url: string };

/** "3071 AV 80", "3071AV, 80a", "3071 av 80-2". Dutch postcodes; a business abroad gives its website. */
const POSTCODE_RE = /^(\d{4})\s*([a-z]{2})[\s,.-]*(\d{1,5})(?:\s*[-/]?\s*[a-z0-9]{1,4})?$/i;

export const MAX_IDENTITY = 200;

/** The typed postcode + house number or website; null when it is neither (or empty). */
export function parseBusinessIdentity(raw: unknown): BusinessIdentity | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text || text.length > MAX_IDENTITY) return null;
  const m = text.match(POSTCODE_RE);
  if (m) return { kind: "postcode", postcode: `${m[1]}${m[2]!.toUpperCase()}`, number: String(Number(m[3])) };
  const site = parseTypedWebsite(text);
  if (!site.ok || !site.url) return null;
  return { kind: "website", host: hostOf(site.url)!, url: site.url };
}

/** The host without "www.", lower case; null when it is no URL. */
function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * The first path segment that names a page of its own: "facebook.com/voiladamesmode" → "voiladamesmode". A language
 * segment ("/nl/", "/en") names no business, so it counts as none.
 */
function firstSegment(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const seg = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`).pathname.split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
    return /^[a-z]{2}(-[a-z]{2})?$/.test(seg) ? "" : seg;
  } catch {
    return "";
  }
}

/**
 * The house number at the end of the street line, as Google writes it: "Factorij 80", "Kerkstraat 12A", "Kerkstraat 12-2"
 * (number 12, unit 2), "Laan 3-5" (numbers 3 to 5). A number earlier in the line is part of the street ("2e Hugo de Grootstraat 12").
 */
function hasHouseNumber(address: string, n: number): boolean {
  const m = address.trim().match(/(\d+)\s*[a-z]{0,3}(?:\s*[-/]\s*(\d+)\s*[a-z]{0,3})?$/i);
  if (!m) return false;
  const from = Number(m[1]);
  const to = m[2] ? Number(m[2]) : from;
  return to > from ? n >= from && n <= to : n === from;
}

/** True when the candidate has exactly this postcode and house number, or this website (host, and the page on a shared host). */
export function identityMatches(c: { postcode: string | null; address: string | null; website: string | null }, id: BusinessIdentity): boolean {
  // facebook.com/vidalo is not facebook.com/voiladamesmode: when the listed website is a page on a host, the typed one
  // must be that page (QA-02). A listed website at the root matches any page typed on it ("voila.nl/winkel").
  if (id.kind === "website") {
    const page = firstSegment(c.website);
    return hostOf(c.website) === id.host && (!page || page === firstSegment(id.url));
  }
  if (!c.postcode || !c.address) return false;
  if (c.postcode.replace(/\s/g, "").toUpperCase() !== id.postcode) return false;
  return hasHouseNumber(c.address, Number(id.number));
}

/** How the identity rides in the check cookie (a string the parser reads back). */
export function identityText(id: BusinessIdentity): string {
  return id.kind === "website" ? id.url : `${id.postcode} ${id.number}`;
}
