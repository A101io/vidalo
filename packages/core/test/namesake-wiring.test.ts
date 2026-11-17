/**
 * Feature 005, AC-9 (QA round 2): the namesake line through the real wiring, not the template alone. A local business
 * Google does not list, checked and reported on stored data: the report mail (sendBaselineSummary) and the report view
 * built the way /r/[id] builds it (buildReport + notListed from the business record) both carry the line, and both drop
 * it for the same business once it has a Google listing. Mock understanding reads no profile without a listing, so the
 * local profile is stored first as a grounded automatic reading (what the real model returns for a typed local website).
 */
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { MemDb } from "../src/db";
import { REPORT_EMAIL_EVENT, setDb } from "../src/shared";
import { copy } from "../src/copy/index.js";
import { buildReport, mockCandidate, prepareBusiness, runScan } from "../src/scanner";
import { sendBaselineSummary, sendFollowUp } from "../src/reporter";
import { buildReportView } from "../../../apps/web/lib/report";

const NAME = "Bakkerij Vloedlijn";
const PLACE = "Utrecht";
const LINE = "We vonden dit bedrijf niet op Google";
/** The mail's plain-text part (quoted-printable may wrap the HTML part). */
const plain = (eml: string) => eml.split("Content-Type: text/html")[0]!;

let db: MemDb;
beforeEach(async () => {
  db = new MemDb();
  setDb(db);
  process.env.VIDALO_OUT_DIR = await mkdtemp(path.join(tmpdir(), "vidalo-namesake-"));
});

async function localRun(placeId: string | null) {
  const candidate = { ...mockCandidate(NAME, PLACE), placeId, kvk: null };
  const p = await prepareBusiness({ name: NAME, place: PLACE, candidate, website: "https://www.bakkerij-vloedlijn.example", db });
  await db.setAutoProfile(p.business.id, {
    mode: "door", offer: "brood en gebak", audience: "buurtbewoners", category: "bakkerij", competitors: [], website: "bakkerij-vloedlijn.example",
    confidence: "high", basis: ["website"], source: "auto", grounded: true, decidedAt: new Date().toISOString(),
  });
  const run = await runScan({ businessId: p.business.id, kind: "free", db });
  const business = (await db.getBusiness(p.business.id))!;
  const report = await buildReport(run.scanRunId, db);
  // The same expression as apps/web/app/r/[id]/page.tsx load().
  const view = buildReportView(report, copy, { googlePlaceId: business.googlePlaceId, notListed: !!business && !business.googlePlaceId });
  const res = await sendBaselineSummary(run.scanRunId, { email: "vraagt@example.nl", lang: "nl" });
  return { report, view, mail: plain(await readFile(res!.file!, "utf8")) };
}

describe("AC-9 wiring: page and mail agree on the namesake line", () => {
  it("a local business Google does not list: line on the report view and in the report mail", async () => {
    const { report, view, mail } = await localRun(null);
    expect(report.profile?.mode).toBe("door");
    expect(view.namesake).toBe(copy.result.namesake);
    expect(mail).toContain(LINE);
  });

  it("the same business with a Google listing: no line in either", async () => {
    const { view, mail } = await localRun("ChIJ-test-place");
    expect(view.namesake).toBeNull();
    expect(mail).not.toContain(LINE);
  });
});

describe("QA-R2-04 wiring: the follow-up mails carry the line on the same signal", () => {
  async function followUp(placeId: string | null, day: 7 | 21) {
    process.env.UNSUBSCRIBE_SECRET ??= "test-secret";
    const { report } = await localRun(placeId);
    // The free check's requester, as the form stores it (shared/free-check.ts): the follow-up goes there.
    await db.logEvent(report.business.id, REPORT_EMAIL_EVENT, { email: "vraagt@example.nl", lang: "nl", marketing: false });
    const res = await sendFollowUp(report.business.id, day);
    return res?.file ? plain(await readFile(res.file, "utf8")) : null;
  }
  for (const day of [7, 21] as const) {
    it(`day ${day}: with the line without a listing, without it with one`, async () => {
      const without = await followUp(null, day);
      expect(without, "the mock check found nothing to follow up on").not.toBeNull();
      expect(without).toContain(LINE);
      // AC-10: under the quoted wrong answer, before the button (QA round 3, control K7).
      const quoted = without!.indexOf("ChatGPT zei:");
      expect(quoted, "the example card quotes the answer").toBeGreaterThan(-1);
      expect(without!.indexOf(LINE)).toBeGreaterThan(quoted);
      expect(without!.indexOf(LINE)).toBeLessThan(without!.indexOf("Bekijk je volledige resultaat"));
      db = new MemDb();
      setDb(db);
      expect(await followUp("ChIJ-test-place", day)).not.toContain(LINE);
    });
  }
});
