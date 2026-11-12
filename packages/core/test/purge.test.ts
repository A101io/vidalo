import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MemDb } from "../src/db";
import { purgeBusiness, type PurgeDeps } from "../src/shared/purge";

/** Feature 002 AC-5(b)(c)(d), ADR-0005, F-010, F-019, F-021, SEC-42…50. Fake deps record their calls. */
function deps(db: MemDb, over: Partial<PurgeDeps> = {}) {
  const calls: string[] = [];
  const d: PurgeDeps = {
    db,
    now: new Date(),
    dryRunRetention: true,
    stripeLive: async () => (calls.push("stripe"), false),
    expireOpenCheckouts: async () => 0,
    revokeGoogle: async () => void calls.push("google"),
    deleteCustomHostname: async (h) => void calls.push(`cloudflare:${h}`),
    deleteLogin: async (u) => void calls.push(`login:${u}`),
    sendDeletedMail: async (to) => void calls.push(`mail:${to.language}:${to.businessName}`),
    isOwnFactsHost: (h) => h.endsWith("-feiten.vidalo.io"),
    ...over,
  };
  return { d, calls };
}

async function scanOwner(db: MemDb, over: Record<string, unknown> = {}) {
  const user = randomUUID();
  const b = await db.upsertBusiness({ name: `Bakkerij ${randomUUID().slice(0, 4)}`, place: "Haarlem", plan: "setup", status: "trial", ownerUserId: user, ownerEmail: "eigenaar@bakkerij.nl", stripeCustomerId: "cus_1", ...over });
  await db.upsertChannel({ businessId: b.id, type: "gbp", name: "Google", externalId: "locations/1", url: null, meta: { refreshToken: "rt" } });
  await db.recordSignIn({ sessionId: randomUUID(), userId: user, browser: "chrome", os: "macos", at: new Date() });
  return { b, user };
}

