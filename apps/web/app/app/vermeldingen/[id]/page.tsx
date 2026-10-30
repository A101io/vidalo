import { notFound } from "next/navigation";
import { getI18n } from "@/lib/i18n";
import type { Channel, Facts, Stip as StipColour } from "@vidalo/core/types";
import { diffDecision, type ChannelDiffEntry } from "@vidalo/core/publisher";
import { formatPhoneNl } from "@vidalo/core/scanner";
import { Dot, MarkOk, MarkWrong, QuietLink, Section } from "@/components/OwnerUi";
import { requireOwner } from "@/lib/owner";
import { loadChannel } from "@/lib/owner-data";
import { loadDashboard } from "@/lib/reads";
import { dateShort, dateTime } from "@/lib/format";
import { approveChannelDiff, declineChannelDiff } from "../../actions";

const channelTone: Record<Channel["status"], StipColour> = { pending: "grijs", synced: "groen", mismatch: "oranje", failed: "rood", manual: "grijs" };

/** One line of the profile: what the source shows now and what the facts say. */
interface Line {
  field: string;
  label: string;
  now: string | null;
  after: string | null;
  changed: boolean;
}

/** The facts as the sync compares them (publisher/channels/types.ts diffFacts), in the profile's reading order. */
function profileLines(facts: Facts | null, diff: ChannelDiffEntry[], copy: Awaited<ReturnType<typeof getI18n>>["copy"]): Line[] {
  const C = copy.channelPage;
  const byField = new Map(diff.map((d) => [d.field, d]));
  const pretty = (field: string, v: string | null) => (v && field === "phone" && v.startsWith("+31") ? formatPhoneNl(v) : v);
  const line = (field: string, label: string, expected: string | null): Line => {
    const d = byField.get(field);
    return { field, label, now: pretty(field, d ? d.current : expected), after: pretty(field, d ? d.expected : expected), changed: Boolean(d) };
  };
  const out: Line[] = [];
  out.push(line("address", C.field.address, facts?.address ? `${facts.address}, ${[facts.postcode, facts.place].filter(Boolean).join(" ")}` : null));
  for (const h of facts?.hours ?? []) {
    const day = copy.report.days[h.day] ?? String(h.day);
    out.push(line(`hours.${h.day}`, `${C.field.hours}, ${day}`, h.closed || !h.open || !h.close ? "gesloten" : `${h.open}-${h.close}`));
  }
  out.push(line("phone", C.field.phone, facts?.phone ?? null));
  out.push(line("website", C.field.website, facts?.website ?? null));
  // A changed field the facts do not list (older diff) still shows.
  for (const d of diff) if (!out.some((l) => l.field === d.field)) out.push({ field: d.field, label: d.field, now: d.current, after: d.expected, changed: true });
  return out.filter((l) => l.changed || l.after != null);
}

function Profile({ title, aside, name, place, lines, side, empty }: { title: string; aside?: React.ReactNode; name: string; place: string; lines: Line[]; side: "now" | "after"; empty: string }) {
  return (
    <article className={`card flex flex-col p-6 ${side === "after" ? "border-ink" : ""}`}>
      <div className="flex items-center justify-between gap-3 pb-3">
        <span className="text-[14px] font-bold">{title}</span>
        {aside && <span className="text-[14px] text-muted">{aside}</span>}
      </div>
      <div className="flex flex-col gap-0.5 pb-3">
        <span className="text-[20px] font-extrabold" style={{ letterSpacing: "-0.3px" }}>
          {name}
        </span>
        <span className="text-[14px] text-muted">{place}</span>
      </div>
      {lines.map((l) => {
        const v = side === "now" ? l.now : l.after;
        return (
          <div key={l.field} className="grid gap-x-4 gap-y-1 border-t-[1px] border-line py-2.5 text-[15px] sm:grid-cols-[120px_minmax(0,1fr)]">
            <span className="text-[14px] font-semibold text-muted">{l.label}</span>
            <span>{l.changed ? side === "now" ? <MarkWrong>{v ?? empty}</MarkWrong> : <MarkOk>{v ?? empty}</MarkOk> : (v ?? empty)}</span>
          </div>
        );
      })}
    </article>
  );
}

