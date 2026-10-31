/**
 * Renders the facts page for a business: plain, dated, semantic HTML with
 * JSON-LD (schema.org LocalBusiness), an llms.txt and a sitemap.
 *
 * No JavaScript, minimal inline CSS, readable on a phone. Dutch for a business
 * in the Netherlands, English for one abroad (shared/country.ts scanLang), with
 * the business's country and currency.
 * The page is the owner-asserted source of truth that AI assistants can cite.
 */
import { businessNoun } from "../prompts/sectors.js";
import { currencyOf, scanLang, withCountry, type ScanLang } from "../shared/country.js";
import type { Business, Facts, Hours, PriceItem } from "../types.js";

/** Every word on the page, per language. */
const T = {
  nl: {
    days: ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"],
    closed: "gesloten",
    within: (km: number, place: string) => `binnen ${km} km van ${place}`,
    noUrgency: "Geen spoeddienst.",
    urgency: "Spoeddienst beschikbaar",
    tempClosed: "Tijdelijk gesloten.",
    permClosed: "Definitief gesloten.",
    open: "Dit bedrijf is open en actief.",
    statusWord: { open: "open", temporarily_closed: "tijdelijk gesloten", permanently_closed: "definitief gesloten" },
    factsAbout: (n: string, p: string) => `Feiten over ${n} in ${p}, bevestigd door de eigenaar.`,
    source: "Bron",
    address: "Adres",
    phone: "Telefoon",
    email: "E-mail",
    kvk: "KvK",
    kvkLong: "KvK-nummer",
    hours: "Openingstijden",
    services: "Diensten",
    yes: "Wel",
    no: "Niet",
    prices: "Prijzen",
    pricesVat: "Prijzen inclusief btw, tenzij anders vermeld.",
    policies: "Afspraken en beleid",
    payment: "Betalen",
    area: "Werkgebied",
    urgent: "Spoed",
    credentials: "Erkenningen",
    notConfused: "Niet te verwarren met",
    lastChecked: "Laatst gecontroleerd",
    lastConfirmed: "Laatst bevestigd door de eigenaar",
    title: (n: string, p: string) => `${n} in ${p} – feiten en openingstijden`,
    call: "Bellen",
    route: "Route",
    about: "Over",
    isA: (n: string, noun: string, p: string) => `${n} is een ${noun} in ${p}.`,
    business: "bedrijf",
    contact: "Adres en contact",
    description: (n: string, p: string) => `Openingstijden, adres, telefoonnummer en diensten van ${n} in ${p}. Bevestigd door de eigenaar.`,
    tagline: "Feiten en openingstijden, zoals vastgelegd door de eigenaar.",
    checkedOn: "Laatst gecontroleerd op",
    confirmedOn: "Laatst bevestigd door de eigenaar op",
    notConfirmed: "Nog niet bevestigd door de eigenaar.",
    official: (n: string, v: number) => `Deze pagina is de officiële feitenpagina van ${n}. Versie ${v}. Vaste link:`,
    textVersion: "Tekstversie",
  },
  en: {
    days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    closed: "closed",
    within: (km: number, place: string) => `within ${km} km of ${place}`,
    noUrgency: "No emergency service.",
    urgency: "Emergency service available",
    tempClosed: "Temporarily closed.",
    permClosed: "Permanently closed.",
    open: "This business is open and operating.",
    statusWord: { open: "open", temporarily_closed: "temporarily closed", permanently_closed: "permanently closed" },
    factsAbout: (n: string, p: string) => `Facts about ${n} in ${p}, confirmed by the owner.`,
    source: "Source",
    address: "Address",
    phone: "Phone",
    email: "Email",
    kvk: "KvK",
    kvkLong: "Dutch Chamber of Commerce (KvK) number",
    hours: "Opening hours",
    services: "Services",
    yes: "Yes",
    no: "Not",
    prices: "Prices",
    pricesVat: "Prices include VAT unless stated otherwise.",
    policies: "Policies",
    payment: "Payment",
    area: "Service area",
    urgent: "Emergencies",
    credentials: "Accreditations",
    notConfused: "Not to be confused with",
    lastChecked: "Last checked",
    lastConfirmed: "Last confirmed by the owner",
    title: (n: string, p: string) => `${n} in ${p} – facts and opening hours`,
    call: "Call",
    route: "Directions",
    about: "About",
    isA: (n: string, _noun: string, p: string) => `${n} is a business in ${p}.`,
    business: "business",
    contact: "Address and contact",
    description: (n: string, p: string) => `Opening hours, address, phone number and services of ${n} in ${p}. Confirmed by the owner.`,
    tagline: "Facts and opening hours, as recorded by the owner.",
    checkedOn: "Last checked on",
    confirmedOn: "Last confirmed by the owner on",
    notConfirmed: "Not yet confirmed by the owner.",
    official: (n: string, v: number) => `This page is the official facts page of ${n}. Version ${v}. Permanent link:`,
    textVersion: "Text version",
  },
} as const;

