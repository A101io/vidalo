import type { Metadata } from "next";
import { PRICES, type CopyShape } from "@vidalo/core/copy";
import { buildJsonLd } from "@vidalo/core/publisher";
import { CONTACT, OWN_BUSINESS, OWN_FACTS, OWN_FACTS_PATH, waHref } from "@vidalo/core/shared";
import { localizeHref, type Lang } from "./lang-paths";

/**
 * Metadata and structured data, one place. Every public page says the same
 * thing three ways: to people (the page), to search engines (title,
 * description, canonical, hreflang, Open Graph) and to AI assistants
 * (JSON-LD and /llms.txt). Only what the page itself shows goes in here.
 */
export const SITE = (process.env.PUBLIC_BASE_URL ?? "https://vidalo.io").replace(/\/$/, "");
const abs = (path: string) => SITE + (path === "/" ? "" : path);

/** Title, description, canonical, both languages and the share card for one route. */
export function pageMetadata({ title, description, route, lang, absoluteTitle = false }: { title: string; description: string; route: string; lang: Lang; absoluteTitle?: boolean }): Metadata {
  const url = abs(localizeHref(route, lang));
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: {
      canonical: url,
      languages: { nl: abs(localizeHref(route, "nl")), en: abs(localizeHref(route, "en")), "x-default": abs(route) },
    },
    openGraph: { title, description, url, siteName: "Vidalo", locale: lang === "en" ? "en_GB" : "nl_NL", alternateLocale: lang === "en" ? "nl_NL" : "en_GB", type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

/** The own facts page's address on this site. */
export const OWN_FACTS_URL = abs(OWN_FACTS_PATH);

/**
 * Vidalo's own structured data: the very LocalBusiness block the facts page
 * renders for a customer, built from `OWN_FACTS`, plus what an Organization
 * says about itself. Practise what we preach: our data comes from the same
 * record and the same renderer as a customer's.
 */
export function organizationLd(copy: CopyShape) {
  const facts = buildJsonLd(OWN_FACTS, OWN_BUSINESS, OWN_FACTS_URL);
  return {
    ...facts,
    "@type": ["Organization", "LocalBusiness"],
    "@id": `${SITE}/#organization`,
    name: copy.brand,
    legalName: "A101 B.V.",
    url: SITE,
    email: CONTACT.email,
    telephone: CONTACT.phone,
    contactPoint: [
      { "@type": "ContactPoint", contactType: "customer service", telephone: CONTACT.phone, email: CONTACT.support, availableLanguage: ["nl", "en"], url: `${SITE}/contact` },
      { "@type": "ContactPoint", contactType: "customer service", telephone: CONTACT.whatsapp, url: waHref(CONTACT.whatsapp), name: "WhatsApp", availableLanguage: ["nl", "en"] },
    ],
    // The logo Google shows in results and the knowledge panel: square, at least 112px, crawlable (public/logo-512.png, rendered from app/icon.svg).
    logo: { "@type": "ImageObject", url: `${SITE}/logo-512.png`, width: 512, height: 512 },
    description: copy.tagline,
    identifier: { "@type": "PropertyValue", propertyID: "KvK", value: OWN_BUSINESS.kvk },
    subjectOf: OWN_FACTS_URL,
  };
}

export function websiteLd(copy: CopyShape, lang: Lang) {
  return { "@context": "https://schema.org", "@type": "WebSite", "@id": `${SITE}/#website`, url: abs(localizeHref("/", lang)), name: copy.brand, inLanguage: lang, publisher: { "@id": `${SITE}/#organization` } };
}

/** The service and its two prices, exactly as on the price block (excl. btw). */
export function serviceLd(copy: CopyShape, lang: Lang) {
  const P = copy.landing.prijs;
  const offer = (name: string, price: number, monthly: boolean) => ({
    "@type": "Offer",
    name,
    price: price.toFixed(2),
    priceCurrency: "EUR",
    priceSpecification: {
      "@type": "UnitPriceSpecification",
      price: price.toFixed(2),
      priceCurrency: "EUR",
      valueAddedTaxIncluded: false,
      ...(monthly ? { unitCode: "MON", billingDuration: "P1M" } : {}),
    },
    url: abs(localizeHref("/prijzen", lang)),
    availability: "https://schema.org/InStock",
  });
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: copy.pages.home.title,
    description: copy.pages.home.description,
    provider: { "@id": `${SITE}/#organization` },
    areaServed: { "@type": "Country", name: "Nederland" },
    audience: { "@type": "BusinessAudience" },
    serviceType: "AI answer monitoring and correction for local businesses",
    offers: [offer(P.setup.name, PRICES.setupEur, false), offer(P.monitor.name, PRICES.monitorEurPerMonth, true)],
  };
}

export function faqLd(items: readonly { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((it) => ({ "@type": "Question", name: it.q, acceptedAnswer: { "@type": "Answer", text: it.a } })),
  };
}

export function breadcrumbLd(copy: CopyShape, lang: Lang, crumbs: { name: string; route: string }[]) {
  const all = [{ name: copy.pages.home_crumb, route: "/" }, ...crumbs];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: all.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: abs(localizeHref(c.route, lang)) })),
  };
}

/** The glossary on /straks as terms an assistant can quote. */
export function termsLd(copy: CopyShape, lang: Lang) {
  const A = copy.landing.agents;
  return {
    "@context": "https://schema.org",
    "@type": "DefinedTermSet",
    name: A.termsTitle,
    url: abs(localizeHref("/straks", lang)),
    inLanguage: lang,
    hasDefinedTerm: A.terms.map((t) => ({ "@type": "DefinedTerm", name: t.term, description: t.body })),
  };
}

/** One <script type="application/ld+json"> per object; "<" escaped so text can never close the tag. */
export function JsonLd({ data }: { data: object | object[] }) {
  const list = Array.isArray(data) ? data : [data];
  return (
    <>
      {list.map((d, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(d).replace(/</g, "\\u003c") }} />
      ))}
    </>
  );
}
