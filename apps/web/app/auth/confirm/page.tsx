import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { copyFor } from "@vidalo/core/copy";
import { safeNext } from "@vidalo/core/shared";
import { confirmSignInAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

type Query = { token_hash?: string; type?: string; code?: string; next?: string };

/**
 * The sign-in link from the mail opens this page (feature 002, ADR-0003). Opening it uses
 * nothing up: no call to Supabase, no cookie, no database. The button posts the link's
 * values to confirmSignInAction, which signs in. So a mail filter that opens links
 * before the owner does cannot spend the link. Language follows `next`.
 */
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<Query> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const lang = next === "/en" || next.startsWith("/en/") ? "en" : "nl";
  const c = copyFor(lang).accountSecurity.confirmPage;
  const field = (v: string | undefined) => (typeof v === "string" ? v.slice(0, 512) : "");
  return (
    <main lang={lang} className="wrap max-w-[480px] py-16 sm:py-24">
      <Logo size={24} />
      <h1 className="h2 mt-10">{c.title}</h1>
      <p className="lead mt-3">{c.body}</p>
      <form action={confirmSignInAction} className="mt-8">
        <input type="hidden" name="token_hash" value={field(sp.token_hash)} />
        <input type="hidden" name="type" value={field(sp.type)} />
        <input type="hidden" name="code" value={field(sp.code)} />
        <input type="hidden" name="next" value={next} />
        <button type="submit" className="btn-primary w-full">
          {c.button}
        </button>
      </form>
    </main>
  );
}