const langOf = (facts: Facts): ScanLang => scanLang(facts.country);

export interface RenderOptions {
  /** Host the page is served on, e.g. "feiten.bakkerij-jansen.nl". Defaults to the business facts host fallback. */
  host?: string;
  /** ISO timestamp of the last automated check; defaults to now. */
  verifiedAt?: string;
  /** Protocol for canonical links; https in production. */
  protocol?: "https" | "http";
  /** Search Console verification token for this host (google-index.ts); adds the google-site-verification meta tag. */
  googleSiteVerification?: string | null;
  /** Full canonical URL when the page does not live at the root of `host` (Vidalo's own page at /feiten). */
  canonicalUrl?: string;
}

export interface RenderedFactsPage {
  html: string;
  jsonLd: Record<string, unknown>;
  llmsTxt: string;
  sitemapXml: string;
  canonicalUrl: string;
}

export const DAY_NAMES_NL = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"] as const;
const DAY_NAMES_SCHEMA = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

const MONTHS_NL = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
];

/** "7 October 2026" for a page in English. */
function formatDate(iso: string | Date, lang: ScanLang): string {
  if (lang === "nl") return formatDateNl(iso);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", day: "numeric", month: "long", year: "numeric" }).format(typeof iso === "string" ? new Date(iso) : iso);
}

/** "7 oktober 2026" in Europe/Amsterdam. */
export function formatDateNl(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const parts = new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const month = MONTHS_NL[Number(get("month")) - 1] ?? get("month");
  return `${get("day")} ${month} ${get("year")}`;
}

/** YYYY-MM-DD in UTC for sitemap lastmod / HTTP dates. */
export function isoDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toISOString().slice(0, 10);
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The owner types their website into a form, so it is untrusted: escaping
 * stops it breaking out of the attribute but not `javascript:` in an href.
 * Only http(s) survives; a bare domain gets https://; anything else is dropped.
 */
export function safeWebUrl(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null; // javascript:, data:, mailto:, ...
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(s)) return `https://${s}`;
  return null;
}

export function defaultFactsHost(business: Pick<Business, "slug">): string {
  const suffix = process.env.FACTS_HOST_SUFFIX || "vidalo.io";
  return `${business.slug}.feiten.${suffix}`;
}

function formatPrice(p: PriceItem, facts: Facts): string {
  const currency = currencyOf(facts.country);
  if (currency === "EUR" && langOf(facts) === "nl") {
    const amount = p.amount.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `€ ${amount}${p.unit ? ` ${p.unit}` : ""}`;
  }
  const amount = new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 2 }).format(p.amount);
  return `${amount}${p.unit ? ` ${p.unit}` : ""}`;
}

function hoursRows(hours: Hours[], lang: ScanLang = "nl"): { day: string; text: string; schema: Record<string, unknown> | null; dayIdx: number }[] {
  const byDay = new Map<number, Hours>();
  for (const h of hours) byDay.set(h.day, h);
  return T[lang].days.map((day, idx) => {
    const h = byDay.get(idx);
    if (!h || h.closed || !h.open || !h.close) {
      return { day, text: T[lang].closed, schema: null, dayIdx: idx };
    }
    return {
      day,
      text: `${h.open} – ${h.close}`,
      dayIdx: idx,
      schema: {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: `https://schema.org/${DAY_NAMES_SCHEMA[idx]}`,
        opens: h.open,
        closes: h.close,
      },
    };
  });
}

