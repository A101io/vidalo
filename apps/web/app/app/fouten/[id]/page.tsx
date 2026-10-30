import { notFound } from "next/navigation";
import { getI18n } from "@/lib/i18n";
import { ENGINE_LABEL } from "@vidalo/core/types";
import type { Claim, Fix, FindingStatus, Sample, Stip as StipColour } from "@vidalo/core/types";
import { BlueLink, Dot, LogRow, MarkGrey, MarkOk, MarkWrong, QuietLink, RailLabel, Ring, Section, SmallButton } from "@/components/OwnerUi";
import { requireOwner } from "@/lib/owner";
import { loadFinding, fixPlan } from "@/lib/owner-data";
import { dateShort, dayMonth, hostOf } from "@/lib/format";
import { questionFor, wrongText, correctText } from "@/lib/questions";
import { dispute, markFixed } from "../../actions";

const statusTone: Record<FindingStatus, StipColour> = { open: "rood", fixing: "oranje", recheck: "oranje", resolved: "groen", unfixable: "grijs" };

/** "09:14" in Dutch time. */
function clock(iso: string): string {
  return new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

/** The answer text with the quoted wrong part marked, when the claim's quote is in it. */
function Quote({ sample, claim, grey }: { sample: Sample; claim: Claim | undefined; grey: boolean }) {
  const q = claim?.rawQuote?.trim();
  const i = q ? sample.answerText.indexOf(q) : -1;
  if (!q || i < 0) return <>{sample.answerText}</>;
  const Mark = grey ? MarkGrey : MarkWrong;
  return (
    <>
      {sample.answerText.slice(0, i)}
      <Mark>{q}</Mark>
      {sample.answerText.slice(i + q.length)}
    </>
  );
}

/** What a fix's evidence says it did, as dated lines (oldest first). */
function evidenceLines(fix: Fix, copy: Awaited<ReturnType<typeof getI18n>>["copy"], href: (h: string) => string): { at: string; text: string; tone: StipColour; proof?: { href: string; label: string; external?: boolean } }[] {
  const E = copy.findingPage.evidence;
  const P = copy.findingPage.proof;
  const ev = fix.evidence as Record<string, unknown>;
  const out: ReturnType<typeof evidenceLines> = [];
  const obj = (k: string) => (ev[k] && typeof ev[k] === "object" && !Array.isArray(ev[k]) ? (ev[k] as Record<string, unknown>) : null);
  const at = (o: Record<string, unknown> | null, k = "at") => (o && typeof o[k] === "string" ? (o[k] as string) : fix.scheduledAt);
  const publish = obj("publish");
  if (publish) out.push({ at: at(publish), text: E.publish(typeof publish.factsVersion === "number" ? publish.factsVersion : null), tone: "groen", proof: typeof publish.url === "string" ? { href: publish.url, label: P.factsPage, external: true } : undefined });
  const sync = obj("sync");
  if (sync) out.push({ at: fix.scheduledAt, text: E.sync(String(sync.channelName ?? copy.sourceType.directory_api), copy.channelStatus[(sync.status as keyof typeof copy.channelStatus) ?? "pending"] ?? String(sync.status)), tone: sync.status === "synced" ? "groen" : "oranje", proof: typeof sync.channelId === "string" ? { href: href(`/app/vermeldingen/${sync.channelId}`), label: P.channel } : undefined });
  if (Array.isArray(ev.sync)) out.push({ at: fix.scheduledAt, text: E.syncMany(ev.sync.length), tone: "groen" });
  const email = obj("email");
  if (email) {
    out.push({ at: at(email, "queuedAt"), text: E.email(String(email.to ?? "")), tone: "oranje" });
    for (const d of Array.isArray(email.followUpsSent) ? (email.followUpsSent as string[]) : []) out.push({ at: fix.scheduledAt, text: E.emailFollowUp(d), tone: "oranje" });
  }
  const ownerMail = obj("ownerMail");
  if (ownerMail) {
    out.push({ at: at(ownerMail, "queuedAt"), text: E.ownerMail, tone: "oranje" });
    for (const d of Array.isArray(ownerMail.remindersSent) ? (ownerMail.remindersSent as string[]) : []) out.push({ at: fix.scheduledAt, text: E.ownerReminder(d), tone: "oranje" });
  }
  const form = obj("form");
  if (form) out.push({ at: at(form), text: E.form, tone: "oranje" });
  if (typeof ev.escalatedAt === "string") out.push({ at: ev.escalatedAt, text: E.escalated, tone: "oranje" });
  if (typeof ev.ownerMarkedFixedAt === "string") out.push({ at: ev.ownerMarkedFixedAt, text: E.ownerMarked, tone: "oranje" });
  if (typeof ev.disputedAt === "string") out.push({ at: ev.disputedAt, text: E.disputed, tone: "grijs" });
  for (const r of Array.isArray(ev.rechecks) ? (ev.rechecks as { at?: string; outcome?: string; scanRunId?: string }[]) : []) {
    out.push({ at: r.at ?? fix.scheduledAt, text: E.recheck(r.outcome ?? ""), tone: r.outcome === "resolved" ? "groen" : "oranje", proof: r.scanRunId ? { href: href(`/r/${r.scanRunId}`), label: P.report } : undefined });
  }
  if (typeof ev.note === "string" && fix.action === "none") out.push({ at: fix.scheduledAt, text: E.note, tone: "grijs" });
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

export default async function FindingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ hercontrole?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { business } = await requireOwner(`/app/fouten/${id}`);
  const detail = await loadFinding(id, business);
  if (!detail) notFound();
  const { copy, href } = await getI18n();
  const F = copy.findingPage;
  const { finding: f, fix, run, samples, claims, others } = detail;

  const engine = ENGINE_LABEL[f.engine];
  const question = questionFor(f.factKey, f.subject, business.name, business.place, copy);
  const wrong = wrongText(f, copy);
  const correct = correctText(f, copy);
  const notFoundVerdict = f.verdict === "not_found";
  const you = f.sourceType === "owned_website" && !notFoundVerdict;
  const host = f.sourceUrl ? hostOf(f.sourceUrl) : null;
  const sourceName = host ?? copy.sourceType[f.sourceType];
  const plan = fixPlan(f, fix);
  const recheckDate = plan.recheckAt ? dateShort(plan.recheckAt) : null;
  const checkedAt = run?.finishedAt ?? run?.startedAt ?? f.firstSeenAt;
  const claimFor = (s: Sample) => claims.find((c) => c.sampleId === s.id && c.factKey === f.factKey && (c.subject ?? null) === (f.subject ?? null));
  const cited = host ? samples.filter((s) => s.citations.some((c) => hostOf(c) === host)).length : 0;
  const names = (v: "correct" | "wrong" | "not_found") => others.filter((o) => o.verdict === v).map((o) => ENGINE_LABEL[o.engine]);
  const did = fix ? evidenceLines(fix, copy, href) : [];
  const done = f.status === "resolved" || f.status === "unfixable";
  const supportRef = `${copy.factKey[f.factKey]}, ${dateShort(f.firstSeenAt)}`;

  const steps: { key: string; label: string; date: string | null; tone: StipColour | null; current: boolean }[] = [
    { key: "found", label: F.rail.steps.found, date: dateShort(f.firstSeenAt), tone: "rood", current: f.status === "open" },
    { key: "fixing", label: F.rail.steps.fixing, date: fix ? dateShort(fix.scheduledAt) : null, tone: fix ? "oranje" : null, current: f.status === "fixing" },
    { key: "recheck", label: F.rail.steps.recheck, date: recheckDate ? `${recheckDate}${you ? `, ${F.rail.orEarlier}` : ""}` : null, tone: f.status === "recheck" || done ? "oranje" : null, current: f.status === "recheck" },
    f.status === "unfixable"
      ? { key: "unfixable", label: F.rail.steps.unfixable, date: f.resolvedAt ? dateShort(f.resolvedAt) : null, tone: "grijs", current: true }
      : { key: "resolved", label: F.rail.steps.resolved, date: f.resolvedAt ? dateShort(f.resolvedAt) : F.rail.resolvedWhen, tone: f.status === "resolved" ? "groen" : null, current: f.status === "resolved" },
  ];

  return (
    <div className="flex flex-col gap-12">
      <QuietLink href={href("/app")}>← {F.back}</QuietLink>

      <header className="flex max-w-[760px] flex-col gap-3">
        <p className="m-0 text-[14px] text-muted">
          <Dot tone={statusTone[f.status]} />
          {F.meta(copy.findingStatus[f.status], dateShort(fix?.scheduledAt ?? f.firstSeenAt), dateShort(f.firstSeenAt), copy.factKey[f.factKey])}
        </p>
        <h1 className="h1-sm">{notFoundVerdict ? F.h1NotFound(engine) : F.h1(engine, wrong)}</h1>
        <p className="m-0 text-[19px] leading-[1.5] text-ink-2">{notFoundVerdict ? F.introNotFound(question, engine, f.frequency, f.sampleCount, correct) : F.intro(question, engine, f.frequency, f.sampleCount, wrong, correct, sourceName)}</p>
        {sp.hercontrole && <p className="m-0 rounded-xl bg-panel px-4 py-3 text-[15px]">{sp.hercontrole === "ingepland" ? F.flash.scheduled : F.flash.none}</p>}
      </header>

      <div className="grid gap-x-[72px] gap-y-12 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-12">
          {/* What now */}
          <Section title={F.whatNow}>
            {you ? (
              <>
                <div className="grid gap-6 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <span className="text-[14px] font-bold">{F.nowOn(host ?? "")}</span>
                    <p className="m-0 border-l-[1.5px] border-line pl-4 text-[17px] text-ink-2">
                      {F.wrongThere("")}
                      <MarkWrong>{wrong}</MarkWrong>
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <span className="text-[14px] font-bold">{F.replaceBy}</span>
                    <p className="m-0 border-l-[1.5px] border-ink pl-4 text-[17px] font-semibold">
                      <MarkOk>{correct}</MarkOk>
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  {f.sourceUrl && (
                    <SmallButton href={f.sourceUrl} external>
                      {F.openPage}
                    </SmallButton>
                  )}
                </div>
                <p className="m-0 max-w-[640px] text-[14px] text-muted">{F.websiteNote(recheckDate)}</p>
              </>
            ) : (
              <p className="m-0 max-w-[640px] text-[17px] text-ink-2">
                <Dot tone={statusTone[f.status]} />
                {F.weDo(notFoundVerdict ? copy.fixPathNotFound : plan.labelNl, done ? null : recheckDate)}
              </p>
            )}
          </Section>

          {/* The raw answers */}
          <Section title={F.saidTitle(engine)} aside={F.askedTimes(f.sampleCount, dateShort(checkedAt))}>
            {samples.length === 0 ? (
              <p className="m-0 text-[15px] text-muted">{F.noSamples}</p>
            ) : (
              <div className="grid gap-6 sm:grid-cols-3">
                {samples.slice(0, 6).map((s) => (
                  <figure key={s.id} className="m-0 flex flex-col gap-2">
                    <figcaption className="text-[14px] text-muted">{clock(s.capturedAt)}</figcaption>
                    <blockquote className="m-0 border-l-[1.5px] border-ink pl-4 text-[17px] italic leading-[1.5]">
                      <Quote sample={s} claim={claimFor(s)} grey={notFoundVerdict} />
                    </blockquote>
                  </figure>
                ))}
              </div>
            )}
            {others.length > 0 && <p className="m-0 max-w-[640px] text-[14px] text-muted">{F.others(names("correct"), names("not_found"), names("wrong"))}</p>}
          </Section>

          {/* The source */}
          <Section title={F.sourceTitle}>
            {f.sourceUrl ? (
              <p className="m-0 max-w-[640px] text-[17px]">
                <Dot tone="rood" />
                <a href={f.sourceUrl} target="_blank" rel="nofollow noopener" className="font-semibold hover:text-blue">
                  {host}
                </a>{" "}
                <span className="text-[14px] text-muted">{F.sourceMeta(copy.sourceType[f.sourceType], dateShort(checkedAt))}</span>
              </p>
            ) : (
              <p className="m-0 max-w-[640px] text-[17px]">
                <Dot tone="grijs" />
                {copy.sourceType[f.sourceType]}
              </p>
            )}
            <p className="m-0 max-w-[640px] text-[14px] text-muted">{f.sourceUrl ? F.sourceCited(cited, samples.length) : F.sourceNone}</p>
          </Section>

          {/* What Vidalo did */}
          <Section title={F.didTitle}>
            <ol className="m-0 list-none p-0">
              <LogRow date={dayMonth(f.firstSeenAt)}>
                <Dot tone="rood" />
                {F.found(engine, f.frequency, f.sampleCount)}
                {run && (
                  <>
                    {" "}
                    <QuietLink href={href(`/r/${run.id}`)}>{F.proof.report}</QuietLink>
                  </>
                )}
              </LogRow>
              {did.map((l, i) => (
                <LogRow key={i} date={dayMonth(l.at)}>
                  <Dot tone={l.tone} />
                  {l.text}
                  {l.proof && (
                    <>
                      {" "}
                      <QuietLink href={l.proof.href} external={l.proof.external}>
                        {l.proof.label}
                      </QuietLink>
                    </>
                  )}
                </LogRow>
              ))}
              <LogRow date={plan.recheckAt && !done ? dayMonth(plan.recheckAt) : ""} last>
                <span className="text-muted">
                  <Ring />
                  {done ? (f.status === "resolved" ? F.rail.steps.resolved : F.rail.steps.unfixable) : plan.recheckAt ? F.planned(engine) : F.notPlanned}
                </span>
              </LogRow>
            </ol>
          </Section>
        </div>

        {/* Rail: the two answers, the status, support */}
        <aside className="flex min-w-0 flex-col gap-10">
          {!done && (
            <div className="card flex flex-col gap-3.5 p-6">
              <RailLabel>{F.rail.you}</RailLabel>
              <p className="m-0 text-[15px] text-ink-2">{you ? F.rail.youWebsite(recheckDate) : F.rail.youOther}</p>
              <form action={markFixed} className="m-0 flex">
                <input type="hidden" name="finding" value={f.id} />
                <button type="submit" className="btn-primary h-[52px] w-full">
                  {F.rail.markFixed}
                </button>
              </form>
              <form action={dispute} className="m-0 flex">
                <input type="hidden" name="finding" value={f.id} />
                <button type="submit" className="btn-outline h-[52px] w-full">
                  {F.rail.dispute}
                </button>
              </form>
              <p className="m-0 text-[14px] text-muted">{F.rail.disputeNote}</p>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <RailLabel>{F.rail.status}</RailLabel>
            <ol className="m-0 flex list-none flex-col gap-2.5 p-0 text-[15px]">
              {steps.map((s) => (
                <li key={s.key} className={s.current ? "font-bold" : "text-muted"}>
                  {s.tone ? <Dot tone={s.tone} /> : <Ring />}
                  {s.label} {s.date && <span className="text-[14px] font-normal text-muted">{s.date}</span>}
                </li>
              ))}
            </ol>
          </div>

          <div className="flex flex-col gap-2">
            <RailLabel>{F.rail.questions}</RailLabel>
            <p className="m-0 text-[14px] text-muted">{F.rail.support(supportRef)}</p>
          </div>
          <BlueLink href={href("/app")}>← {F.back}</BlueLink>
        </aside>
      </div>
    </div>
  );
}
