import Link from "next/link";
import { getI18n } from "@/lib/i18n";
import { LangSwitch } from "@/components/LangSwitch";
import { Logo } from "@/components/Logo";
import { CookieSettingsButton } from "@/components/CookieConsent";
import { OPTIONAL_CATEGORIES } from "@/lib/consent";

/** The "Cookie-instellingen" button only exists once there is a choice to change; until then the statement link is enough. */
const hasCookieChoice = OPTIONAL_CATEGORIES.length > 0;

/**
 * Footer. `variant="full"`: four columns + legal line (landing, result).
 * `variant="short"`: one line, legal left and a note right (sector pages, grey result).
 */
export async function SiteFooter({ variant = "full", note, tagline }: { variant?: "full" | "short"; note?: string; tagline?: string }) {
  const { copy, href } = await getI18n();
  const f = copy.landing.footer;
  if (variant === "short") {
    return (
      <footer className="border-t-[1.5px] border-line ground-cream">
        <div className="wrap flex flex-wrap justify-between gap-x-6 gap-y-2 py-10 text-[13px] text-muted print:py-4">
          <span>{f.legal}</span>
          <span className="flex flex-wrap gap-x-4 print:hidden">
            <Link href={href("/cookies")} className="nav-link">
              {copy.legal.cookies.title}
            </Link>
            {hasCookieChoice && <CookieSettingsButton label={copy.consent.settings} />}
            <span>{note ?? f.copyright}</span>
            <LangSwitch />
          </span>
        </div>
      </footer>
    );
  }
  return (
    <footer className="border-t-[1.5px] border-line ground-cream">
      <div className="wrap flex flex-col gap-10 pb-10 pt-14 print:py-4">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr] print:hidden">
          <div className="flex flex-col items-start gap-2.5">
            <Logo size={22} />
            <span className="max-w-[28ch] text-[14px] leading-[1.5] text-muted">{tagline ?? f.tagline}</span>
            {note && <span className="text-[13px] text-muted">{note}</span>}
            <LangSwitch />
          </div>
          {f.columns.map((c) => (
            <div key={c.title} className="flex flex-col gap-2.5 text-[14px]">
              <span className="font-bold">{c.title}</span>
              {c.links.map((l) => (
                <Link key={l.label} href={href(l.href)} className="nav-link text-ink-2">
                  {l.label}
                </Link>
              ))}
              {/* The cookie choice must be changeable from a named button; it sits under the legal links. */}
              {hasCookieChoice && c.links.some((l) => l.href === "/cookies") && <CookieSettingsButton label={copy.consent.settings} />}
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1.5 border-t-[1.5px] border-line pt-6 text-[13px] leading-[1.5] text-muted print:border-0 print:pt-0">
          <span>{f.legal}</span>
          <span className="print:hidden">{f.copyright}</span>
        </div>
      </div>
    </footer>
  );
}