/** "Heemstede, Hoofddorp" and/or "binnen 25 km van Haarlem". */
export function serviceAreaLine(facts: Facts): string | null {
  const area = facts.serviceArea;
  if (!area) return null;
  const parts: string[] = [];
  if (area.places.length) parts.push(area.places.join(", "));
  if (area.radiusKm != null) parts.push(T[langOf(facts)].within(area.radiusKm, facts.place));
  return parts.length ? parts.join("; ") : null;
}

export function urgencyLine(facts: Facts): string | null {
  const u = facts.urgency;
  if (!u) return null;
  const t = T[langOf(facts)];
  if (!u.available) return t.noUrgency;
  return u.hoursNl ? `${t.urgency}: ${u.hoursNl}.` : `${t.urgency}.`;
}

function openStatusLine(facts: Facts): string {
  const t = T[langOf(facts)];
  switch (facts.openStatus) {
    case "temporarily_closed":
      return t.tempClosed;
    case "permanently_closed":
      return t.permClosed;
    default:
      return t.open;
  }
}

export function buildJsonLd(facts: Facts, business: Business, canonicalUrl: string): Record<string, unknown> {
  facts = facts.country ? facts : withCountry(facts, business);
  const rows = hoursRows(facts.hours);
  const sameAs: string[] = [];
  const website = safeWebUrl(facts.website);
  if (website) sameAs.push(website);
  if (business.googlePlaceId) sameAs.push(`https://www.google.com/maps/place/?q=place_id:${business.googlePlaceId}`);
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": `${canonicalUrl}#business`,
    name: facts.name,
    url: website ?? canonicalUrl,
    address: {
      "@type": "PostalAddress",
      streetAddress: facts.address ?? undefined,
      postalCode: facts.postcode ?? undefined,
      addressLocality: facts.place,
      addressCountry: facts.country ?? business.country ?? "NL",
    },
    openingHoursSpecification: rows.filter((r) => r.schema).map((r) => r.schema),
  };
  if (facts.phone) ld.telephone = facts.phone;
  if (facts.email) ld.email = facts.email;
  if (sameAs.length) ld.sameAs = sameAs;
  if (facts.paymentMethods.length) ld.paymentAccepted = facts.paymentMethods.join(", ");
  if (facts.prices.length) {
    ld.makesOffer = facts.prices.map((p) => ({
      "@type": "Offer",
      name: p.label,
      priceCurrency: currencyOf(facts.country),
      price: p.amount.toFixed(2),
      ...(p.unit ? { description: p.unit } : {}),
    }));
  }
  const extra: Record<string, unknown>[] = [];
  if (facts.openStatus === "permanently_closed") extra.push({ "@type": "PropertyValue", name: "status", value: "permanently closed" });
  // Werkgebied (criterium 4): places as City, a radius as GeoCircle around the business.
  const area = facts.serviceArea;
  if (area && (area.places.length || area.radiusKm != null)) {
    const served: Record<string, unknown>[] = area.places.map((p) => ({ "@type": "City", name: p }));
    if (area.radiusKm != null) {
      served.push({ "@type": "GeoCircle", geoMidpoint: { "@type": "PostalAddress", addressLocality: facts.place, addressCountry: facts.country ?? business.country ?? "NL" }, geoRadius: `${area.radiusKm * 1000}` });
    }
    ld.areaServed = served.length === 1 ? served[0] : served;
  }
  // Spoed (criterium 5): no schema.org type for an emergency line; a named property both humans and models can read.
  if (facts.urgency) {
    extra.push({ "@type": "PropertyValue", name: "spoeddienst", value: facts.urgency.available ? "ja" : "nee", ...(facts.urgency.hoursNl ? { description: facts.urgency.hoursNl } : {}) });
  }
  // Erkenningen (criterium 12).
  if (facts.credentials?.length) {
    ld.hasCredential = facts.credentials.map((c) => ({ "@type": "EducationalOccupationalCredential", name: c }));
  }
  if (extra.length) ld.additionalProperty = extra.length === 1 ? extra[0] : extra;
  return ld;
}

