/**
 * The owner's log (/app, design G AppG): one line per event the owner can act
 * on or check, with the proof link where there is one. Events the owner has
 * no use for (job bookkeeping, progress ticks) are left out.
 */
import type { CopyShape } from "@vidalo/core/copy";
import type { EventRow } from "@vidalo/core/db";
import type { Channel, ScanKind } from "@vidalo/core/types";
import { dateShort } from "./format";

export interface LogLine {
  at: string;
  text: string;
  proof: { href: string; label: string; external?: boolean } | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function logLine(e: EventRow, copy: CopyShape, href: (h: string) => string, gbp: Channel | null): LogLine | null {
  const L = copy.dashboard.logLine;
  const P = copy.dashboard.proofLabels;
  const p = e.payload;
  const findingId = str(p.findingId);
  const findingProof = findingId ? { href: href(`/app/fouten/${findingId}`), label: P.finding } : null;
  switch (e.type) {
    case "scan.finished": {
      const kind = str(p.kind) as ScanKind | null;
      if (kind === "recheck") return null;
      const runId = str(p.scanRunId);
      return { at: e.at, text: L.scanFinished(copy.progress.scanKind[kind ?? "monthly"]), proof: runId ? { href: href(`/r/${runId}`), label: P.report } : null };
    }
    case "scan.ondemand_requested":
      return { at: e.at, text: L.scanRequested, proof: null };
    case "fix.opened": {
      const action = str(p.action) as keyof typeof L.fixOpened | null;
      return { at: e.at, text: L.fixOpened[action ?? "none"], proof: findingProof };
    }
    case "finding.resolved":
      return { at: e.at, text: L.resolved(num(p.days) ?? 0), proof: findingProof };
    case "finding.still_wrong": {
      const next = str(p.nextRecheckAt);
      return { at: e.at, text: L.stillWrong(next ? dateShort(next) : null), proof: findingProof };
    }
    case "finding.unfixable":
      return { at: e.at, text: L.unfixable(str(p.note) ?? ""), proof: findingProof };
    case "finding.owner_marked_fixed":
      return { at: e.at, text: L.ownerMarkedFixed, proof: findingProof };
    case "finding.disputed":
      return { at: e.at, text: L.disputed, proof: findingProof };
    case "facts_page.published": {
      const url = str(p.url);
      return { at: e.at, text: L.published(num(p.factsVersion) ?? 0), proof: url ? { href: url, label: P.factsPage, external: true } : null };
    }
    case "channels.synced": {
      const results = Array.isArray(p.results) ? (p.results as { type?: string; status?: string }[]) : [];
      const synced = results.filter((r) => r.status === "synced").length;
      const held = results.filter((r) => r.type === "gbp" && r.status === "mismatch").length;
      return { at: e.at, text: L.synced(synced, held), proof: held && gbp ? { href: href(`/app/vermeldingen/${gbp.id}`), label: P.channel } : null };
    }
    case "channel.diff_approved":
    case "channel.diff_declined": {
      const id = str(p.channelId);
      return { at: e.at, text: e.type === "channel.diff_approved" ? L.diffApproved : L.diffDeclined, proof: id ? { href: href(`/app/vermeldingen/${id}`), label: P.channel } : null };
    }
    case "facts.confirmed":
      return { at: e.at, text: L.factsConfirmed(num(p.version) ?? 0), proof: { href: href("/app/gegevens"), label: P.facts } };
    case "owner.verified":
      return { at: e.at, text: L.ownerVerified, proof: null };
    default: {
      if (e.type.startsWith("email.") && str(p.subject)) return { at: e.at, text: L.mail(str(p.subject)!), proof: findingProof };
      return null;
    }
  }
}

/**
 * The log lines of a business, newest first, at most `limit`. One fix round
 * logs the same step once per finding (a republish for each of ten findings);
 * the owner reads that as one line, so equal texts on the same day collapse.
 */
export function buildLog(events: EventRow[], copy: CopyShape, href: (h: string) => string, gbp: Channel | null, limit = 12): LogLine[] {
  const out: LogLine[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    const line = logLine(e, copy, href, gbp);
    if (!line) continue;
    const key = `${line.at.slice(0, 10)} ${line.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= limit) break;
  }
  return out;
}
