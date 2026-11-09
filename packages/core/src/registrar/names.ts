/**
 * Domain names: what we suggest and what we accept. Pure, tested.
 */
import { DOMAIN_TLDS, type DomainTld } from "./types.js";

/** "Bakkerij Café de Vries" → "bakkerij-cafe-de-vries" (letters, digits, hyphens). */
function label(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " en ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The suggestions for a business, best first, at most `max`: the name run
 * together on .nl, the name with hyphens, the name with the place, then the
 * first one on .eu and .com. Duplicates and invalid labels are dropped.
 */
export function suggestDomains(name: string, place: string, max = 6, country = "NL"): string[] {
  const n = label(name);
  const p = label(place);
  const joined = n.replace(/-/g, "");
  const labels = [joined, n, `${joined}${p.replace(/-/g, "")}`, `${n}-${p}`];
  const out: string[] = [];
  for (const l of labels) if (l && n !== p) out.push(`${l}.nl`);
  if (joined) out.push(`${joined}.eu`, `${joined}.com`);
  return [...new Set(out)].filter((d) => { const x = parseDomain(d); return x !== null && tldAllowed(x.tld, country); }).slice(0, max);
}

/**
 * A name the owner typed, cleaned ("https://www.Bakkerij-DeVries.nl/" →
 * "bakkerij-devries.nl"), or null when it is not one we can register: one
 * label of 2–63 letters, digits and hyphens (no hyphen at either end, no "--"
 * in places 3–4, which is reserved for IDNs) on .nl, .com or .eu.
 */
export function parseDomain(input: string): { name: string; label: string; tld: DomainTld } | null {
  const s = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "")
    .replace(/\.$/, "");
  const m = s.match(/^([a-z0-9-]+)\.([a-z]+)$/);
  if (!m) return null;
  const [, l, tld] = m as unknown as [string, string, string];
  if (!(DOMAIN_TLDS as readonly string[]).includes(tld)) return null;
  if (l.length < 2 || l.length > 63 || l.startsWith("-") || l.endsWith("-") || l.slice(2, 4) === "--") return null;
  return { name: `${l}.${tld}`, label: l, tld: tld as DomainTld };
}

/** EU and EEA countries: only a holder established there may hold a .eu (Regulation (EU) 2019/517, art. 3). */
const EEA = new Set(["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO"]);

/** Whether a business in `country` may hold a name on `tld`. */
export function tldAllowed(tld: DomainTld, country: string): boolean {
  return tld !== "eu" || EEA.has(country.toUpperCase());
}

/** The facts page host on a registered domain. */
export function factsHostOn(domain: string): string {
  return `feiten.${domain}`;
}