export function buildLlmsTxt(facts: Facts, business: Business, canonicalUrl: string, checkedAt: string): string {
  facts = facts.country ? facts : withCountry(facts, business);
  const t = T[langOf(facts)];
  const lines: string[] = [];
  lines.push(`# ${facts.name} (${facts.place})`);
  lines.push("");
  lines.push(`> ${t.factsAbout(facts.name, facts.place)} ${t.source}: ${canonicalUrl}`);
  lines.push("");
  lines.push(`- Status: ${t.statusWord[facts.openStatus]}`);
  if (facts.address) lines.push(`- ${t.address}: ${facts.address}${facts.postcode ? `, ${facts.postcode}` : ""} ${facts.place}`);
  if (facts.phone) lines.push(`- ${t.phone}: ${facts.phone}`);
  if (facts.email) lines.push(`- ${t.email}: ${facts.email}`);
  const website = safeWebUrl(facts.website);
  if (website) lines.push(`- Website: ${website}`);
  if (business.kvk) lines.push(`- ${t.kvk}: ${business.kvk}`);
  lines.push("");
  lines.push(`## ${t.hours}`);
  for (const r of hoursRows(facts.hours, langOf(facts))) lines.push(`- ${r.day}: ${r.text}`);
  if (facts.servicesYes.length || facts.servicesNo.length) {
    lines.push("");
    lines.push(`## ${t.services}`);
    for (const s of facts.servicesYes) lines.push(`- ${t.yes}: ${s}`);
    for (const s of facts.servicesNo) lines.push(`- ${t.no}: ${s}`);
  }
  if (facts.prices.length) {
    lines.push("");
    lines.push(`## ${t.prices}`);
    for (const p of facts.prices) lines.push(`- ${p.label}: ${formatPrice(p, facts)}`);
  }
  if (facts.policies.length) {
    lines.push("");
    lines.push(`## ${t.policies}`);
    for (const p of facts.policies) lines.push(`- ${p}`);
  }
  if (facts.paymentMethods.length) {
    lines.push("");
    lines.push(`## ${t.payment}`);
    lines.push(`- ${facts.paymentMethods.join(", ")}`);
  }
  const areaLine = serviceAreaLine(facts);
  if (areaLine) {
    lines.push("");
    lines.push(`## ${t.area}`);
    lines.push(`- ${areaLine}`);
  }
  const urgency = urgencyLine(facts);
  if (urgency) {
    lines.push("");
    lines.push(`## ${t.urgent}`);
    lines.push(`- ${urgency}`);
  }
  if (facts.credentials?.length) {
    lines.push("");
    lines.push(`## ${t.credentials}`);
    for (const c of facts.credentials) lines.push(`- ${c}`);
  }
  if (facts.notConfusedWith.length) {
    lines.push("");
    lines.push(`## ${t.notConfused}`);
    for (const n of facts.notConfusedWith) lines.push(`- ${n}`);
  }
  lines.push("");
  lines.push(`${t.lastChecked}: ${isoDate(checkedAt)}`);
  if (facts.verifiedAt) lines.push(`${t.lastConfirmed}: ${isoDate(facts.verifiedAt)}`);
  return lines.join("\n") + "\n";
}

export function buildSitemap(canonicalUrl: string, lastmod: string): string {
  const base = canonicalUrl.replace(/\/$/, "");
  const date = isoDate(lastmod);
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    `  <url><loc>${escapeHtml(base)}/</loc><lastmod>${date}</lastmod><changefreq>monthly</changefreq></url>`,
    `  <url><loc>${escapeHtml(base)}/llms.txt</loc><lastmod>${date}</lastmod><changefreq>monthly</changefreq></url>`,
    `</urlset>`,
    ``,
  ].join("\n");
}

