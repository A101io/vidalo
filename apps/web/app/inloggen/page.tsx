import { redirect } from "next/navigation";
import { getI18n } from "@/lib/i18n";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { env } from "@/lib/env";
import { getSession } from "@/lib/session";
import { sendMagicLink } from "./actions";
import { TurnstileWidget } from "@/components/TurnstileWidget";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; business?: string; sent?: string; fout?: string }> }) {
  const sp = await searchParams;
  const { copy, href } = await getI18n();
  if (sp.fout !== "geen" && (await getSession())) redirect(href(sp.next ?? "/app"));
  const a = copy.auth;
  return (
    <>
      <SiteHeader variant="minimal" />
      <main className="wrap max-w-[560px] py-12 sm:py-16">
        <h1 className="h2">{a.h1}</h1>
        {sp.sent === "1" ? (
          <p className="lead mt-4">{a.sent}</p>
        ) : (
          <>
            <p className="lead mt-3">{a.body}</p>
            <form action={sendMagicLink} className="mt-6">
              <input type="hidden" name="next" value={sp.next ?? "/app"} />
              <input type="hidden" name="business" value={sp.business ?? ""} />
              <label htmlFor="email" className="field-label">
                {a.label}
              </label>
              <input id="email" name="email" type="email" required autoComplete="email" className="field" placeholder={copy.result.email.placeholder} />
              {sp.fout === "geen" && <p className="mt-2 text-[14px] text-rood">{a.noBusiness}</p>}
              {sp.fout === "1" && <p className="mt-2 text-[14px] text-rood">{copy.errors.generic}</p>}
              {sp.fout === "check" && <p className="mt-2 text-[14px] text-rood">{copy.errors.humanCheck}</p>}
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
      </main>
      <SiteFooter />
    </>
  );
}
