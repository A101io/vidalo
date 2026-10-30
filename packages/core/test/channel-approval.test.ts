/**
 * Workflow B, "approve diff": a Google Business Profile is never changed
 * before the owner has seen the change. The sync holds it (status mismatch,
 * meta.pendingDiff), the owner approves or declines on /app/vermeldingen/[id],
 * and only an approved diff is applied by the next sync.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { MemDb } from "../src/db/mem";
import { setDb } from "../src/shared/db";
import { decideChannelDiff, pendingDiffOf, syncOneChannel } from "../src/publisher";
import { diffKey, diffDecision } from "../src/publisher/channels/gbp";
import type { BusinessRecord } from "../src/db/types";
import { facts as baseFacts } from "./worker-fixtures";

async function seed(db: MemDb) {
  const business: BusinessRecord = await db.upsertBusiness({ name: "Bakkerij Jansen", place: "Haarlem", domain: "bakkerijjansen.nl", ownerEmail: "eigenaar@bakkerijjansen.nl", status: "active", plan: "monitor" });
  const facts = await db.insertFacts(business.id, { ...baseFacts, businessId: business.id }, { provisional: false, verifiedAt: new Date().toISOString() });
  const channel = await db.upsertChannel({ businessId: business.id, type: "gbp", name: "Google Bedrijfsprofiel", externalId: null, url: null });
  return { business, facts, channel };
}

describe("Google Business Profile: the owner approves a change before it is applied", () => {
  let db: MemDb;
  beforeEach(() => {
    db = new MemDb();
    setDb(db);
    process.env.VIDALO_MOCK = "1";
  });

  it("holds the diff: status mismatch, pendingDiff stored, nothing applied", async () => {
    const { facts, channel } = await seed(db);
    const res = await syncOneChannel(channel, facts);
    expect(res.status).toBe("mismatch");
    expect(res.diff.length).toBeGreaterThan(0);
    expect(res.note).toBe("awaiting_owner_approval");
    expect(res.evidence.held).toBe("pending");
    const stored = (await db.listChannels(channel.businessId)).find((c) => c.id === channel.id)!;
    expect(stored.status).toBe("mismatch");
    expect(pendingDiffOf(stored)).toEqual(res.diff);
  });

  it("approved: decision stored against that diff, a sync is queued, the next sync applies it", async () => {
    const { facts, channel } = await seed(db);
    await syncOneChannel(channel, facts);
    const held = (await db.listChannels(channel.businessId)).find((c) => c.id === channel.id)!;
    const decided = await decideChannelDiff(held, "approved", new Date("2026-10-24T10:00:00Z"));
    expect(decided).not.toBeNull();
    expect(diffDecision(decided!.meta as { diffApproval?: { key: string; decision: "approved" | "declined"; at: string } }, pendingDiffOf(held))).toBe("approved");
    const jobs = [...db.jobs.values()].filter((j) => j.kind === "sync");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.payload).toMatchObject({ businessId: channel.businessId, channelIds: [channel.id] });
    expect(db.events.some((e) => e.type === "channel.diff_approved")).toBe(true);

    const res = await syncOneChannel(decided!, facts);
    expect(res.status).toBe("synced");
    expect(res.evidence.applied).toBe(true);
    const after = (await db.listChannels(channel.businessId)).find((c) => c.id === channel.id)!;
    expect(after.status).toBe("synced");
    expect(pendingDiffOf(after)).toEqual([]);
  });

  it("declined: the next sync reports the mismatch again and changes nothing", async () => {
    const { facts, channel } = await seed(db);
    await syncOneChannel(channel, facts);
    const held = (await db.listChannels(channel.businessId)).find((c) => c.id === channel.id)!;
    const decided = await decideChannelDiff(held, "declined");
    expect([...db.jobs.values()].filter((j) => j.kind === "sync")).toHaveLength(0);
    expect(db.events.some((e) => e.type === "channel.diff_declined")).toBe(true);
    const res = await syncOneChannel(decided!, facts);
    expect(res.status).toBe("mismatch");
    expect(res.note).toBe("declined_by_owner");
    const after = (await db.listChannels(channel.businessId)).find((c) => c.id === channel.id)!;
    expect(pendingDiffOf(after)).toEqual([]);
  });

  it("a decision is tied to the exact diff: a different change waits for a new decision", async () => {
    const { facts, channel } = await seed(db);
    await syncOneChannel(channel, facts);
    const held = (await db.listChannels(channel.businessId)).find((c) => c.id === channel.id)!;
    const decided = await decideChannelDiff(held, "approved");
    const changed = { ...facts, phone: "+31235559999" };
    const res = await syncOneChannel(decided!, changed);
    expect(res.status).toBe("mismatch");
    expect(res.note).toBe("awaiting_owner_approval");
    expect(diffKey(res.diff)).not.toBe(diffKey(pendingDiffOf(held)));
  });

  it("nothing held: decideChannelDiff returns null and queues nothing", async () => {
    const { channel } = await seed(db);
    expect(await decideChannelDiff(channel, "approved")).toBeNull();
    expect(db.jobs.size).toBe(0);
  });
});