const CSS = `
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0 auto;padding:1.25rem;max-width:44rem;font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#0f1222;background:#f6f7fa}
header,main section{background:#fff;border:1.5px solid #e3e5ec;border-radius:16px;padding:1.25rem 1.5rem;margin-bottom:1rem}
h1{font-size:1.75rem;line-height:1.2;letter-spacing:-.02em;margin:0 0 .4rem}
h2{font-size:1.05rem;margin:0 0 .6rem}
p{margin:.4rem 0}
.meta{color:#5b6070;font-size:.88rem}
.actions{display:flex;flex-wrap:wrap;gap:.6rem;margin:1rem 0 .6rem}
.btn{display:inline-block;padding:.7rem 1.25rem;border:1.5px solid #2f5bff;border-radius:12px;font-weight:700;text-decoration:none;text-align:center}
.btn-primary{background:#2f5bff;color:#fff}
.btn-secondary{background:#fff;color:#2f5bff}
table{border-collapse:collapse;width:100%}
th,td{text-align:left;padding:.45rem 0;vertical-align:top;border-top:1px solid #eef0f4}
tr:first-child th,tr:first-child td{border-top:0}
th{font-weight:600;width:50%}
th::first-letter{text-transform:uppercase}
ul{padding-left:1.2rem;margin:.4rem 0}
ul.chips{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:.5rem}
ul.chips li{border:1.5px solid #e3e5ec;border-radius:999px;padding:.3rem .85rem}
dl{margin:0}
dt{font-weight:600;margin-top:.6rem}
dt:first-child{margin-top:0}
dd{margin:0}
footer{color:#5b6070;font-size:.85rem;padding:.25rem .5rem}
a{color:#2f5bff}
@media (max-width:30rem){body{padding:.75rem}header,main section{padding:1rem 1.1rem}.btn{flex:1}}
`.trim();

function list(items: string[], prefix = "", cls = ""): string {
  if (!items.length) return "";
  return `<ul${cls ? ` class="${cls}"` : ""}>${items.map((i) => `<li>${escapeHtml(prefix + i)}</li>`).join("")}</ul>`;
}

/**
 * Render the facts page. Pure: no I/O.
 */
export function renderFactsPage(facts: Facts, business: Business, opts: RenderOptions = {}): RenderedFactsPage {
  facts = facts.country ? facts : withCountry(facts, business);
  const host = opts.host ?? defaultFactsHost(business);
  const protocol = opts.protocol ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  const canonicalUrl = opts.canonicalUrl ?? `${protocol}://${host}/`;
  const checkedAt = opts.verifiedAt ?? new Date().toISOString();
  const lastmod = facts.verifiedAt && new Date(facts.verifiedAt) > new Date(checkedAt) ? facts.verifiedAt : checkedAt;

  const jsonLd = buildJsonLd(facts, business, canonicalUrl);
  const llmsTxt = buildLlmsTxt(facts, business, canonicalUrl, checkedAt);
  const sitemapXml = buildSitemap(canonicalUrl, lastmod);

  const lang = langOf(facts);
  const t = T[lang];
  const title = t.title(facts.name, facts.place);
  const rows = hoursRows(facts.hours, lang);
  const addressLine = [facts.address, [facts.postcode, facts.place].filter(Boolean).join(" ")].filter(Boolean).join(", ");

  const phoneHref = facts.phone ? `tel:${facts.phone.replace(/\s+/g, "")}` : null;
  const routeHref = addressLine ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${facts.name}, ${addressLine}`)}` : null;
  const actions = [
    phoneHref ? `<a class="btn btn-primary" href="${escapeHtml(phoneHref)}">${t.call}</a>` : "",
    routeHref ? `<a class="btn ${phoneHref ? "btn-secondary" : "btn-primary"}" href="${escapeHtml(routeHref)}">${t.route}</a>` : "",
  ].filter(Boolean);

  const sections: string[] = [];

  sections.push(`<section id="over">
<h2>${t.about}</h2>
<p>${escapeHtml(t.isA(facts.name, businessNoun(facts, business.sector) ?? t.business, facts.place))} ${escapeHtml(openStatusLine(facts))}</p>
${business.kvk ? `<p class="meta">${t.kvkLong}: ${escapeHtml(business.kvk)}</p>` : ""}
</section>`);

  sections.push(`<section id="contact">
<h2>${t.contact}</h2>
<dl>
${addressLine ? `<dt>${t.address}</dt><dd>${escapeHtml(addressLine)}</dd>` : ""}
${facts.phone ? `<dt>${t.phone}</dt><dd><a href="tel:${escapeHtml(facts.phone.replace(/\s+/g, ""))}">${escapeHtml(facts.phone)}</a></dd>` : ""}
${facts.email ? `<dt>${t.email}</dt><dd><a href="mailto:${escapeHtml(facts.email)}">${escapeHtml(facts.email)}</a></dd>` : ""}
${safeWebUrl(facts.website) ? `<dt>Website</dt><dd><a href="${escapeHtml(safeWebUrl(facts.website)!)}" rel="me">${escapeHtml(facts.website!)}</a></dd>` : ""}
</dl>
</section>`);

  sections.push(`<section id="openingstijden">
<h2>${t.hours}</h2>
<table>
<tbody>
${rows.map((r) => `<tr><th scope="row">${r.day}</th><td>${escapeHtml(r.text)}</td></tr>`).join("\n")}
</tbody>
</table>
</section>`);

  if (facts.servicesYes.length || facts.servicesNo.length) {
    sections.push(`<section id="diensten">
<h2>${t.services}</h2>
${facts.servicesYes.length ? (facts.servicesNo.length ? `<p>${t.yes}:</p>${list(facts.servicesYes)}` : list(facts.servicesYes, "", "chips")) : ""}
${facts.servicesNo.length ? `<p>${t.no}:</p>${list(facts.servicesNo, `${t.no}: `)}` : ""}
</section>`);
  }

  if (facts.prices.length) {
    sections.push(`<section id="prijzen">
<h2>${t.prices}</h2>
<table>
<tbody>
${facts.prices.map((p) => `<tr><th scope="row">${escapeHtml(p.label)}</th><td>${escapeHtml(formatPrice(p, facts))}</td></tr>`).join("\n")}
</tbody>
</table>
${facts.prices.every((p) => /btw|vat/i.test(p.unit ?? "")) ? "" : `<p class="meta">${t.pricesVat}</p>`}
</section>`);
  }

  if (facts.policies.length) {
    sections.push(`<section id="beleid">
<h2>${t.policies}</h2>
${list(facts.policies)}
</section>`);
  }

  if (facts.paymentMethods.length) {
    sections.push(`<section id="betalen">
<h2>${t.payment}</h2>
<p>${escapeHtml(facts.paymentMethods.join(", "))}</p>
</section>`);
  }

  const areaText = serviceAreaLine(facts);
  if (areaText) {
    sections.push(`<section id="werkgebied">
<h2>${t.area}</h2>
<p>${escapeHtml(areaText)}</p>
</section>`);
  }

  const urgencyText = urgencyLine(facts);
  if (urgencyText) {
    sections.push(`<section id="spoed">
<h2>${t.urgent}</h2>
<p>${escapeHtml(urgencyText)}</p>
</section>`);
  }

  if (facts.credentials?.length) {
    sections.push(`<section id="erkenningen">
<h2>${t.credentials}</h2>
${list(facts.credentials)}
</section>`);
  }

  if (facts.notConfusedWith.length) {
    sections.push(`<section id="niet-te-verwarren">
<h2>${t.notConfused}</h2>
${list(facts.notConfusedWith)}
</section>`);
  }

  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(t.description(facts.name, facts.place))}">
