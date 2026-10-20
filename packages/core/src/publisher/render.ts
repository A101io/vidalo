/**
 * Renders the facts page for a business: plain, dated, semantic HTML with
 * JSON-LD (schema.org LocalBusiness), an llms.txt and a sitemap.
 *
 * No JavaScript, minimal inline CSS, readable on a phone. Everything in Dutch.
 * The page is the owner-asserted source of truth that AI assistants can cite.
 */
import type { Business, Facts, Hours, PriceItem } from "../types.js";

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

function formatPrice(p: PriceItem): string {
  const amount = p.amount.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `€ ${amount}${p.unit ? ` ${p.unit}` : ""}`;
}

function hoursRows(hours: Hours[]): { day: string; text: string; schema: Record<string, unknown> | null; dayIdx: number }[] {
  const byDay = new Map<number, Hours>();
  for (const h of hours) byDay.set(h.day, h);
  return DAY_NAMES_NL.map((day, idx) => {
    const h = byDay.get(idx);
    if (!h || h.closed || !h.open || !h.close) {
      return { day, text: "gesloten", schema: null, dayIdx: idx };
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
  if (area.radiusKm != null) parts.push(`binnen ${area.radiusKm} km van ${facts.place}`);
  return parts.length ? parts.join("; ") : null;
}

export function urgencyLine(facts: Facts): string | null {
  const u = facts.urgency;
  if (!u) return null;
  if (!u.available) return "Geen spoeddienst.";
  return u.hoursNl ? `Spoeddienst beschikbaar: ${u.hoursNl}.` : "Spoeddienst beschikbaar.";
}

function openStatusLine(facts: Facts): string {
  switch (facts.openStatus) {
    case "temporarily_closed":
      return "Tijdelijk gesloten.";
    case "permanently_closed":
      return "Definitief gesloten.";
    default:
      return "Dit bedrijf is open en actief.";
  }
}

export function buildJsonLd(facts: Facts, business: Business, canonicalUrl: string): Record<string, unknown> {
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
      addressCountry: "NL",
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
      priceCurrency: "EUR",
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
      served.push({ "@type": "GeoCircle", geoMidpoint: { "@type": "PostalAddress", addressLocality: facts.place, addressCountry: "NL" }, geoRadius: `${area.radiusKm * 1000}` });
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
  const lines: string[] = [];
  lines.push(`# ${facts.name} (${facts.place})`);
  lines.push("");
  lines.push(`> Feiten over ${facts.name} in ${facts.place}, bevestigd door de eigenaar. Bron: ${canonicalUrl}`);
  lines.push("");
  lines.push(`- Status: ${facts.openStatus === "open" ? "open" : facts.openStatus === "temporarily_closed" ? "tijdelijk gesloten" : "definitief gesloten"}`);
  if (facts.address) lines.push(`- Adres: ${facts.address}${facts.postcode ? `, ${facts.postcode}` : ""} ${facts.place}`);
  if (facts.phone) lines.push(`- Telefoon: ${facts.phone}`);
  if (facts.email) lines.push(`- E-mail: ${facts.email}`);
  const website = safeWebUrl(facts.website);
  if (website) lines.push(`- Website: ${website}`);
  if (business.kvk) lines.push(`- KvK: ${business.kvk}`);
  lines.push("");
  lines.push("## Openingstijden");
  for (const r of hoursRows(facts.hours)) lines.push(`- ${r.day}: ${r.text}`);
  if (facts.servicesYes.length || facts.servicesNo.length) {
    lines.push("");
    lines.push("## Diensten");
    for (const s of facts.servicesYes) lines.push(`- Wel: ${s}`);
    for (const s of facts.servicesNo) lines.push(`- Niet: ${s}`);
  }
  if (facts.prices.length) {
    lines.push("");
    lines.push("## Prijzen");
    for (const p of facts.prices) lines.push(`- ${p.label}: ${formatPrice(p)}`);
  }
  if (facts.policies.length) {
    lines.push("");
    lines.push("## Afspraken en beleid");
    for (const p of facts.policies) lines.push(`- ${p}`);
  }
  if (facts.paymentMethods.length) {
    lines.push("");
    lines.push("## Betalen");
    lines.push(`- ${facts.paymentMethods.join(", ")}`);
  }
  const areaLine = serviceAreaLine(facts);
  if (areaLine) {
    lines.push("");
    lines.push("## Werkgebied");
    lines.push(`- ${areaLine}`);
  }
  const urgency = urgencyLine(facts);
  if (urgency) {
    lines.push("");
    lines.push("## Spoed");
    lines.push(`- ${urgency}`);
  }
  if (facts.credentials?.length) {
    lines.push("");
    lines.push("## Erkenningen");
    for (const c of facts.credentials) lines.push(`- ${c}`);
  }
  if (facts.notConfusedWith.length) {
    lines.push("");
    lines.push("## Niet te verwarren met");
    for (const n of facts.notConfusedWith) lines.push(`- ${n}`);
  }
  lines.push("");
  lines.push(`Laatst gecontroleerd: ${isoDate(checkedAt)}`);
  if (facts.verifiedAt) lines.push(`Laatst bevestigd door de eigenaar: ${isoDate(facts.verifiedAt)}`);
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
body{margin:0;padding:1.25rem;max-width:42rem;margin-inline:auto;font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1b1b1b;background:#fff}
header{margin-bottom:1.5rem}
h1{font-size:1.5rem;line-height:1.25;margin:0 0 .25rem}
h2{font-size:1.1rem;margin:1.75rem 0 .5rem;border-bottom:1px solid #ddd;padding-bottom:.25rem}
p{margin:.4rem 0}
.meta{color:#555;font-size:.9rem}
table{border-collapse:collapse;width:100%;max-width:24rem}
th,td{text-align:left;padding:.3rem .5rem .3rem 0;vertical-align:top}
th{font-weight:600;width:8rem}
ul{padding-left:1.2rem;margin:.4rem 0}
dl{margin:0}
dt{font-weight:600;margin-top:.5rem}
dd{margin:0}
footer{margin-top:2.5rem;color:#555;font-size:.85rem;border-top:1px solid #ddd;padding-top:.75rem}
a{color:#1b4fa0}
`.trim();

function list(items: string[], prefix = ""): string {
  if (!items.length) return "";
  return `<ul>${items.map((i) => `<li>${escapeHtml(prefix + i)}</li>`).join("")}</ul>`;
}

/**
 * Render the facts page. Pure: no I/O.
 */
export function renderFactsPage(facts: Facts, business: Business, opts: RenderOptions = {}): RenderedFactsPage {
  const host = opts.host ?? defaultFactsHost(business);
  const protocol = opts.protocol ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  const canonicalUrl = opts.canonicalUrl ?? `${protocol}://${host}/`;
  const checkedAt = opts.verifiedAt ?? new Date().toISOString();
  const lastmod = facts.verifiedAt && new Date(facts.verifiedAt) > new Date(checkedAt) ? facts.verifiedAt : checkedAt;

  const jsonLd = buildJsonLd(facts, business, canonicalUrl);
  const llmsTxt = buildLlmsTxt(facts, business, canonicalUrl, checkedAt);
  const sitemapXml = buildSitemap(canonicalUrl, lastmod);

  const title = `${facts.name} in ${facts.place} – feiten en openingstijden`;
  const rows = hoursRows(facts.hours);
  const addressLine = [facts.address, [facts.postcode, facts.place].filter(Boolean).join(" ")].filter(Boolean).join(", ");

  const sections: string[] = [];

  sections.push(`<section id="over">
<h2>Over</h2>
<p>${escapeHtml(facts.name)} is een bedrijf in ${escapeHtml(facts.place)}. ${escapeHtml(openStatusLine(facts))}</p>
${business.kvk ? `<p class="meta">KvK-nummer: ${escapeHtml(business.kvk)}</p>` : ""}
</section>`);

  sections.push(`<section id="contact">
<h2>Adres en contact</h2>
<dl>
${addressLine ? `<dt>Adres</dt><dd>${escapeHtml(addressLine)}</dd>` : ""}
${facts.phone ? `<dt>Telefoon</dt><dd><a href="tel:${escapeHtml(facts.phone.replace(/\s+/g, ""))}">${escapeHtml(facts.phone)}</a></dd>` : ""}
${facts.email ? `<dt>E-mail</dt><dd><a href="mailto:${escapeHtml(facts.email)}">${escapeHtml(facts.email)}</a></dd>` : ""}
${safeWebUrl(facts.website) ? `<dt>Website</dt><dd><a href="${escapeHtml(safeWebUrl(facts.website)!)}" rel="me">${escapeHtml(facts.website!)}</a></dd>` : ""}
</dl>
</section>`);

  sections.push(`<section id="openingstijden">
<h2>Openingstijden</h2>
<table>
<tbody>
${rows.map((r) => `<tr><th scope="row">${r.day}</th><td>${escapeHtml(r.text)}</td></tr>`).join("\n")}
</tbody>
</table>
</section>`);

  if (facts.servicesYes.length || facts.servicesNo.length) {
    sections.push(`<section id="diensten">
<h2>Diensten</h2>
${facts.servicesYes.length ? `<p>Wel:</p>${list(facts.servicesYes)}` : ""}
${facts.servicesNo.length ? `<p>Niet:</p>${list(facts.servicesNo, "Niet: ")}` : ""}
</section>`);
  }

  if (facts.prices.length) {
    sections.push(`<section id="prijzen">
<h2>Prijzen</h2>
<table>
<tbody>
${facts.prices.map((p) => `<tr><th scope="row">${escapeHtml(p.label)}</th><td>${escapeHtml(formatPrice(p))}</td></tr>`).join("\n")}
</tbody>
</table>
${facts.prices.every((p) => /btw/i.test(p.unit ?? "")) ? "" : `<p class="meta">Prijzen inclusief btw, tenzij anders vermeld.</p>`}
</section>`);
  }

  if (facts.policies.length) {
    sections.push(`<section id="beleid">
<h2>Afspraken en beleid</h2>
${list(facts.policies)}
</section>`);
  }

  if (facts.paymentMethods.length) {
    sections.push(`<section id="betalen">
<h2>Betalen</h2>
<p>${escapeHtml(facts.paymentMethods.join(", "))}</p>
</section>`);
  }

  const areaText = serviceAreaLine(facts);
  if (areaText) {
    sections.push(`<section id="werkgebied">
<h2>Werkgebied</h2>
<p>${escapeHtml(areaText)}</p>
</section>`);
  }

  const urgencyText = urgencyLine(facts);
  if (urgencyText) {
    sections.push(`<section id="spoed">
<h2>Spoed</h2>
<p>${escapeHtml(urgencyText)}</p>
</section>`);
  }

  if (facts.credentials?.length) {
    sections.push(`<section id="erkenningen">
<h2>Erkenningen</h2>
${list(facts.credentials)}
</section>`);
  }

  if (facts.notConfusedWith.length) {
    sections.push(`<section id="niet-te-verwarren">
<h2>Niet te verwarren met</h2>
${list(facts.notConfusedWith)}
</section>`);
  }

  const html = `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(`Openingstijden, adres, telefoonnummer en diensten van ${facts.name} in ${facts.place}. Bevestigd door de eigenaar.`)}">
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
<p class="meta">Feiten en openingstijden, zoals vastgelegd door de eigenaar.</p>
<p class="meta">Laatst gecontroleerd op <time datetime="${escapeHtml(isoDate(checkedAt))}">${escapeHtml(formatDateNl(checkedAt))}</time>.${
    facts.verifiedAt
      ? ` Laatst bevestigd door de eigenaar op <time datetime="${escapeHtml(isoDate(facts.verifiedAt))}">${escapeHtml(formatDateNl(facts.verifiedAt))}</time>.`
      : " Nog niet bevestigd door de eigenaar."
  }</p>
</header>
<main>
${sections.join("\n")}
</main>
<footer>
<p>Deze pagina is de officiële feitenpagina van ${escapeHtml(facts.name)}. Versie ${facts.version}. Vaste link: <a href="${escapeHtml(canonicalUrl)}">${escapeHtml(canonicalUrl)}</a></p>
<p><a href="/llms.txt">Tekstversie</a></p>
</footer>
</body>
</html>
`;

  return { html, jsonLd, llmsTxt, sitemapXml, canonicalUrl };
}