export default async function ChannelPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ besluit?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { business } = await requireOwner(`/app/vermeldingen/${id}`);
  const detail = await loadChannel(id, business);
  if (!detail) notFound();
  const { copy, href } = await getI18n();
  const C = copy.channelPage;
  const { facts } = await loadDashboard(business.id);
  const { channel, pending, lastSync, lastDiff, approval, syncs } = detail;

  const gbp = channel.type === "gbp";
  const diff = pending.length ? pending : lastDiff;
  const declined = gbp && !pending.length && lastDiff.length > 0 && diffDecision({ diffApproval: approval ?? undefined }, lastDiff) === "declined";
  // Approved but not applied yet: the sync job that applies it has not run; no buttons until then.
  const approvedPending = gbp && pending.length > 0 && diffDecision({ diffApproval: approval ?? undefined }, pending) === "approved";
  const lines = profileLines(facts, diff, copy);
  const changed = lines.filter((l) => l.changed);
  const syncAt = typeof lastSync?.at === "string" ? lastSync.at : channel.lastSyncedAt;
  const answer = !lastSync ? null : lastSync.held ? C.answerHeld : lastSync.error ? C.answerFailed : lastSync.mode === "mock" ? C.answerMock : C.answerOk;
  const answerTone: StipColour = !lastSync ? "grijs" : lastSync.held ? "oranje" : lastSync.error ? "rood" : "groen";
  const title = gbp ? (pending.length ? C.h1Pending(channel.name, pending.length) : changed.length === 0 ? C.h1Same(channel.name) : C.h1Other(channel.name)) : C.h1Other(channel.name);
  const intro = gbp ? (approvedPending && approval ? C.introApproved(dateShort(approval.at)) : pending.length ? C.introPending(facts?.version ?? null, facts?.verifiedAt ? dateShort(facts.verifiedAt) : null) : declined && approval ? C.introDeclined(dateShort(approval.at)) : C.introSame) : C.introDirectory;
  const flash = sp.besluit === "doorgevoerd" ? C.flash.approved : sp.besluit === "niet" ? C.flash.declined : sp.besluit === "niets" ? C.flash.nothing : null;
  // One fix round syncs a channel once per finding within the same minute; the owner reads that as one sync.
  const earlier = syncs.filter((s, i) => syncs.findIndex((o) => o.at.slice(0, 16) === s.at.slice(0, 16) && o.status === s.status && o.diff === s.diff) === i).slice(0, 6);

  return (
    <div className="flex flex-col gap-12">
      <QuietLink href={href("/app")}>← {C.back}</QuietLink>

      <header className="flex max-w-[760px] flex-col gap-3">
        <p className="m-0 text-[14px] text-muted">
          <Dot tone={channelTone[channel.status]} />
          {C.meta(copy.channelStatus[channel.status], business.ownerVerifiedAt && gbp ? dateShort(business.ownerVerifiedAt) : null)}
        </p>
        <h1 className="h1-sm">{title}</h1>
        <p className="m-0 text-[19px] leading-[1.5] text-ink-2">{intro}</p>
        <p className="m-0 flex flex-wrap gap-x-5 gap-y-1">
          {channel.url && (
            <QuietLink href={channel.url} external>
              {gbp ? C.openAtGoogle : channel.name}
            </QuietLink>
          )}
          <QuietLink href={href("/app/gegevens")}>{C.viewFacts}</QuietLink>
        </p>
        {flash && <p className="m-0 rounded-xl bg-panel px-4 py-3 text-[15px]">{flash}</p>}
      </header>

      {/* Now and after */}
      {lines.length > 0 && (
        <section className="grid gap-5 sm:grid-cols-2">
          <Profile title={gbp ? C.now : C.nowGeneric} name={business.name} place={business.place} lines={lines} side="now" empty={C.empty} />
          <Profile title={C.after} aside={C.fromFacts(facts?.version ?? null)} name={business.name} place={business.place} lines={lines} side="after" empty={C.empty} />
        </section>
      )}

      {/* Approve or decline */}
      {gbp && pending.length > 0 && !approvedPending && (
        <Section title={C.whatNow}>
          <p className="m-0 max-w-[640px] text-ink-2">{C.approveIntro}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <form action={approveChannelDiff} className="m-0 flex">
              <input type="hidden" name="channel" value={channel.id} />
              <button type="submit" className="btn-primary h-[52px] w-full sm:w-auto">
                {C.approve}
              </button>
            </form>
            <form action={declineChannelDiff} className="m-0 flex">
              <input type="hidden" name="channel" value={channel.id} />
              <button type="submit" className="btn-outline h-[52px] w-full sm:w-auto">
                {C.decline}
              </button>
            </form>
          </div>
          <p className="m-0 max-w-[640px] text-[14px] text-muted">
            {C.fixFactsNote} <QuietLink href={href("/app/gegevens")}>{C.fixFactsLink}</QuietLink>
            {C.fixFactsAfter}
          </p>
        </Section>
      )}

      {/* The last sync as evidence */}
      <Section title={C.lastSync}>
        {!syncAt ? (
          <p className="m-0 text-[15px] text-muted">{C.noSync}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-[15px] sm:grid-cols-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-[14px] font-bold">{C.when}</span>
                <span>{dateTime(syncAt)}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[14px] font-bold">{lastSync?.held ? C.held : C.updated}</span>
                <span>{lastDiff.length ? lastDiff.map((d) => lines.find((l) => l.field === d.field)?.label ?? d.field).join(", ") : C.nothingChanged}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[14px] font-bold">{gbp ? C.answerGoogle : C.answer}</span>
                <span>
                  <Dot tone={answerTone} />
                  {answer ?? "—"}
                </span>
              </div>
              {approval?.decision === "approved" && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-[14px] font-bold">{C.approvedBy}</span>
                  <span>{C.byYou(dateTime(approval.at))}</span>
                </div>
              )}
            </div>
            {syncs.length > 0 && (
              <>
                <span className="mt-2 text-[14px] font-bold">{C.earlier}</span>
                <ol className="m-0 list-none p-0 text-[15px]">
                  {earlier.map((s, i) => (
                    <li key={i} className="border-t-[1px] border-line py-3.5">
                      <Dot tone={channelTone[(s.status as Channel["status"]) ?? "pending"] ?? "grijs"} />
                      {C.syncLine(dateTime(s.at), s.diff, copy.channelStatus[(s.status as Channel["status"]) ?? "pending"] ?? s.status)}
                    </li>
                  ))}
                  <li className="border-t-[1px] border-b-[1px] border-line py-3.5 text-muted">
                    <Dot tone="grijs" />
                    {gbp ? C.next : C.nextDirectory}
                  </li>
                </ol>
              </>
            )}
          </>
        )}
      </Section>
    </div>
  );
}