<link rel="canonical" href="${escapeHtml(canonicalUrl)}">
<link rel="alternate" type="text/plain" href="/llms.txt">
<link rel="sitemap" type="application/xml" href="/sitemap.xml">
<meta name="robots" content="index, follow">${opts.googleSiteVerification ? `\n<meta name="google-site-verification" content="${escapeHtml(opts.googleSiteVerification)}">` : ""}
<meta name="last-modified" content="${escapeHtml(lastmod)}">
<style>${CSS}</style>
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>
</head>
<body>
<header>
<h1>${escapeHtml(facts.name)} in ${escapeHtml(facts.place)}</h1>
<p class="meta">${t.tagline}</p>
${actions.length ? `<div class="actions">${actions.join("")}</div>` : ""}
<p class="meta">${t.checkedOn} <time datetime="${escapeHtml(isoDate(checkedAt))}">${escapeHtml(formatDate(checkedAt, lang))}</time>.${
    facts.verifiedAt
      ? ` ${t.confirmedOn} <time datetime="${escapeHtml(isoDate(facts.verifiedAt))}">${escapeHtml(formatDate(facts.verifiedAt, lang))}</time>.`
      : ` ${t.notConfirmed}`
  }</p>
</header>
<main>
${sections.join("\n")}
</main>
<footer>
<p>${escapeHtml(t.official(facts.name, facts.version))} <a href="${escapeHtml(canonicalUrl)}">${escapeHtml(canonicalUrl)}</a></p>
<p><a href="/llms.txt">${t.textVersion}</a></p>
</footer>
</body>
</html>
`;

  return { html, jsonLd, llmsTxt, sitemapXml, canonicalUrl };
}