describe("purgeBusiness", () => {
  it("in order: Stripe, Google, Cloudflare, delete, login, mail; account.deleted carries no id", async () => {
    const db = new MemDb();
    const { b, user } = await scanOwner(db, { factsHost: "feiten.bakkerij.nl", factsHostVerifiedAt: new Date().toISOString() });
    const control = await scanOwner(db);
    const { d, calls } = deps(db);
    const out = await purgeBusiness(d, b.id, "no_subscription");
    expect(out).toEqual({ done: true, loginsDeleted: 1, mailed: true });
    expect(calls).toEqual(["stripe", "google", "cloudflare:feiten.bakkerij.nl", `login:${user}`, `mail:nl:${b.name}`]);
    expect(await db.getBusiness(b.id)).toBeNull();
    expect(await db.listSignIns(user, 10)).toHaveLength(0);
    expect(await db.getBusiness(control.b.id)).not.toBeNull();
    const ev = db.events.find((e) => e.type === "account.deleted")!;
    expect(ev.businessId).toBeNull();
    expect(Object.keys(ev.payload).sort()).toEqual(["guard", "loginsDeleted"]);
    expect(JSON.stringify(ev.payload)).not.toContain("@");
    expect(await purgeBusiness(d, b.id, "no_subscription")).toEqual({ done: false, reason: "not_found" });
  });

  it("F-010: with VIDALO_PURGE unset an owner's deletion still deletes, a retention one does not", async () => {
    const db = new MemDb();
    const now = new Date(Date.now() + 200 * 86_400_000);
    // inline owner purge
    const a = await scanOwner(db);
    expect((await purgeBusiness(deps(db).d, a.b.id, "no_subscription")).done).toBe(true);
    // fallback job: same guard
    const f = await scanOwner(db);
    expect((await purgeBusiness({ ...deps(db).d, now }, f.b.id, "no_subscription")).done).toBe(true);
    // the owner's scheduled date (guard due, reason owner)
    const o = await db.upsertBusiness({ name: "Monthly owner", place: "Haarlem", plan: "monitor", status: "active", cancelAt: new Date(Date.now() + 86_400_000).toISOString() });
    await db.setDeletion(o.id, { at: new Date(Date.now() + 86_400_000).toISOString(), reason: "owner" });
    await db.upsertBusiness({ id: o.id, slug: o.slug, name: o.name, place: o.place, status: "churned" });
    expect((await purgeBusiness({ ...deps(db).d, now }, o.id, "due")).done).toBe(true);
    // retention: held back
    const r = await db.upsertBusiness({ name: "Retention", place: "Haarlem", plan: "monitor", status: "active" });
    await db.upsertBusiness({ id: r.id, slug: r.slug, name: r.name, place: r.place, status: "churned" });
    const { d, calls } = deps(db, { now });
    expect(await purgeBusiness(d, r.id, "due")).toEqual({ done: false, reason: "dry_run" });
    expect(await db.getBusiness(r.id)).not.toBeNull();
    expect(calls.filter((c) => c !== "stripe")).toEqual([]);
    // armed: deleted
    expect((await purgeBusiness({ ...d, dryRunRetention: false }, r.id, "due")).done).toBe(true);
  });

  it("F-021: a live Stripe subscription stops everything; Stripe unreachable deletes nothing", async () => {
    const db = new MemDb();
    const { b } = await scanOwner(db);
    const live = deps(db, { stripeLive: async () => true });
    expect(await purgeBusiness(live.d, b.id, "no_subscription")).toEqual({ done: false, reason: "stripe_live" });
    expect(live.calls).toEqual([]);
    const down = deps(db, {
      stripeLive: async () => {
        throw new Error("stripe unreachable");
      },
    });
    await expect(purgeBusiness(down.d, b.id, "no_subscription")).rejects.toThrow();
    expect(await db.getBusiness(b.id)).not.toBeNull();
    expect((await db.listChannels(b.id)).length).toBe(1);
  });

  it("guard: a running Monthly is never purged without a subscription end", async () => {
    const db = new MemDb();
    const m = await db.upsertBusiness({ name: "Monthly", place: "Haarlem", plan: "monitor", status: "active" });
    const { d, calls } = deps(db);
    expect(await purgeBusiness(d, m.id, "no_subscription")).toEqual({ done: false, reason: "guard" });
    expect(await purgeBusiness(d, m.id, "due")).toEqual({ done: false, reason: "guard" });
    expect(calls).toEqual([]);
  });

  it("F-019: a host held verified by another business, an unverified one, or our own fallback is not sent to Cloudflare", async () => {
    const db = new MemDb();
    const y = await scanOwner(db, { factsHost: "feiten.klant.nl", factsHostVerifiedAt: new Date().toISOString() });
    const x = await scanOwner(db, { factsHost: "feiten.klant.nl", factsHostVerifiedAt: null });
    const own = await scanOwner(db, { factsHost: "bakkerij-feiten.vidalo.io", factsHostVerifiedAt: new Date().toISOString() });
    for (const b of [x.b, own.b]) {
      const { d, calls } = deps(db);
      expect((await purgeBusiness(d, b.id, "no_subscription")).done).toBe(true);
      expect(calls.some((c) => c.startsWith("cloudflare"))).toBe(false);
    }
    expect((await db.getBusiness(y.b.id))!.factsHost).toBe("feiten.klant.nl");
  });

  it("Google failure continues; Cloudflare failure throws before the delete", async () => {
    const db = new MemDb();
    const a = await scanOwner(db);
    const g = deps(db, {
      revokeGoogle: async () => {
        throw new Error("google revoke failed: 503");
      },
    });
    expect((await purgeBusiness(g.d, a.b.id, "no_subscription")).done).toBe(true);
    const c = await scanOwner(db, { factsHost: "feiten.c.nl", factsHostVerifiedAt: new Date().toISOString() });
    const cf = deps(db, {
      deleteCustomHostname: async () => {
        throw new Error("cloudflare 500");
      },
    });
    await expect(purgeBusiness(cf.d, c.b.id, "no_subscription")).rejects.toThrow();
    expect(await db.getBusiness(c.b.id)).not.toBeNull();
  });

  it("SEC-50: two businesses on one login: the first purge keeps the login, the second deletes it", async () => {
    const db = new MemDb();
    const user = randomUUID();
    const one = await db.upsertBusiness({ name: "Een", place: "Haarlem", plan: "setup", status: "trial", ownerUserId: user, ownerEmail: "x@y.nl" });
    const two = await db.upsertBusiness({ name: "Twee", place: "Haarlem", plan: "setup", status: "trial", ownerUserId: user, ownerEmail: "x@y.nl" });
    const first = deps(db);
    expect(await purgeBusiness(first.d, one.id, "no_subscription")).toMatchObject({ done: true, loginsDeleted: 0 });
    expect(first.calls.some((c) => c.startsWith("login"))).toBe(false);
    const second = deps(db);
    expect(await purgeBusiness(second.d, two.id, "no_subscription")).toMatchObject({ done: true, loginsDeleted: 1 });
    expect(second.calls).toContain(`login:${user}`);
  });

  it("a failing mail is logged without the address; the deletion stands", async () => {
    const db = new MemDb();
    const { b } = await scanOwner(db);
    const lines: string[] = [];
    const orig = console.log;
    console.log = (l: string) => void lines.push(String(l));
    try {
      const out = await purgeBusiness(
        deps(db, {
          sendDeletedMail: async () => {
            throw new Error("resend down for eigenaar@bakkerij.nl");
          },
        }).d,
        b.id,
        "no_subscription",
      );
      expect(out).toMatchObject({ done: true, mailed: false });
    } finally {
      console.log = orig;
    }
    expect(lines.some((l) => l.includes("account.deleted_mail_failed"))).toBe(true);
    expect(lines.join("\n")).not.toContain("eigenaar@bakkerij.nl");
  });
});

