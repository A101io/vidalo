import Link from "next/link";
import { getI18n } from "@/lib/i18n";

/** The footer behind the launch gate: the legal line, contact and the three legal pages, nothing that leads into the closed site. */
export async function ComingSoonFooter() {
  const { copy, href } = await getI18n();
  return (
    <footer className="border-t-[1.5px] border-line">
      <div className="wrap flex flex-wrap justify-between gap-x-6 gap-y-2 py-8 text-[13px] text-muted">
        <span>{copy.landing.footer.legal}</span>
        <span className="flex flex-wrap gap-x-4">
          <Link href={href("/contact")} className="nav-link">
            {copy.pages.contact.crumb}
          </Link>
          <Link href={href("/voorwaarden")} className="nav-link">
            {copy.legal.terms.title}
          </Link>
          <Link href={href("/privacy")} className="nav-link">
            {copy.legal.privacy.title}
          </Link>
          <Link href={href("/cookies")} className="nav-link">
            {copy.legal.cookies.title}
          </Link>
        </span>
      </div>
    </footer>
  );
}
