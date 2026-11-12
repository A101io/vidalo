/**
 * The owner's download as a stream (feature 002, ADR-0006): the same JSON shape as exportMyData,
 * written section by section, scans 6 runs a page and events 500 a page, so a long history fits a
 * Worker's memory and time. The Db handle is passed in once: the stream outlives the request
 * handler's scope, so it must never look the handle up again.
 *
 * Bound to one business: run ids come only from this business's own runs, events are paged by
 * business_id in SQL, channels go through the meta allow-list, events through ownAddressesOnly.
 */
import type { Db, EventRow } from "../db/types.js";
import { exportChannel, ownAddressesOnly } from "./my-data.js";

export const EXPORT_RUN_PAGE = 6;
export const EXPORT_EVENT_PAGE = 500;

const json = (v: unknown) => JSON.stringify(v ?? null);

async function* sections(db: Db, businessId: string, opts: { signedInAs: string; userId?: string; now?: Date }): AsyncGenerator<string> {
  const business = await db.getBusiness(businessId);
  if (!business) {
    yield "null";
    return;
  }
  const now = opts.now ?? new Date();
  yield `{"exportedAt":${json(now.toISOString())},"signedInAs":${json(opts.signedInAs)},"business":${json(business)}`;
  yield `,"profiles":${json({ auto: business.profileAuto ?? null, owner: business.profileOwner ?? null })}`;
  yield `,"facts":${json(await db.listFacts(businessId))}`;
  yield `,"prompts":${json(await db.listPrompts(businessId))}`;

  yield `,"scans":[`;
  const runs = await db.listScanRuns(businessId, 10_000);
  let first = true;
  for (let i = 0; i < runs.length; i += EXPORT_RUN_PAGE) {
    const page = runs.slice(i, i + EXPORT_RUN_PAGE);
    const samples = await db.listSamplesForRuns(page.map((r) => r.id));
    const claims = await db.listClaims(samples.map((s) => s.id));
    for (const run of page) {
      const own = samples.filter((s) => s.scanRunId === run.id);
      const ids = new Set(own.map((s) => s.id));
      yield `${first ? "" : ","}${json({ ...run, samples: own, claims: claims.filter((c) => ids.has(c.sampleId)) })}`;
      first = false;
    }
  }
  yield "]";

  const findings = await db.listFindings(businessId);
  yield `,"findings":${json(findings)}`;
  const fixes = [];
  for (const f of findings) fixes.push(...(await db.listFixes(f.id)));
  yield `,"fixes":${json(fixes)}`;
  yield `,"channels":${json((await db.listChannels(businessId)).map(exportChannel))}`;
  yield `,"googleIndex":${json(await db.getGoogleIndex(businessId))}`;
  yield `,"signIns":${json(opts.userId ? await db.listSignIns(opts.userId, 10) : [])}`;

  yield `,"events":[`;
  let beforeId: number | undefined;
  first = true;
  for (;;) {
    const page: EventRow[] = await db.listEventsPage(businessId, { beforeId, limit: EXPORT_EVENT_PAGE });
    for (const e of page) {
      // Letters to directories go out in the owner's name to a directory's public address: those stay (AVG art. 15).
      const out = e.type === "email.directory_correction" ? e : { ...e, payload: ownAddressesOnly(e.payload, business.ownerEmail) };
      yield `${first ? "" : ","}${json(out)}`;
      first = false;
    }
    if (page.length < EXPORT_EVENT_PAGE) break;
    beforeId = page[page.length - 1]!.id;
  }
  yield "]}";
}

export function streamMyData(db: Db, businessId: string, opts: { signedInAs: string; userId?: string; now?: Date }): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const it = sections(db, businessId, opts);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await it.next();
        if (done) controller.close();
        else controller.enqueue(enc.encode(value));
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await it.return(undefined);
    },
  });
}
