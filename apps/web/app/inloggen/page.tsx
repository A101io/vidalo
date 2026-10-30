import Link from "next/link";
import { redirect } from "next/navigation";
import { getI18n } from "@/lib/i18n";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { env } from "@/lib/env";
import { getSession, getOwnedBusiness } from "@/lib/session";
import { ready } from "@/lib/db";
import { claimBusiness, sendMagicLink } from "./actions";
import { safeNext } from "@/lib/auth-confirm";
import { TurnstileWidget } from "@/components/TurnstileWidget";

export const dynamic = "force-dynamic";

/**
 * /inloggen in four states:
 *  - not signed in: the e-mail form (magic link).
 *  - signed in, business linked: straight on to `next`.
 *  - signed in, `business` in the URL (from /welkom after checkout): one
 *    button that links that business to this account (actions.claimBusiness).
 *  - signed in, no business: say so, with a free check and sign-out. Before
 *    22 Oct 2026 this showed the e-mail form with a red "geen bedrijf" error,
 *    and a new link could not fix it.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; business?: string; sent?: string; fout?: string; verwijderd?: string }> }) {
  const sp = await searchParams;
  const { copy, href } = await getI18n();
  const a = copy.auth;
  const next = safeNext(sp.next ?? null);
  const session = await getSession();

  if (session) {
    const owned = await getOwnedBusiness(session);
    const wanted = sp.business ? await (await ready()).getBusiness(sp.business) : null;
    const claimable = wanted && !(owned && owned.id === wanted.id) && (!wanted.ownerEmail || wanted.ownerEmail.toLowerCase() === session.email.toLowerCase()) && (!wanted.ownerUserId || wanted.ownerUserId === session.userId);
    if (claimable) {
      return (
        <Shell>
          <h1 className="h2">{a.signedInH1}</h1>
          <p className="lead mt-3">{a.signedInAs(session.email)}</p>
          <form action={claimBusiness} className="mt-6">
            <input type="hidden" name="next" value={next} />
            <input type="hidden" name="business" value={wanted.id} />
            <p className="text-[17px] font-bold">{a.linkBusiness(wanted.name, wanted.place)}</p>
            <button type="submit" className="btn-primary mt-4 w-full">
              {a.linkButton}
            </button>
          </form>
          <SignOut label={a.otherEmail} />
        </Shell>
      );
    }
    if (owned && sp.fout !== "geen" && sp.fout !== "bezet") redirect(href(next));
    if (owned) redirect(href("/app"));
    // Signed in, but no business belongs to this address yet (requireOwner).
    return (
      <Shell>
        <h1 className="h2">{a.signedInH1}</h1>
        {sp.verwijderd === "1" && <p className="mt-3 text-[15px]">{copy.account.myData.deleted}</p>}
        <p className="lead mt-3">{sp.fout === "bezet" ? `${a.signedInAs(session.email)} ${a.linkTaken}` : a.noBusinessSignedIn(session.email)}</p>
        <Link href={href("/#top")} className="btn-primary mt-6 w-full">
          {a.startCheck}
        </Link>
        <SignOut label={a.otherEmail} />
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="h2">{a.h1}</h1>
      {sp.verwijderd === "1" && <p className="mt-3 text-[15px]">{copy.account.myData.deleted}</p>}
      {sp.sent === "1" ? (
        <p className="lead mt-4">{a.sent}</p>
      ) : (
        <>
          <p className="lead mt-3">{a.body}</p>
          <form action={sendMagicLink} className="mt-6">
            <input type="hidden" name="next" value={next} />
            <input type="hidden" name="business" value={sp.business ?? ""} />
            <label htmlFor="email" className="field-label">
              {a.label}
            </label>
            <input id="email" name="email" type="email" required autoComplete="email" className="field" placeholder={copy.result.email.placeholder} />
            {sp.fout === "geen" && <p className="mt-2 text-[14px] text-rood">{a.noBusiness}</p>}
            {sp.fout === "1" && <p className="mt-2 text-[14px] text-rood">{copy.errors.generic}</p>}
            {sp.fout === "wacht" && <p className="mt-2 text-[14px] text-rood">{a.rateLimited}</p>}
            {sp.fout === "check" && <p className="mt-2 text-[14px] text-rood">{copy.errors.humanCheck}</p>}
            {sp.fout === "link" && <p className="mt-2 text-[14px] text-rood">{a.linkExpired}</p>}
            <div className="mt-4">
              <TurnstileWidget />
            </div>
            <button type="submit" className="btn-primary mt-4 w-full">
              {a.button}
            </button>
          </form>
          {!env.hasSupabase && <p className="mt-4 text-[14px] text-muted">{a.mockHint}</p>}
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader variant="minimal" />
      <main className="wrap max-w-[560px] py-12 sm:py-16">{children}</main>
      <SiteFooter />
    </>
  );
}

function SignOut({ label }: { label: string }) {
  return (
    <form action="/auth/uitloggen" method="post" className="mt-4">
      <button type="submit" className="btn-link">
        {label}
      </button>
    </form>
  );
}
