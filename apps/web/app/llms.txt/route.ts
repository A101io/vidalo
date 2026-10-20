import { copyFor, PRICES } from "@vidalo/core/copy";
import { buildLlmsTxt } from "@vidalo/core/publisher";
import { OWN_BUSINESS, OWN_FACTS } from "@vidalo/core/shared";
import { localizeHref } from "@/lib/lang-paths";
import { OWN_FACTS_URL, SITE } from "@/lib/seo";

/**
 * /llms.txt (llmstxt.org): what Vidalo is, in plain Markdown, for AI
 * assistants that read it. Vidalo publishes one for every customer's facts
 * page; this is its own. Built from the same copy as the pages, so the two
 * cannot disagree.
 */
export const dynamic = "force-static";

export function GET() {
  const nl = copyFor("nl");
  const en = copyFor("en");
  const u = (route: string, lang: "nl" | "en") => SITE + (localizeHref(route, lang) === "/" ? "" : localizeHref(route, lang));
  const steps = nl.landing.werkt.steps.map((s) => `- **${s.title}**: ${s.body}`).join("\n");
  const faq = nl.landing.vragen.items.map((it) => `- **${it.q}** ${it.a}`).join("\n");
  // The same facts block a customer's llms.txt gets, minus its own title line: one record, one renderer.
  const facts = buildLlmsTxt(OWN_FACTS, OWN_BUSINESS, OWN_FACTS_URL, new Date().toISOString()).split("\n").slice(4).join("\n").trim();
  const body = `# Vidalo

> ${nl.pages.home.description}

${nl.tagline} Vidalo is een dienst van A101 B.V. (Rotterdam, KvK 42057858) voor Nederlandse bedrijven. English: ${en.pages.home.description}

## Wat Vidalo doet
${steps}

## Prijs
- ${nl.landing.prijs.setup.name}: €${PRICES.setupEur} eenmalig, excl. btw. De eerste controle is gratis.
- ${nl.landing.prijs.monitor.name}: €${PRICES.monitorEurPerMonth} per maand, excl. btw, maandelijks opzegbaar.

## Pagina's
- [${nl.pages.home.title}](${u("/", "nl")}): gratis controle
- [${nl.pages.how.title}](${u("/hoe-het-werkt", "nl")})
- [${nl.pages.why.title}](${u("/waarom", "nl")})
- [${nl.pages.next.title}](${u("/straks", "nl")})
- [Prijs](${u("/prijzen", "nl")})
- [Voorbeeldrapport](${u("/r/voorbeeld", "nl")})
- English: [${en.pages.home.title}](${u("/", "en")}), [${en.pages.how.title}](${u("/hoe-het-werkt", "en")}), [${en.pages.next.title}](${u("/straks", "en")})

## Feiten over Vidalo
${facts}

## Veelgestelde vragen
${faq}

## Contact
hello@vidalo.io
`;
  return new Response(body, { headers: { "content-type": "text/markdown; charset=utf-8" } });
}
