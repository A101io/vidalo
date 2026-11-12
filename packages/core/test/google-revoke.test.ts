import { describe, expect, it } from "vitest";
import { MemDb } from "../src/db";
import { disconnectGoogle, revokeGoogleToken } from "../src/shared/google-revoke";

/** Feature 002 AC-5(e), SEC-49, COMP-13. */
const fakeFetch = (status: number, body: unknown = {}) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, calls };
};

describe("revokeGoogleToken", () => {
  it("posts the token in the form body to the fixed endpoint", async () => {
    const { f, calls } = fakeFetch(200);
    await revokeGoogleToken("rt-123", f);
    expect(calls[0]!.url).toBe("https://oauth2.googleapis.com/revoke");
    expect(calls[0]!.url).not.toContain("rt-123");
    expect(calls[0]!.init.method).toBe("POST");
    expect(String(calls[0]!.init.body)).toBe("token=rt-123");
  });
  it("400 invalid_token counts as done", async () => {
    await expect(revokeGoogleToken("x", fakeFetch(400, { error: "invalid_token" }).f)).resolves.toBeUndefined();
  });
  it("503 throws, without the token in the message", async () => {
    await expect(revokeGoogleToken("rt-secret", fakeFetch(503).f)).rejects.toThrow(/503/);
    await expect(revokeGoogleToken("rt-secret", fakeFetch(503).f)).rejects.not.toThrow(/rt-secret/);
  });
});

describe("disconnectGoogle", () => {
  async function setup() {
    const db = new MemDb();
    const a = await db.upsertBusiness({ name: "A", place: "Haarlem", ownerVerifiedAt: "2026-11-01T00:00:00.000Z", ownerVerifiedVia: "google_business_profile" });
    const b = await db.upsertBusiness({ name: "B", place: "Haarlem" });
    await db.upsertChannel({ businessId: a.id, type: "gbp", name: "Google", externalId: "locations/a", url: null, meta: { refreshToken: "rt-a", accessToken: "at-a" } });
    await db.upsertChannel({ businessId: a.id, type: "directory", name: "openingstijden.nl", externalId: null, url: null, meta: {} });
    await db.upsertChannel({ businessId: b.id, type: "gbp", name: "Google", externalId: "locations/b", url: null, meta: { refreshToken: "rt-b" } });
    return { db, a, b };
  }
  it("revokes the refresh token, deletes only this business's gbp channel, keeps the ownership proof", async () => {
    const { db, a, b } = await setup();
    const revoked: string[] = [];
    expect(await disconnectGoogle(db, a.id, async (t) => void revoked.push(t), "owner")).toEqual({ disconnected: 1 });
    expect(revoked).toEqual(["rt-a"]);
    expect((await db.listChannels(a.id)).map((c) => c.type)).toEqual(["directory"]);
    expect((await db.listChannels(b.id)).map((c) => c.type)).toEqual(["gbp"]);
    expect((await db.getBusiness(a.id))!.ownerVerifiedAt).toBe("2026-11-01T00:00:00.000Z");
  });
  it("a Google failure keeps the channel (owner, churn), but not on purge", async () => {
    const { db, a } = await setup();
    const fail = async () => {
      throw new Error("google revoke failed: 503");
    };
    await expect(disconnectGoogle(db, a.id, fail, "owner")).rejects.toThrow();
    expect((await db.listChannels(a.id)).some((c) => c.type === "gbp")).toBe(true);
    expect(await disconnectGoogle(db, a.id, fail, "purge")).toEqual({ disconnected: 1, revokeFailed: 1 });
    expect((await db.listChannels(a.id)).some((c) => c.type === "gbp")).toBe(false);
  });
  it("no connection: nothing to do", async () => {
    const { db, b } = await setup();
    await db.deleteChannel((await db.listChannels(b.id))[0]!.id);
    expect(await disconnectGoogle(db, b.id, async () => {}, "owner")).toEqual({ disconnected: 0 });
  });
});
