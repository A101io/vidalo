import { describe, expect, it } from "vitest";
import { withMockDb } from "../src/db";
import { effectiveProfile } from "../src/scanner";
import { correctProfile, parseProfileError } from "../src/shared";
import type { BusinessProfile } from "../src/types";

/** FE-03: the owner's correction of the profile (the web action is a thin wrapper: session, this, redirect). */
const auto = (over: Partial<BusinessProfile> = {}): BusinessProfile => ({
  mode: "door", offer: "brood en gebak", audience: "buurtbewoners", category: "bakkerij", competitors: ["Bakker Bart"], website: "bakkerij.nl",
  confidence: "high", basis: ["google"], source: "auto", grounded: true, decidedAt: "2026-11-01T09:00:00.000Z", ...over,
});
const form = { mode: "visit", offer: "taarten aan huis", audience: "gezinnen", category: "banketbakker" };

async function setup() {
  const db = await withMockDb();
  const a = await db.upsertBusiness({ name: "A", place: "Haarlem" });
  const b = await db.upsertBusiness({ name: "B", place: "Utrecht" });
  await db.setAutoProfile(a.id, auto());
  await db.setAutoProfile(b.id, auto({ offer: "fietsen" }));
  return { db, a, b };
}

describe("correctProfile (FE-03)", () => {
  it("writes the owner profile, keeps the automatic one, and logs the modes only", async () => {
    const { db, a } = await setup();
    const res = await correctProfile(db, (await db.getBusiness(a.id))!, form);
    expect(res.ok).toBe(true);
    const row = (await db.getBusiness(a.id))!;
    expect(row.profileOwner).toMatchObject({ mode: "visit", offer: "taarten aan huis", audience: "gezinnen", category: "banketbakker", source: "owner" });
    expect(row.profileAuto?.offer).toBe("brood en gebak");
    expect(effectiveProfile(row)).toMatchObject({ offer: "taarten aan huis", competitors: ["Bakker Bart"] });
    const ev = (await db.listEvents(a.id)).filter((e) => e.type === "profile.corrected");
    expect(ev).toHaveLength(1);
    expect(ev[0]!.payload).toEqual({ from: "door", to: "visit" });
  });

  it("writes nothing and logs nothing for a refused, missing or too long value", async () => {
    const { db, a } = await setup();
    const row = (await db.getBusiness(a.id))!;
    const cases: [typeof form, string, string][] = [
      [{ ...form, offer: "<img src=x onerror=alert(1)>" }, "offer", "refused"],
      [{ ...form, category: "" }, "category", "required"],
      [{ ...form, mode: "" }, "mode", "required"],
      [{ ...form, mode: "everywhere" }, "mode", "refused"],
      [{ ...form, audience: "x".repeat(10_000) }, "audience", "too_long"],
    ];
    for (const [f, field, reason] of cases) expect(await correctProfile(db, row, f)).toEqual({ ok: false, field, reason });
    expect((await db.getBusiness(a.id))!.profileOwner).toBeNull();
    expect((await db.listEvents(a.id)).filter((e) => e.type === "profile.corrected")).toHaveLength(0);
  });

  it("only the business it is given changes (the business comes from the session, not the form)", async () => {
    const { db, a, b } = await setup();
    await correctProfile(db, (await db.getBusiness(a.id))!, { ...form, businessId: b.id, id: b.id, slug: b.slug } as typeof form);
    expect((await db.getBusiness(a.id))!.profileOwner?.offer).toBe("taarten aan huis");
    expect((await db.getBusiness(b.id))!.profileOwner).toBeNull();
    expect((await db.getBusiness(b.id))!.profileAuto?.offer).toBe("fietsen");
  });

  it("a later automatic profile leaves the correction in place", async () => {
    const { db, a } = await setup();
    await correctProfile(db, (await db.getBusiness(a.id))!, form);
    await db.setAutoProfile(a.id, auto({ mode: "online", offer: "iets anders", decidedAt: "2026-12-01T09:00:00.000Z" }));
    const row = (await db.getBusiness(a.id))!;
    expect(row.profileOwner?.offer).toBe("taarten aan huis");
    expect(effectiveProfile(row)).toMatchObject({ mode: "visit", offer: "taarten aan huis", source: "owner" });
  });
});

describe("parseProfileError", () => {
  it("accepts known field and reason pairs only", () => {
    expect(parseProfileError("offer:refused")).toEqual({ field: "offer", reason: "refused" });
    expect(parseProfileError("mode:required")).toEqual({ field: "mode", reason: "required" });
    for (const bad of [undefined, "", "offer", "<script>x</script>:y", "offer:<b>", "price:refused", "offer:refused:extra:x".replace(":extra:x", "") + "x"]) expect(parseProfileError(bad)).toBeNull();
  });
});