describe("deleteCustomHostname (SEC-48)", () => {
  it("refuses our own names and anything that is not a hostname, before any call", async () => {
    const { deleteCustomHostname } = await import("../src/publisher/host");
    for (const h of ["vidalo.io", "www.vidalo.io", "x-feiten.vidalo.io", "vidalo.ai", "www.vidalo.ai", "*", "a/b", "*.klant.nl"]) await expect(deleteCustomHostname(h), h).rejects.toThrow(/refusing/);
    const mock = process.env.VIDALO_MOCK;
    process.env.VIDALO_MOCK = "1";
    try {
      await expect(deleteCustomHostname("feiten.klant.nl")).resolves.toBeUndefined();
    } finally {
      if (mock === undefined) delete process.env.VIDALO_MOCK;
      else process.env.VIDALO_MOCK = mock;
    }
  });
});

describe("V-SEC-04: an open Stripe checkout cannot complete after the deletion", () => {
  it("open Checkout Sessions of the customer are expired before the delete; a failure deletes nothing", async () => {
    const db = new MemDb();
    const { b } = await scanOwner(db);
    const calls: string[] = [];
    const open = new Set(["cs_open_1"]);
    const base = deps(db).d;
    const d: PurgeDeps = {
      ...base,
      stripeLive: async () => (calls.push("stripe"), false),
      expireOpenCheckouts: async () => 0,
      expireOpenCheckouts: async (customerId) => {
        calls.push(`expire:${customerId}`);
        const n = open.size;
        open.clear();
        return n;
      },
      deleteLogin: async () => void calls.push("login"),
    };
    expect((await purgeBusiness(d, b.id, "no_subscription")).done).toBe(true);
    expect(open.size).toBe(0);
    expect(calls.indexOf("expire:cus_1")).toBeGreaterThan(calls.indexOf("stripe"));
    expect(calls.indexOf("expire:cus_1")).toBeLessThan(calls.indexOf("login"));
    const other = await scanOwner(db);
    const failing: PurgeDeps = {
      ...base,
      expireOpenCheckouts: async () => {
        throw new Error("stripe 503");
      },
    };
    await expect(purgeBusiness(failing, other.b.id, "no_subscription")).rejects.toThrow();
    expect(await db.getBusiness(other.b.id)).not.toBeNull();
  });
});

