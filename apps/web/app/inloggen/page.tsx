import Link from "next/link";
import { redirect } from "next/navigation";
import { getI18n } from "@/lib/i18n";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { env } from "@/lib/env";
import { endedSignInReason, getSession, getOwnedBusiness } from "@/lib/session";
import { ready } from "@/lib/db";
import { reportsRequestedBy } from "@/lib/core";
import { dateShort } from "@/lib/format";
import { claimBusiness, sendMagicLink } from "./actions";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { isBusinessId, safeNext } from "@vidalo/core/shared";

export const dynamic = "force-dynamic";

/**
 * /inloggen in four states:
 *  - not signed in: the e-mail form (magic link).
 *  - signed in, business linked: straight on to `next`.
 *  - signed in, `business` in the URL (from /welkom after checkout): one
 *    button that links that business to this account (actions.claimBusiness),
 *    which needs the paid checkout session from /welkom (core/shared/claim.ts).
 *  - signed in, no business: say so, with a free check and sign-out. Before
 *    22 Oct 2026 this showed the e-mail form with a red "geen bedrijf" error,
 *    and a new link could not fix it.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; business?: string; session_id?: string; sent?: string; fout?: string; verwijderd?: string; uitgelogd?: string; opnieuw?: string }> }) {
  const sp = await searchParams;
  const { copy, href } = await getI18n();
  const a = copy.auth;
  const next = safeNext(sp.next ?? null);
  const session = await getSession();
  const S = copy.accountSecurity;

  const again = sp.opnieuw === "1";
  if (session && !again) {
    const owned = await getOwnedBusiness(session);
    // Only a business id, never a slug. The button only offers; claimBusiness checks the payment.
    const wanted = sp.business && isBusinessId(sp.business) ? await (await ready()).getBusiness(sp.business) : null;
    const claimable = wanted && !(owned && owned.id === wanted.id) && !wanted.ownerUserId;
    if (claimable) {
      return (
        <Shell>
          <h1 className="h2">{a.signedInH1}</h1>
          <p className="lead mt-3">{a.signedInAs(session.email)}</p>
          <form action={claimBusiness} className="mt-6">
            <input type="hidden" name="next" value={next} />
            <input type="hidden" name="business" value={wanted.id} />
            <input type="hidden" name="session_id" value={sp.session_id ?? ""} />
            <p className="text-[17px] font-bold">{a.linkBusiness(wanted.name, wanted.place)}</p>
            <button type="submit" className="btn-primary mt-4 w-full">
              {a.linkButton}
            </button>
          </form>
          <SignOut label={a.otherEmail} />
        </Shell>
      );
    }
    if (owned && sp.fout !== "geen" && sp.fout !== "bezet" && sp.fout !== "betaling") redirect(href(next));
    if (owned) redirect(href("/app"));
    // Signed in, but no business belongs to this address yet (requireOwner). The free checks
    // this address asked for are still its own to see (Julian, 11 Nov 2026: "vorige scans beschikbaar").
    const checks = await reportsRequestedBy(session.email);
    return (
      <Shell>
        <h1 className="h2">{a.signedInH1}</h1>
        {sp.verwijderd === "1" && <p className="mt-3 text-[15px]">{copy.account.myData.deleted}</p>}
        <p className="lead mt-3">{sp.fout === "bezet" ? `${a.signedInAs(session.email)} ${a.linkTaken}` : sp.fout === "betaling" ? `${a.signedInAs(session.email)} ${a.linkUnpaid}` : a.noBusinessSignedIn(session.email)}</p>
        {checks.length > 0 && (
          <section className="mt-8" aria-labelledby="my-checks">
            <h2 id="my-checks" className="h3">
              {a.myChecksH2}
            </h2>
            <p className="mt-2 text-[15px] text-ink-2">{a.myChecksNote}</p>
            <ul className="mt-4 flex list-none flex-col gap-2 p-0">
              {checks.map((c) => (
                <li key={c.runId} className="card flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <span className="min-w-0">
                    <strong>
                      {c.name}, {c.place}
                    </strong>
                    <span className="block text-[14px] text-muted">{dateShort(c.checkedAt)}</span>
                  </span>
                  <Link href={href(`/r/${c.runId}`)} className="btn-sm">
                    {a.viewReport}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        <Link href={href("/#top")} className={checks.length > 0 ? "btn-sm mt-6 w-full" : "btn-primary mt-6 w-full"}>
          {a.startCheck}
        </Link>
        <SignOut label={a.otherEmail} />
      </Shell>
    );
  }

  // This browser's sign-in ended by itself (unused, too old, or signed out everywhere elsewhere): say why once.
  const ended = !sp.sent && !sp.fout && !sp.uitgelogd && !sp.verwijderd ? await endedSignInReason() : null;
  const expired = sp.fout === "verlopen" || ended === "idle" || ended === "max_age" || ended === "signed_out_everywhere";
  return (
    <Shell>
      <h1 className="h2">{a.h1}</h1>
      <p role="status" aria-live="polite" className="mt-3 text-[15px] empty:hidden">
        {sp.verwijderd === "1" ? copy.account.myData.deleted : sp.uitgelogd === "overal" ? S.signedOutEverywhere : again && !sp.sent ? S.reSignIn : expired ? S.expired : ""}
      </p>
      {sp.sent === "1" ? (
        <p className="lead mt-4">{a.sent}</p>
      ) : (
        <>
          <p className="lead mt-3">{a.body}</p>
          <form action={sendMagicLink} className="mt-6">
            <input type="hidden" name="next" value={next} />
            <input type="hidden" name="business" value={sp.business ?? ""} />
            <input type="hidden" name="session_id" value={sp.session_id ?? ""} />
            <label htmlFor="email" className="field-label">
              {a.label}
            </label>
            <input id="email" name="email" type="email" required autoComplete="email" className="field" placeholder={copy.result.email.placeholder} defaultValue={again && session ? session.email : undefined} />
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
          <h2 className="h3 mt-10">{a.noAccountH2}</h2>
          <p className="mt-2 text-[15px] text-ink-2">{a.noAccount}</p>
          <Link href={href("/#top")} className="mt-3 inline-block underline">
            {a.startCheck}
          </Link>
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
