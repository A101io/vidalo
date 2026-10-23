import { getLang, getRoute, localizeHref } from "@/lib/i18n";
import { getSession } from "@/lib/session";
import { LANGS } from "@/lib/lang-paths";

/**
 * NL · EN: the same page in the other language. Plain links, so it keeps
 * the session (cookies are per site, not per language) and works without
 * script. A plain <a>, not next/link: a client-side navigation never
 * re-renders the root layout (<html lang>), and /binnenkort ↔ /en/coming-soon
 * rewrite to one route, so the router got the English payload and left the
 * Dutch page standing (vidalo.io, 23 Oct 2026). Signed in, the link goes through /api/lang, which saves the
 * choice on the account before continuing, so the dashboard and the
 * report follow it.
 */
export async function LangSwitch({ className = "" }: { className?: string }) {
  const [lang, route, session] = [await getLang(), await getRoute(), await getSession()];
  const hrefFor = (l: (typeof LANGS)[number]) => (session ? `/api/lang?to=${l}&next=${encodeURIComponent(route)}` : localizeHref(route, l));
  return (
    <span className={`lang-switch ${className}`}>
      {LANGS.map((l) => (
        <a key={l} href={hrefFor(l)} hrefLang={l} lang={l} aria-current={l === lang ? "true" : undefined} className={l === lang ? "is-current" : ""}>
          {l.toUpperCase()}
        </a>
      ))}
    </span>
  );
}
