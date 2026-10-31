/**
 * The country of a business (ISO 3166-1 alpha-2, business.country, migration 0014).
 *
 * Vidalo started in the Netherlands and also serves businesses elsewhere. The country decides:
 *  - the scan language: Dutch for NL, English everywhere else (scanLang);
 *  - the AI systems' user location and Google's region (engines);
 *  - how phone numbers are read (scanner/normalize.ts);
 *  - the facts page's addressCountry and language (publisher/render.ts);
 *  - whether the Dutch directories are synced (only NL, hasDirectorySync).
 * VAT is not decided here: Stripe Tax works it out from the billing address and VAT number.
 */
import type { Business, Facts } from "../types";

export const HOME_COUNTRY = "NL";

export type ScanLang = "nl" | "en";

/** Every assigned ISO 3166-1 alpha-2 code. */
export const COUNTRY_CODES = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
  "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT " +
  "MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
  "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG " +
  "UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
).split(" ");

const CODES = new Set(COUNTRY_CODES);

export function isCountryCode(v: unknown): v is string {
  return typeof v === "string" && CODES.has(v);
}

/** A country code from any input ("nl", " NL "), or the home country when it is not one. */
export function normalizeCountry(v: unknown): string {
  const code = typeof v === "string" ? v.trim().toUpperCase() : "";
  return CODES.has(code) ? code : HOME_COUNTRY;
}

/** The language the AI systems are asked in, and the facts page is written in. */
export function scanLang(country: string | null | undefined): ScanLang {
  return (country ?? HOME_COUNTRY) === HOME_COUNTRY ? "nl" : "en";
}

/** The Dutch directories (publisher/directories) only list businesses in the Netherlands. */
export function hasDirectorySync(country: string | null | undefined): boolean {
  return (country ?? HOME_COUNTRY) === HOME_COUNTRY;
}

/** Countries that pay in euros; every other country listed in CURRENCY has its own. */
const EURO = new Set("AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK AD MC SM VA ME XK".split(" "));
const CURRENCY: Record<string, string> = {
  GB: "GBP", US: "USD", CA: "CAD", AU: "AUD", NZ: "NZD", CH: "CHF", LI: "CHF", NO: "NOK", SE: "SEK", DK: "DKK", IS: "ISK",
  PL: "PLN", CZ: "CZK", HU: "HUF", RO: "RON", BG: "BGN", TR: "TRY", ZA: "ZAR", JP: "JPY", SG: "SGD", HK: "HKD", AE: "AED", IN: "INR",
  BR: "BRL", MX: "MXN", IL: "ILS",
};

/** The currency the business's prices are in (facts page). Euro where unknown. */
export function currencyOf(country: string | null | undefined): string {
  const c = country ?? HOME_COUNTRY;
  return EURO.has(c) ? "EUR" : (CURRENCY[c] ?? "EUR");
}

/** The country's name in the page language ("Duitsland", "Germany"). */
export function countryName(code: string, lang: ScanLang): string {
  try {
    return new Intl.DisplayNames([lang], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** All countries for a picker, sorted by name in the page language, the home country first. */
export function countryOptions(lang: ScanLang): { code: string; name: string }[] {
  const all = COUNTRY_CODES.map((code) => ({ code, name: countryName(code, lang) })).sort((a, b) => a.name.localeCompare(b.name, lang));
  const home = all.findIndex((c) => c.code === HOME_COUNTRY);
  return [all[home]!, ...all.slice(0, home), ...all.slice(home + 1)];
}

/** Facts with the business's country copied in (Facts.country), for the scanner and the facts page. */
export function withCountry<F extends Facts>(facts: F, business: Pick<Business, "country">): F {
  return { ...facts, country: business.country ?? HOME_COUNTRY };
}
