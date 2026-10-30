import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT, telHref, waHref } from "@vidalo/core/shared";
import { getI18n } from "@/lib/i18n";
import { JsonLd, breadcrumbLd, organizationLd, pageMetadata } from "@/lib/seo";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export async function generateMetadata(): Promise<Metadata> {
  const { copy, lang } = await getI18n();
  return pageMetadata({ title: copy.pages.contact.title, description: copy.pages.contact.description, route: "/contact", lang });
}

/** /contact: WhatsApp, phone and mail, with when we answer. Outside the launch gate, like the legal pages. */
export default async function ContactPage() {
  const { copy, lang, href } = await getI18n();
  const P = copy.pages.contact;
  const ways = [
    { ...P.whatsapp, value: CONTACT.whatsapp, href: waHref(CONTACT.whatsapp), primary: true, external: true },
    { ...P.phone, value: CONTACT.phone, href: telHref(CONTACT.phone), primary: false, external: false },
    { ...P.mail, value: CONTACT.email, href: `mailto:${CONTACT.email}`, primary: false, external: false },
  ];
  return (
    <>
      <JsonLd data={[organizationLd(copy), breadcrumbLd(copy, lang, [{ name: P.crumb, route: "/contact" }])]} />
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
          <h1 className="h2">{P.h1}</h1>
          <p className="lead max-w-[60ch]">{P.intro}</p>
        </section>
        <section className="wrap grid gap-4 pb-12 sm:grid-cols-3">
          {ways.map((w) => (
            <div key={w.h} className="card flex flex-col gap-3 bg-white p-6">
              <h2 className="text-[18px] font-bold">{w.h}</h2>
              <a href={w.href} className="text-[17px] font-semibold text-ink underline underline-offset-4">
                {w.value}
              </a>
              <p className="text-[15px] leading-[1.5] text-ink-2">{w.p}</p>
              {"supportLabel" in w && (
                <p className="text-[15px] text-ink-2">
                  {w.supportLabel}:{" "}
                  <a href={`mailto:${CONTACT.support}`} className="font-semibold text-ink underline underline-offset-4">
                    {CONTACT.support}
                  </a>
                </p>
              )}
              <a
                href={w.href}
                className={`mt-auto ${w.primary ? "btn-primary" : "btn-outline"} h-12 text-[15px]`}
                {...(w.external ? { target: "_blank", rel: "noopener" } : {})}
              >
                {w.button}
              </a>
            </div>
          ))}
        </section>
        <section className="wrap max-w-[720px] pb-16">
          <h2 className="h3">{P.include.h}</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[16px] leading-relaxed text-ink-2">
            {P.include.items.map((it) => (
              <li key={it}>{it}</li>
            ))}
          </ul>
          <p className="mt-4 text-[16px] leading-relaxed text-ink-2">{P.never}</p>
          <p className="mt-8 text-[15px] text-muted">{P.company}</p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