it("V-COMP-06: a deleted login's Supabase audit record is deleted too; a kept login's is not", async () => {
  const db = new MemDb();
  const deleted: string[] = [];
  db.deleteAuthAuditLog = async (u: string) => (deleted.push(u), 1);
  const user = randomUUID();
  const one = await db.upsertBusiness({ name: "Een A", place: "Haarlem", plan: "setup", status: "trial", ownerUserId: user });
  const two = await db.upsertBusiness({ name: "Twee A", place: "Haarlem", plan: "setup", status: "trial", ownerUserId: user });
  await purgeBusiness(deps(db).d, one.id, "no_subscription");
  expect(deleted).toEqual([]);
  await purgeBusiness(deps(db).d, two.id, "no_subscription");
  expect(deleted).toEqual([user]);
});

describe("V-COMP-10: the deletion mail claims the Google revoke only when it happened", () => {
  it("revoked → googleRevoked true and the clause; revoke failed or no connection → false and no clause", async () => {
    const { deletedEmail } = await import("../src/reporter/account-mails");
    const db = new MemDb();
    const seen: boolean[] = [];
    const ok = await scanOwner(db);
    await purgeBusiness({ ...deps(db).d, sendDeletedMail: async (to) => void seen.push(to.googleRevoked) }, ok.b.id, "no_subscription");
    const failed = await scanOwner(db);
    await purgeBusiness({ ...deps(db).d, revokeGoogle: async () => { throw new Error("google revoke failed: 503"); }, sendDeletedMail: async (to) => void seen.push(to.googleRevoked) }, failed.b.id, "no_subscription");
    const none = await db.upsertBusiness({ name: "Geen Google", place: "Haarlem", plan: "setup", status: "trial", ownerEmail: "x@y.nl" });
    await purgeBusiness({ ...deps(db).d, sendDeletedMail: async (to) => void seen.push(to.googleRevoked) }, none.id, "no_subscription");
    expect(seen).toEqual([true, false, false]);
    for (const lang of ["nl", "en"] as const) {
      expect(deletedEmail(lang, "B", true).text).toMatch(/ingetrokken|revoked/);
      expect(deletedEmail(lang, "B", false).text).not.toMatch(/ingetrokken|revoked/);
    }
  });
});

describe("R1 (V2-SEC-01): no Cloudflare keys outside mock mode means the host step fails, before anything is deleted", () => {
  const saved = { mock: process.env.VIDALO_MOCK, token: process.env.CLOUDFLARE_API_TOKEN, zone: process.env.CLOUDFLARE_ZONE_ID };
  const restore = () => {
    for (const [k, v] of [["VIDALO_MOCK", saved.mock], ["CLOUDFLARE_API_TOKEN", saved.token], ["CLOUDFLARE_ZONE_ID", saved.zone]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  it("deleteCustomHostname throws without keys and VIDALO_MOCK unset; the web purge of a verified host deletes nothing", async () => {
    const { deleteCustomHostname } = await import("../src/publisher/host");
    delete process.env.VIDALO_MOCK;
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ZONE_ID;
    try {
      await expect(deleteCustomHostname("feiten.klant.nl")).rejects.toThrow(/CLOUDFLARE/);
      const db = new MemDb();
      const { b } = await scanOwner(db, { factsHost: "feiten.klant.nl", factsHostVerifiedAt: new Date().toISOString() });
      await expect(purgeBusiness({ ...deps(db).d, deleteCustomHostname }, b.id, "no_subscription")).rejects.toThrow();
      expect(await db.getBusiness(b.id)).not.toBeNull();
    } finally {
      restore();
    }
  });
  it("in mock mode it is recorded and passes", async () => {
    const { deleteCustomHostname } = await import("../src/publisher/host");
    process.env.VIDALO_MOCK = "1";
    delete process.env.CLOUDFLARE_API_TOKEN;
    try {
      await expect(deleteCustomHostname("feiten.klant.nl")).resolves.toBeUndefined();
    } finally {
      restore();
    }
  });
});
