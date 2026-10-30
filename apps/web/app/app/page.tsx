import Link from "next/link";
import { getI18n } from "@/lib/i18n";
import { ENGINE_LABEL } from "@vidalo/core/types";
import type { Channel, Finding, FindingStatus, Stip as StipColour } from "@vidalo/core/types";
import { Stip } from "@/components/Stip";
import { BlueLink, Dot, LogRow, QuietLink, RailLabel, Row, Section, SmallButton } from "@/components/OwnerUi";
import { requireOwner } from "@/lib/owner";
import { loadOverview, sinceCounts, fixPlan, groupByQuestion } from "@/lib/owner-data";
import { buildLog } from "@/lib/owner-log";
import { dateLong, dateShort, dayMonth, hostOf } from "@/lib/format";
import { questionFor, wrongText, correctText } from "@/lib/questions";
import { pendingDiffOf } from "@vidalo/core/publisher";
import { checkNow, markFixed } from "./actions";

const statusTone: Record<FindingStatus, StipColour> = { open: "rood", fixing: "oranje", recheck: "oranje", resolved: "groen", unfixable: "grijs" };
const channelTone: Record<Channel["status"], StipColour> = { pending: "grijs", synced: "groen", mismatch: "oranje", failed: "rood", manual: "grijs" };

