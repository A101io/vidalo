import type { Metadata } from "next";
import Link from "next/link";
import { renderFactsPage } from "@vidalo/core/publisher";
import { OWN_BUSINESS, OWN_FACTS } from "@vidalo/core/shared";
import { getI18n } from "@/lib/i18n";
import { JsonLd, OWN_FACTS_URL, breadcrumbLd, organizationLd, pageMetadata } from "@/lib/seo";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export async function generateMetadata(): Promise<Metadata> {
  const { copy, lang } = await getI18n();
  return pageMetadata({ title: copy.pages.ownFacts.title, description: copy.pages.ownFacts.description, route: "/feiten", lang });
}

/**
 * Vidalo's own facts page: the exact page the publisher serves for a customer
 * (same renderer, same record shape), on our own site. Practise what we
 * preach: dated, in HTML, schema.org and llms.txt, and "nog niet bevestigd"
 * until the owner confirmed it, as for anyone else.
 */
export default async function OwnFactsPage() {
  const { copy, lang, href } = await getI18n();
  const P = copy.pages.ownFacts;
  const { html } = renderFactsPage(OWN_FACTS, OWN_BUSINESS, { canonicalUrl: OWN_FACTS_URL });
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? html;
  // The publisher's page is a whole document with its own <main>; inside ours it is a section, not a second main landmark.
  const content = body.replace(/<main\b/g, "<div").replace(/<\/main>/g, "</div>");
  return (
    <>
      <JsonLd data={[organizationLd(copy), breadcrumbLd(copy, lang, [{ name: P.crumb, route: "/feiten" }])]} />
      <SiteHeader variant="short" />
      <main>
        <section className="wrap flex flex-col gap-5 pb-8 pt-8 sm:pt-12">
          <nav aria-label="Breadcrumb" className="text-[14px] text-muted">
            <Link href={href("/")} className="hover:text-ink">
              {copy.pages.home_crumb}
            </Link>
            <span aria-hidden> / </span>
            <span aria-current="page">{P.crumb}</span>
          </nav>
          <p className="lead max-w-[60ch]">{P.intro}</p>
          <a href="/llms.txt" className="text-[15px] font-semibold text-blue">
            {P.textVersion}
          </a>
        </section>
        <section className="wrap pb-16">
          <div
            data-static
            className="card max-w-[40rem] bg-white px-6 py-8 sm:px-8 [&_a]:text-blue [&_dd]:mb-2 [&_dt]:font-semibold [&_h1]:text-[28px] [&_h1]:font-extrabold [&_h2]:mt-7 [&_h2]:border-t-[1.5px] [&_h2]:border-line [&_h2]:pt-4 [&_h2]:text-[16px] [&_h2]:font-bold [&_th]:pr-6 [&_th]:text-left [&_th]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_.meta]:text-[14px] [&_.meta]:text-muted"
            dangerouslySetInnerHTML={{ __html: content }}
          />
        </section>
      </main>
      <SiteFooter variant="short" />
    </>
  );
}
