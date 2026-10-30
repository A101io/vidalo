import { getI18n } from "@/lib/i18n";
import { requireVerifiedOwner } from "@/lib/owner";
import { factsHostFor, cnameTarget } from "@/lib/factsPage";
import { registerDomain } from "../actions";
import { ready } from "@/lib/core";
import { dateShort } from "@/lib/format";
import { Stip, type Tone } from "@/components/Stip";
import { factsPageStatus, siteCheckView, ENGINE_NAMES, type SiteIssue } from "@vidalo/core/publisher";
import type { Engine } from "@vidalo/core/types";
import type { CopyShape } from "@vidalo/core/copy";

type SiteCopy = CopyShape["domain"]["site"];

function joinNames(engines: Engine[], and: string): string {
  const names = engines.map((e) => ENGINE_NAMES[e]);
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} ${and} ${names.at(-1)}`;
}

/** One line of a status list: dot, label, state in words. */
function StatusLine({ tone, label, value }: { tone: Tone; label: string; value: string }) {
  return (
    <li className="flex items-start gap-3 border-t-[1.5px] border-line py-2.5 first:border-t-0">
      <span className="flex pt-[6px]">
        <Stip tone={tone} />
      </span>
      <span className="flex-1 sm:flex sm:justify-between sm:gap-6">
        <span className="block text-[15px]">{label}</span>
        <span className="block text-[14px] text-ink-2 sm:max-w-[60%] sm:text-right">{value}</span>
      </span>
    </li>
  );
}

/** The exact change for one failing item, worded like the owner mail (sitecheckEmail). */
function SiteFix({ issue, S, factsUrl }: { issue: SiteIssue; S: SiteCopy; factsUrl: string }) {
  const F = S.fix;
  switch (issue.kind) {
    case "robots_blocked": {
      const who = joinNames(issue.engines, S.and);
      return (
        <>
          <h4 className="font-bold">{F.robotsTitle(who, issue.engines.length === 1)}</h4>
          <p className="mt-1">{F.robotsBody(issue.robotsUrl, who)}</p>
          <p className="mt-2">{F.robotsFix}</p>
          <pre className="mt-2 overflow-x-auto rounded-[10px] bg-panel p-3 text-[13px]">{issue.robots.map((r) => `User-agent: ${r}\nAllow: /`).join("\n\n")}</pre>
        </>
      );
    }
    case "noindex":
      return (
        <>
          <h4 className="font-bold">{F.noindexTitle}</h4>
          <p className="mt-1">{F.noindexBody(issue.via)}</p>
          <p className="mt-2">{F.noindexFix}</p>
        </>
      );
    case "phone_mismatch":
      return (
        <>
          <h4 className="font-bold">{F.phoneTitle}</h4>
          <p className="mt-1">{F.phoneBody(issue.found, issue.expected)}</p>
          <p className="mt-2">{F.phoneFix}</p>
        </>
      );
    case "no_business_data":
      return (
        <>
          <h4 className="font-bold">{F.dataTitle}</h4>
          <p className="mt-1">{F.dataBody}</p>
          <p className="mt-1 break-all">
            <a className="underline" href={`${factsUrl}feiten.json`}>{`${factsUrl}feiten.json`}</a>
          </p>
        </>
      );
  }
}

export default async function DomainPage({ searchParams }: { searchParams: Promise<{ dns?: string; registreren?: string }> }) {
  const sp = await searchParams;
  const { business } = await requireVerifiedOwner("/app/domein");
  const { copy } = await getI18n();
  const D = copy.domain;
  const host = business.domain ? factsHostFor(business) : null;
  const verified = Boolean(business.factsHostVerifiedAt) || sp.dns === "ok";
  // google_index and the internal event rows are read with the service db, after requireVerifiedOwner, for this business only.
  const db = await ready();
  const [channels, googleIndex, events] = await Promise.all([db.listChannels(business.id), db.getGoogleIndex(business.id), db.listEvents(business.id, 500)]);
  const FS = D.factsStatus;
  const S = D.site;
  const page = factsPageStatus(channels.find((c) => c.type === "facts_page") ?? null, googleIndex);
  const site = siteCheckView(events);
  const factsUrl = (page.url ?? `https://${factsHostFor(business)}`).replace(/\/?$/, "/");
  const pageTone: Tone = page.published === "live" ? "groen" : page.published === "waiting_dns" ? "oranje" : "grijs";
  const googleTone: Tone = page.google === "indexed" ? "groen" : page.google === "not_indexed" ? "oranje" : "grijs";
  return (
    <div className="space-y-6">
      <header>
        <h1 className="h2">{D.h1}</h1>
        <p className="mt-2 max-w-[60ch] text-[17px] text-ink-2">{D.intro}</p>
      </header>

      <section className="card p-5 sm:p-6">
        <h2 className="h3">{D.optionA}</h2>
        {host ? (
          <>
            <p className="mt-2 text-[15px]">{D.optionAHint}</p>
            <table className="mt-3 w-full text-[14px]">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1 pr-4 font-normal">{D.recordType}</th>
                  <th className="py-1 pr-4 font-normal">{D.recordName}</th>
                  <th className="py-1 font-normal">{D.recordValue}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t-[1.5px] border-line">
                  <td className="py-2 pr-4">CNAME</td>
                  <td className="py-2 pr-4 break-all">{host}</td>
                  <td className="py-2 break-all">{cnameTarget()}</td>
                </tr>
              </tbody>
            </table>
            {verified ? (
              <p className="mt-4 text-[15px]">{D.verified(host)}</p>
            ) : (
              <>
                {sp.dns === "nee" && <p className="mt-4 text-[15px] text-muted">{D.notYet}</p>}
                <form action="/api/domain/verify" method="post" className="mt-4">
                  <input type="hidden" name="host" value={host} />
                  <button type="submit" className="btn-primary h-[52px]">
                    {D.checkButton}
                  </button>
                </form>
              </>
            )}
          </>
        ) : (
          <p className="mt-2 text-[15px] text-muted">{D.noDomain}</p>
        )}
      </section>

      <section className="card p-5 sm:p-6">
        <h2 className="h3">{D.optionB}</h2>
        <p className="mt-2 text-[15px]">{D.optionBHint(`${business.slug}.nl`)}</p>
        {sp.registreren === "ingepland" ? (
          <p className="mt-3 text-[15px]">{D.optionBQueued}</p>
        ) : (
          <form action={registerDomain} className="mt-4">
            <button type="submit" className="btn-sm">
              {D.optionBButton}
            </button>
          </form>
        )}
      </section>

      <section className="card p-5 sm:p-6">
        <h2 className="h3">{FS.h2}</h2>
        {page.url && (
          <p className="mt-2 break-all text-[15px]">
            <a className="underline" href={page.url}>
              {page.url}
            </a>
          </p>
        )}
        <ul className="mt-3">
          <StatusLine
            tone={pageTone}
            label={FS.pageLabel}
            value={page.published === "live" ? FS.published(dateShort(page.publishedAt!)) : page.published === "waiting_dns" ? FS.waitingDns(dateShort(page.publishedAt!)) : FS.notPublished}
          />
          <StatusLine
            tone={googleTone}
            label={FS.googleLabel}
            value={
              page.google === "indexed"
                ? FS.indexed(dateShort(page.googleIndexedAt ?? page.googleCheckedAt!), dateShort(page.googleCheckedAt!))
                : page.google === "not_indexed"
                  ? FS.notIndexed(dateShort(page.googleCheckedAt!))
                  : FS.notChecked
            }
          />
        </ul>
      </section>

      <section className="card p-5 sm:p-6">
        <h2 className="h3">{S.h2}</h2>
        {site.state === "not_checked" && (
          <p className="mt-2 flex items-center gap-3 text-[15px] text-muted">
            <Stip tone="grijs" /> {S.notChecked}
          </p>
        )}
        {site.state === "no_domain" && (
          <p className="mt-2 flex items-center gap-3 text-[15px] text-muted">
            <Stip tone="grijs" /> {S.noDomain(dateShort(site.at))}
          </p>
        )}
        {site.state === "checked" && (
          <>
            <p className="mt-2 text-[15px]">{S.intro(site.domain)}</p>
            <p className="mt-1 text-[14px] text-muted">{S.checkedAt(dateShort(site.at))}</p>

            <h3 className="mt-5 text-[15px] font-bold">{S.robotsH}</h3>
            <ul className="mt-1">
              {site.robots.map((r) => (
                <StatusLine
                  key={r.token}
                  tone={r.allowed === null ? "grijs" : r.allowed ? "groen" : "rood"}
                  label={`${r.token} · ${S.robotFor(joinNames(r.engines, S.and))}`}
                  value={r.allowed === null ? S.unknown : r.allowed ? S.allowed : S.blocked}
                />
              ))}
            </ul>

            <h3 className="mt-5 text-[15px] font-bold">{S.pageH}</h3>
            <ul className="mt-1">
              <StatusLine tone={site.noindex === null ? "grijs" : site.noindex ? "rood" : "groen"} label={S.noindexLabel} value={site.noindex === null ? S.unknown : site.noindex ? S.noindexBad : S.noindexOk} />
              <StatusLine tone={site.businessData === null ? "grijs" : site.businessData ? "groen" : "oranje"} label={S.dataLabel} value={site.businessData === null ? S.unknown : site.businessData ? S.present : S.absent} />
              <StatusLine tone={site.phoneOk === null ? "grijs" : site.phoneOk ? "groen" : "rood"} label={S.phoneLabel} value={site.phoneOk === null ? S.phoneNa : site.phoneOk ? S.phoneOk : S.phoneBad} />
            </ul>

            <h3 className="mt-5 text-[15px] font-bold">{S.changesH}</h3>
            {site.issues.length ? (
              <>
                <ol className="mt-2 space-y-4 text-[15px]">
                  {site.issues.map((issue, i) => (
                    <li key={i} className="rounded-[14px] border-[1.5px] border-line p-4">
                      <SiteFix issue={issue} S={S} factsUrl={factsUrl} />
                    </li>
                  ))}
                </ol>
                <p className="mt-3 text-[14px] text-muted">{S.forward}</p>
              </>
            ) : (
              <p className="mt-2 text-[15px] text-muted">{S.noChanges}</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