/** Distinct questions (fact + subject) among findings. */
function questionsAmong(findings: Finding[]): number {
  return new Set(findings.map((f) => `${f.factKey}:${f.subject ?? ""}`)).size;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ controle?: string }> }) {
  const sp = await searchParams;
  const { business } = await requireOwner();
  const data = await loadOverview(business);
  const { copy, href } = await getI18n();
  const d = copy.dashboard;
  const { lastRun, previousRun, report, fixes, gbp } = data;

  const open = data.findings.filter((f) => f.status !== "resolved");
  const resolved = data.findings.filter((f) => f.status === "resolved").sort((a, b) => (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? ""));
  const since = sinceCounts(data.findings, previousRun);
  const question = (f: Finding) => questionFor(f.factKey, f.subject, business.name, business.place, copy);
  const sourceOf = (f: Finding) => (f.sourceUrl ? hostOf(f.sourceUrl) : copy.sourceType[f.sourceType]);
  const findingHref = (f: Finding) => href(`/app/fouten/${f.id}`);

  // Setup, Google first: it proves ownership, and facts and domain wait for it.
  const setup = [
    { key: "google", done: Boolean(business.ownerVerifiedAt), title: d.you.google, body: d.you.googleBody, href: "/app/google" },
    { key: "facts", done: Boolean(data.facts && !data.facts.provisional), title: d.you.facts, body: d.you.factsBody, href: "/app/gegevens" },
    { key: "domain", done: Boolean(business.factsHostVerifiedAt), title: d.you.domain(business.factsHost ?? `feiten.${business.domain ?? ""}`), body: d.you.domainBody, href: "/app/domein" },
  ].filter((s) => !s.done);

  // What waits for the owner: their own website, a held Google change, setup.
  const yours = open.filter((f) => f.sourceType === "owned_website" && f.verdict === "wrong");
  const ours = open.filter((f) => !yours.includes(f));
  const ourGroups = groupByQuestion(ours);
  const openGroups = groupByQuestion(open);
  const youCount = yours.length + (gbp ? 1 : 0) + setup.length;
  // The fields the held Google change touches, in words: "Telefoon, Openingstijden, zaterdag".
  const fieldLabel = (field: string) => {
    const C = copy.channelPage.field;
    if (field.startsWith("hours.")) return `${C.hours}, ${copy.report.days[Number(field.slice(6))] ?? ""}`;
    return C[field as keyof typeof C] ?? field;
  };
  const gbpFields = gbp ? [...new Set(pendingDiffOf(gbp.channel).map((x) => fieldLabel(x.field)))].join(", ") : "";

  // Per AI system: the report's counts and colours, in the fixed engine order.
  // Most used in the Netherlands first (the stip's usage share), as on the result page.
  const usage = (engine: string) => report?.engineStips.find((s) => s.engine === engine)?.usage ?? 0;
  const engines = (report?.engines ?? [])
    .map((e) => ({
      ...e,
      label: ENGINE_LABEL[e.engine],
      stip: report?.engineStips.find((s) => s.engine === e.engine)?.stip ?? ("grijs" as StipColour),
      total: e.correct + e.wrong + e.notFound,
    }))
    .sort((a, b) => usage(b.engine) - usage(a.engine));
  const wrongQuestions = report ? questionsAmong(report.findings.filter((f) => f.verdict === "wrong")) : 0;
  const notFoundQuestions = report ? questionsAmong(report.findings.filter((f) => f.verdict === "not_found")) : 0;
  const activeEngines = engines.filter((e) => !e.skipped).length;
  const perQuestion = lastRun?.samplesPerPrompt ?? 3;
  const questions = report && activeEngines ? Math.round(report.totalAnswers / (activeEngines * perQuestion)) : 0;

  const log = buildLog(data.events, copy, href, gbp?.channel ?? null);
  const rechecks = [
    ...new Set(
      [...fixes.values()]
        .map((x) => x.recheckAt)
        .filter((x): x is string => Boolean(x))
        .sort()
        .map((x) => dayMonth(x)),
    ),
  ].slice(0, 3);
  const sources = data.channels.filter((c) => c.type !== "directory" || c.status !== "synced").slice(0, 8);

  return (
    <div className="flex flex-col gap-14">
      {/* The facts of the last check */}
      <header className="flex max-w-[720px] flex-col gap-3">
        <h1 className="h1-sm">{lastRun ? d.checkTitle(dateLong(lastRun.finishedAt ?? lastRun.startedAt ?? new Date())) : d.h1}</h1>
        {report && lastRun ? (
          <p className="m-0 text-[19px] leading-[1.5] text-ink-2">
            {d.checkIntro(questions, activeEngines, perQuestion, wrongQuestions, notFoundQuestions)} {since ? d.sinceLine(dayMonth(previousRun!.finishedAt ?? previousRun!.startedAt ?? ""), since.found, since.resolved, since.open) : d.firstFull}
          </p>
        ) : (
          <p className="m-0 text-[19px] text-ink-2">{d.noScan}</p>
        )}
        <p className="m-0 flex flex-wrap items-center gap-x-5 gap-y-1">
          {lastRun && <BlueLink href={href(`/r/${lastRun.id}`)}>{d.fullReport}</BlueLink>}
          <QuietLink href={href("/app/voortgang")}>{d.compare}</QuietLink>
        </p>
        {sp.controle === "ingepland" && <p className="m-0 rounded-xl bg-panel px-4 py-3 text-[15px]">{d.checkQueued}</p>}
      </header>

      <div className="grid gap-x-[72px] gap-y-12 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-14">
          {/* What now */}
          <Section title={d.whatNow}>
            <p className="m-0 text-[14px] text-muted">{d.whatNowIntro(youCount, ourGroups.length)}</p>
            <ol className="m-0 list-none p-0">
              {yours.map((f) => (
                <li key={f.id} className="flex flex-col gap-2 border-t-[1px] border-line py-4">
                  <p className="m-0 text-[17px]">
                    <Dot tone={statusTone[f.status]} />
                    <strong>{d.you.website(sourceOf(f))}</strong> {d.you.websiteBody(wrongText(f, copy), ENGINE_LABEL[f.engine], correctText(f, copy))}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pl-6">
                    {f.sourceUrl && (
                      <SmallButton href={f.sourceUrl} external>
                        {d.you.openPage}
                      </SmallButton>
                    )}
                    <form action={markFixed} className="m-0">
                      <input type="hidden" name="finding" value={f.id} />
                      <button type="submit" className="text-[15px] font-bold text-blue hover:underline">
                        {d.you.markFixed}
                      </button>
                    </form>
                    <QuietLink href={findingHref(f)}>{d.you.details}</QuietLink>
                  </div>
                </li>
              ))}
              {gbp && (
                <li className="flex flex-col gap-2 border-t-[1px] border-line py-4">
                  <p className="m-0 text-[17px]">
                    <Dot tone="oranje" />
                    <strong>{d.you.gbp(gbp.pending)}</strong> {d.you.gbpBody(gbpFields)}
                  </p>
                  <div className="pl-6">
                    <SmallButton href={href(`/app/vermeldingen/${gbp.channel.id}`)}>{d.you.viewChanges}</SmallButton>
                  </div>
                </li>
              )}
              {setup.map((s) => (
                <li key={s.key} className="flex flex-col gap-2 border-t-[1px] border-line py-4">
                  <p className="m-0 text-[17px]">
                    <Dot tone="grijs" />
                    <strong>{s.title}</strong> {s.body}
                  </p>
                  <div className="pl-6">
                    <SmallButton href={href(s.href)}>{d.you.setup}</SmallButton>
                  </div>
                </li>
              ))}
              {ourGroups.length > 0 && (
                <li className={`flex flex-col gap-2 border-t-[1.5px] border-ink py-4 ${youCount > 0 ? "mt-2" : ""}`}>
                  <span className="text-[14px] font-bold">{d.atUs}</span>
                  <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[16px] text-ink-2">
                    {ourGroups.map((g) => {
                      const plan = fixPlan(g.lead, fixes.get(g.lead.id) ?? null);
                      return (
                        <li key={g.key}>
                          <Dot tone={statusTone[g.lead.status]} />
                          <span className="font-semibold text-ink">{copy.factKey[g.lead.factKey]}</span> ({g.engines.map((e) => ENGINE_LABEL[e]).join(", ")}): {d.atUsLine(g.lead.verdict === "not_found" ? copy.fixPathNotFound : plan.labelNl, plan.recheckAt ? dateShort(plan.recheckAt) : null)}{" "}
                          <QuietLink href={findingHref(g.lead)}>{d.details}</QuietLink>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              )}
            </ol>
          </Section>

          {/* Per AI system */}
          {engines.length > 0 && (
            <Section title={d.perEngine}>
              <div className="grid grid-cols-3 gap-4 sm:grid-cols-6 sm:gap-5">
                {engines.map((e) => (
                  <div key={e.engine} className="flex flex-col gap-2.5">
                    <Stip tone={e.stip} size={22} className="!h-12 !w-12 sm:!h-14 sm:!w-14" />
                    <span className="text-[15px] font-bold">{e.label}</span>
                    <span className="text-[14px] text-muted">{e.skipped ? copy.result.hero.engineSkipped : d.engineLine(e.total, e.wrong, e.notFound)}</span>
                    {lastRun && <QuietLink href={href(`/r/${lastRun.id}`)}>{d.answers}</QuietLink>}
                  </div>
                ))}
              </div>
              <p className="m-0 max-w-[640px] text-[14px] text-muted">{d.engineLegend}</p>
            </Section>
          )}

          {/* Still open */}
          <Section title={d.open} aside={openGroups.length ? `${openGroups.length}` : undefined}>
            {openGroups.length === 0 ? (
              <p className="m-0 text-[15px] text-muted">{d.noFindings}</p>
            ) : (
              <ol className="m-0 list-none p-0">
                {openGroups.map((g, i) => {
                  const f = g.lead;
                  const plan = fixPlan(f, fixes.get(f.id) ?? null);
                  const you = f.sourceType === "owned_website" && f.verdict === "wrong";
                  const said = (f.verdict === "not_found" ? copy.result.table.notFound : wrongText(f, copy)).replace(/\.$/, "");
                  return (
                    <Row
                      key={g.key}
                      last={i === openGroups.length - 1}
                      right={
                        <>
                          {you && f.sourceUrl && (
                            <QuietLink href={f.sourceUrl} external>
                              {d.you.openPage}
                            </QuietLink>
                          )}
                          <BlueLink href={findingHref(f)}>{d.view}</BlueLink>
                        </>
                      }
                    >
                      <Dot tone={statusTone[f.status]} />
                      <strong>{question(f)}</strong>{" "}
                      <span className="text-[14px] text-muted">
                        {g.engines.map((e) => ENGINE_LABEL[e]).join(", ")}: {said}. {f.verdict === "not_found" ? "" : `${d.source(sourceOf(f))} `}
                        {you ? d.youLine : d.weLine(f.verdict === "not_found" ? copy.fixPathNotFound : plan.labelNl, plan.recheckAt ? dateShort(plan.recheckAt) : null)}
                      </span>
                    </Row>
                  );
                })}
              </ol>
            )}
          </Section>

          {/* Log */}
          <Section title={d.log}>
            {log.length === 0 ? (
              <p className="m-0 text-[15px] text-muted">{d.logEmpty}</p>
            ) : (
              <ol className="m-0 list-none p-0">
                {log.map((l, i) => (
                  <LogRow
                    key={i}
                    date={dayMonth(l.at)}
                    last={i === log.length - 1}
                    proof={
                      l.proof && (
                        <QuietLink href={l.proof.href} external={l.proof.external}>
                          {l.proof.label}
                        </QuietLink>
                      )
                    }
                  >
                    {l.text}
                  </LogRow>
                ))}
              </ol>
            )}
          </Section>
        </div>

        {/* Rail */}
        <aside className="flex min-w-0 flex-col gap-10">
          <div className="card flex flex-col gap-3.5 p-6">
            <RailLabel>{d.nextCheck}</RailLabel>
            <div className="text-[34px] font-extrabold leading-none" style={{ letterSpacing: "-1.5px" }}>
              {data.nextCheckAt ? dateShort(data.nextCheckAt) : "—"}
            </div>
            {business.anniversaryDay && <p className="m-0 text-[14px] text-muted">{d.nextCheckNote(business.anniversaryDay, rechecks.join(", "))}</p>}
            <form action={checkNow} className="m-0 flex">
              <button type="submit" className="btn-primary h-[52px] w-full">
                {d.checkNow}
              </button>
            </form>
          </div>

          <div className="flex flex-col gap-3">
            <RailLabel>{d.expand}</RailLabel>
            <ul className="m-0 flex list-none flex-col gap-3.5 p-0 text-[15px]">
              {d.expandItems.map((it) => (
                <li key={it.title} className="flex flex-col gap-0.5">
                  <strong>{it.title}</strong>
                  <span className="text-[14px] text-muted">{it.body}</span>
                  <a href={`mailto:support@vidalo.io?subject=${encodeURIComponent(`${it.subject}: ${business.name}, ${business.place}`)}`} className="text-[15px] font-bold text-blue hover:underline">
                    {it.cta}
                  </a>
                </li>
              ))}
            </ul>
            <p className="m-0 text-[14px] text-muted">{d.expandNote}</p>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <RailLabel>{d.sources}</RailLabel>
              <QuietLink href={href(`/feiten/${business.slug}`)}>{d.factsPage}</QuietLink>
            </div>
            {sources.length === 0 ? (
              <p className="m-0 text-[14px] text-muted">{d.noChannels}</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[15px]">
                {sources.map((c) => (
                  <li key={c.id}>
                    <Dot tone={channelTone[c.status]} />
                    <Link href={href(`/app/vermeldingen/${c.id}`)} className={c.type === "gbp" && gbp ? "font-semibold" : ""}>
                      {c.name}
                    </Link>{" "}
                    <span className="text-[14px] text-muted">{c.type === "gbp" && gbp ? d.sourceWaiting(gbp.pending) : copy.channelStatus[c.status].toLowerCase()}</span>
                  </li>
                ))}
              </ul>
            )}
            {data.channels.length > sources.length && <span className="text-[14px] text-muted">{d.allSources(data.channels.length)}</span>}
          </div>

          {resolved.length > 0 && (
            <div className="flex flex-col gap-3">
              <RailLabel>{d.proof}</RailLabel>
              <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[15px]">
                {resolved.slice(0, 3).map((f) => (
                  <li key={f.id}>
                    <Dot tone="groen" />
                    <Link href={findingHref(f)}>{copy.factKey[f.factKey]}</Link>{" "}
                    <span className="text-[14px] text-muted">
                      {ENGINE_LABEL[f.engine]}
                      {f.resolvedAt ? `, ${dateShort(f.resolvedAt)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
              {resolved.length > 3 && <span className="text-[14px] text-muted">{d.allProof(resolved.length)}</span>}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <RailLabel>{d.subscription}</RailLabel>
            <p className="m-0 text-[14px] text-muted">{d.subscriptionLine(copy.billing.plans[business.plan], null)}</p>
            <form action="/api/billing/portal" method="post" className="m-0">
              <button type="submit" className="text-[14px] text-muted underline underline-offset-[3px] hover:text-blue">
                {d.invoicesLink}
              </button>
            </form>
          </div>
        </aside>
      </div>
    </div>
  );
}
