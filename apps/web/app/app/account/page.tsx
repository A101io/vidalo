import Link from "next/link";
import { getI18n } from "@/lib/i18n";
import { isVerifiedOwner } from "@vidalo/core/shared";
import { Stip } from "@/components/Stip";
import { requireOwner } from "@/lib/owner";
import { loadDashboard } from "@/lib/reads";
import { getScanReport } from "@/lib/core";
import { dateShort, dateTime } from "@/lib/format";
import { checkNow, deleteMyData, setLanguage } from "../actions";
import { LANGS } from "@/lib/lang-paths";
import { MAIL_PREF_KEYS } from "@vidalo/core/shared";
import { changeEmail, saveMailPrefs } from "./actions";

export const dynamic = "force-dynamic";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 px-5 py-3.5 sm:grid-cols-[160px_1fr] sm:gap-6">
      <span className="text-[14px] text-muted">{label}</span>
      <span className="text-[15px]">{children}</span>
    </div>
  );
}

/**
 * The account page: who is signed in, the business as Vidalo knows it (from
 * the confirmed facts, falling back to what the scan found), the latest
 * finished report with its colour, the recent checks, the plan, and "Je
 * gegevens" (download, delete). Reading only, apart from the language and
 * the delete, the e-mail address and the mail choices; every other change has its own page (gegevens, domein, google, abonnement).
 */
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ taal?: string; gegevens?: string; email?: string; mails?: string }> }) {
  const sp = await searchParams;
  const { business, session } = await requireOwner("/app/account");
  const data = await loadDashboard(business.id);
  const { copy, href } = await getI18n();
  const A = copy.account;
  const B = copy.billing;
  const facts = data.facts;
  const verified = isVerifiedOwner(business, session.userId);
  const lastRun = data.scanRuns.find((r) => r.status === "done");
  const report = lastRun ? await getScanReport(lastRun.id) : null;
  const open = data.findings.filter((f) => f.status !== "resolved").length;
  const resolved = data.findings.length - open;
  const planTone = business.status === "paused" ? "rood" : business.status === "trial" || business.status === "active" ? "groen" : "grijs";
  const value = (v: string | null | undefined) => (v && v.trim() ? v : <span className="text-muted">{A.empty}</span>);

  return (
    <div className="space-y-10">
      <header>
        <h1 className="h2">{A.h1}</h1>
        <p className="mt-2 text-[17px] text-ink-2">{A.intro}</p>
      </header>

      {/* Signed in */}
      <section id="inlog">
        <h2 className="h3">{A.sections.login}</h2>
        <div className="card mt-3 divide-y-[1px] divide-line">
          <Row label={A.loginEmail}>{session.email}</Row>
          <Row label={A.changeEmail.label}>
            <form action={changeEmail} className="flex flex-wrap items-center gap-3">
              <input type="email" name="email" required autoComplete="email" aria-label={A.changeEmail.label} className="field-sm w-auto min-w-[240px]" />
              <button type="submit" className="btn-sm">
                {A.changeEmail.button}
              </button>
            </form>
            {sp.email && A.changeEmail.status[sp.email] && (
              <p className={`mt-2 text-[14px] ${["verstuurd", "gewijzigd", "bevestigd"].includes(sp.email) ? "text-groen" : "text-rood"}`} aria-live="polite">
                {A.changeEmail.status[sp.email]}
              </p>
            )}
            <p className="mt-2 text-[13px] text-muted">{A.changeEmail.body}</p>
          </Row>
          <Row label={A.ownerLabel}>
            <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-2">
                <Stip tone={verified ? "groen" : "grijs"} /> {verified && business.ownerVerifiedAt ? A.ownerVerified(dateShort(business.ownerVerifiedAt)) : A.ownerNotVerified}
              </span>
              {!verified && (
                <Link href={href("/app/google")} className="btn-link">
                  {A.verifyNow}
                </Link>
              )}
            </span>
          </Row>
          <Row label={A.language.label}>
            <form action={setLanguage} className="flex flex-wrap items-center gap-3">
              <select name="language" defaultValue={business.language} aria-label={A.language.label} className="field-sm w-auto">
                {LANGS.map((l) => (
                  <option key={l} value={l}>
                    {A.language.names[l]}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn-sm">
                {A.language.save}
              </button>
              {sp.taal === "opgeslagen" && <span className="text-[14px] text-groen">{A.language.saved}</span>}
            </form>
            <p className="mt-2 text-[13px] text-muted">{A.language.body}</p>
          </Row>
        </div>
      </section>

      {/* The business */}
      <section>
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="h3">{A.sections.business}</h2>
          <Link href={href("/app/gegevens")} className="btn-link">
            {A.editFacts}
          </Link>
        </div>
        <div className="card mt-3 divide-y-[1px] divide-line">
          <Row label={A.fields.name}>{facts?.name ?? business.name}</Row>
          <Row label={A.fields.place}>{facts?.place ?? business.place}</Row>
          <Row label={A.fields.address}>{value([facts?.address, facts?.postcode].filter(Boolean).join(", "))}</Row>
          <Row label={A.fields.phone}>{value(facts?.phone)}</Row>
          <Row label={A.fields.email}>{value(facts?.email)}</Row>
          <Row label={A.fields.website}>
            {facts?.website ? (
              <a href={facts.website} target="_blank" rel="noopener" className="underline-offset-2 hover:underline">
                {facts.website}
              </a>
            ) : (
              value(business.domain)
            )}
          </Row>
          <Row label={A.fields.kvk}>{value(business.kvk)}</Row>
          <Row label={A.fields.factsHost}>
            {business.factsHost ? (
              <span className="inline-flex items-center gap-2">
                <Stip tone={business.factsHostVerifiedAt ? "groen" : "oranje"} /> {business.factsHost}
              </span>
            ) : (
              <span className="inline-flex flex-wrap items-center gap-x-3">
                <span className="text-muted">{A.noFactsHost}</span>
                <Link href={href("/app/domein")} className="btn-link">
                  {A.setDomain}
                </Link>
              </span>
            )}
          </Row>
          <Row label={A.fields.factsVersion}>{facts && !facts.provisional ? A.factsConfirmed(facts.version, dateShort(facts.verifiedAt ?? new Date())) : <span className="text-muted">{A.factsProvisional}</span>}</Row>
        </div>
      </section>

      {/* Latest report */}
      <section>
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="h3">{A.sections.report}</h2>
          {lastRun && (
            <Link href={href(`/r/${lastRun.id}`)} className="btn-link">
              {A.viewReport}
            </Link>
          )}
        </div>
        <div className="card mt-3 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          {lastRun && report ? (
            <div className="flex items-start gap-4">
              <Stip tone={report.stip} size={22} className="mt-1" />
              <div>
                <p className="text-[17px] font-bold">{A.reportLine(report.totalAnswers - report.wrongAnswers - (report.notFoundAnswers ?? 0), report.totalAnswers)}</p>
                <p className="mt-1 text-[15px] text-ink-2">{copy.stipLine[report.stip]}</p>
                <p className="mt-1 text-[14px] text-muted">
                  {A.reportDate(dateShort(lastRun.finishedAt ?? lastRun.startedAt))} · {A.openFindings(open)} · {A.resolvedFindings(resolved)}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-[15px] text-muted">{A.noReport}</p>
          )}
          <form action={checkNow}>
            <button type="submit" className="btn-primary h-[52px]">
              {A.checkNow}
            </button>
          </form>
        </div>
      </section>

      {/* Recent checks */}
      <section>
        <h2 className="h3">{A.sections.runs}</h2>
        {data.scanRuns.length === 0 ? (
          <p className="mt-3 text-[15px] text-muted">{A.noRuns}</p>
        ) : (
          <ol className="card mt-3 divide-y-[1px] divide-line">
            {data.scanRuns.slice(0, 6).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 text-[15px]">
                <span>
                  {A.runKind[r.kind]} <span className="text-muted">· {dateTime(r.finishedAt ?? r.startedAt)}</span>
                </span>
                <span className="inline-flex items-center gap-2 text-[14px]">
                  <Stip tone={r.status === "done" ? "groen" : r.status === "failed" ? "rood" : "oranje"} /> {A.runStatus[r.status]}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Plan */}
      <section>
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="h3">{A.sections.plan}</h2>
          <Link href={href("/app/abonnement")} className="btn-link">
            {A.planLink}
          </Link>
        </div>
        <div className="card mt-3 divide-y-[1px] divide-line">
          <Row label={B.planLabel}>{B.plans[business.plan]}</Row>
          <Row label={B.statusLabel}>
            <span className="inline-flex items-center gap-2">
              <Stip tone={planTone} /> {B.statuses[business.status]}
            </span>
          </Row>
        </div>
      </section>

      {/* Mail preferences */}
      <section id="mails">
        <h2 className="h3">{A.mails.h}</h2>
        <form action={saveMailPrefs} className="card mt-3 space-y-4 px-5 py-4 text-[15px]">
          <p>{A.mails.body}</p>
          <ul className="space-y-3">
            {MAIL_PREF_KEYS.map((k) => (
              <li key={k}>
                <label className="flex items-start gap-2">
                  <input type="checkbox" name={k} value="aan" defaultChecked={business.mailPrefs[k] !== false} className="mt-1" />
                  <span>
                    <span className="font-semibold">{A.mails.optional[k].label}</span>
                    <span className="block text-[14px] text-ink-2">{A.mails.optional[k].body}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="border-t-[1px] border-line pt-4">
            <p className="font-semibold">{A.mails.requiredH}</p>
            <p className="mt-1 text-[14px] text-ink-2">{A.mails.required}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-sm">
              {A.mails.save}
            </button>
            {sp.mails === "opgeslagen" && <span className="text-[14px] text-groen">{A.mails.saved}</span>}
          </div>
        </form>
      </section>

      {/* My data */}
      <section id="gegevens">
        <h2 className="h3">{A.myData.h}</h2>
        <div className="card mt-3 space-y-4 px-5 py-4 text-[15px]">
          <p>{A.myData.body}</p>
          <a href="/api/account/export" download className="btn-link">
            {A.myData.download}
          </a>
          <form action={deleteMyData} className="space-y-3 border-t-[1px] border-line pt-4">
            <p className="text-ink-2">{A.myData.deleteBody}</p>
            {sp.gegevens === "abonnement" && <p className="text-[14px] text-rood">{A.myData.blocked}</p>}
            <label className="flex items-start gap-2">
              <input type="checkbox" name="confirm" value="ja" required className="mt-1" />
              <span>{A.myData.confirm}</span>
            </label>
            <button type="submit" className="btn-sm">
              {A.myData.deleteButton}
            </button>
          </form>
        </div>
      </section>

      <form action="/auth/uitloggen" method="post">
        <button type="submit" className="btn-sm">
          {A.logout}
        </button>
      </form>
    </div>
  );
}
