import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { withMockDb, createDb, type Db } from "../src/db";
import { purgeBusiness, type PurgeDeps } from "../src/shared/purge";
import { exportMyData } from "../src/shared/my-data";
import { streamMyData } from "../src/shared/export-stream";
import { seedHistory } from "./helpers/counting-db";

/**
 * Feature 002, QA (phase 4), AC-5(a) and AC-5(d): after a deletion the business and ALL its rows are gone, unrun jobs are
 * gone, the login and its sign-ins are gone, the Google token was revoked, the custom host removed, the mail
 * sent; a control business on another login keeps every row. Runs on MemDb and, under `pnpm verify:pg`
 * (TEST_DATABASE_URL), on PgDb, where every table holding a business_id is counted directly.
 *
 * Control used in phase 4: removing `delete from job where done_at is null …` from PgDb.purgeBusiness (and the
 * MemDb mirror) turns the "unrun jobs" assertion red.
 */
const PG_URL = process.env.TEST_DATABASE_URL;
const FIXED = new Date("2026-11-12T12:00:00.000Z");
const TABLES = "auth_session, auth_throttle, question_use, google_index, claim, sample, fix, finding, channel, event, scan_run, prompt, facts, job, business, waitlist";

let pg: Db | undefined;
let raw: ReturnType<typeof postgres> | undefined;
const backends: [string, () => Promise<Db>][] = [["MemDb", async () => withMockDb()]];
if (PG_URL) {
  backends.push([
    "PgDb",
    async () => {
      raw ??= postgres(PG_URL, { max: 1, onnotice: () => {} });
      await raw.unsafe(`truncate ${TABLES} restart identity cascade`);
      pg ??= createDb(PG_URL);
      return pg;
    },
  ]);
}
afterAll(async () => {
  await pg?.close();
  await raw?.end();
});

async function seedOwner(db: Db, name: string) {
  const user = randomUUID();
  const email = `${name.toLowerCase().replace(/\W/g, "")}@example.nl`;
  const { businessId, runIds } = await seedHistory(db, { name, place: "Haarlem", checks: 3, findings: 8, events: 12, samplesForEvery: true, answers: 2, ownerUserId: user, ownerEmail: email });
  const b = (await db.getBusiness(businessId))!;
  // A Vidalo Scan owner (deletable at once), with a verified custom facts host and a Google connection holding tokens.
  await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, plan: "setup", status: "trial", factsHost: `feiten.${b.slug}.nl`, factsHostVerifiedAt: new Date().toISOString(), stripeCustomerId: `cus_${b.slug}` });
  await db.upsertChannel({ businessId: b.id, type: "gbp", name: "Google", externalId: "locations/1", url: null, meta: { refreshToken: `rt-${randomUUID()}`, accessToken: `at-${randomUUID()}` } });
  await db.upsertGoogleIndex({ businessId: b.id, host: `feiten.${b.slug}.nl` });
  await db.enqueueJob("publish", { businessId: b.id }, new Date(Date.now() + 86_400_000));
  await db.enqueueJob("recheck", { businessId: b.id }, new Date(Date.now() + 86_400_000));
  await db.recordSignIn({ sessionId: randomUUID(), userId: user, browser: "chrome", os: "macos", at: new Date() });
  return { id: b.id, user, email, runIds, host: `feiten.${b.slug}.nl` };
}

async function pgCounts(id: string): Promise<Record<string, number>> {
  const one = async (q: string) => Number((await raw!.unsafe(q, [id]))[0]!.n);
  return {
    business: await one(`select count(*) n from business where id = $1`),
    business_member: await one(`select count(*) n from business_member where business_id = $1`),
    facts: await one(`select count(*) n from facts where business_id = $1`),
    prompt: await one(`select count(*) n from prompt where business_id = $1`),
    scan_run: await one(`select count(*) n from scan_run where business_id = $1`),
    sample: await one(`select count(*) n from sample s join prompt p on p.id = s.prompt_id where p.business_id = $1`),
    finding: await one(`select count(*) n from finding where business_id = $1`),
    channel: await one(`select count(*) n from channel where business_id = $1`),
    event: await one(`select count(*) n from event where business_id = $1`),
    google_index: await one(`select count(*) n from google_index where business_id = $1`),
    job_unrun: await one(`select count(*) n from job where done_at is null and payload->>'businessId' = $1::text`),
  };
}

describe.each(backends)("%s: AC-5(d) a deletion leaves nothing of the business, the control keeps everything", (name, makeDb) => {
  it("purges every row, unrun job, sign-in and the login; revokes Google, removes the host, mails; the control survives", async () => {
    const db = await makeDb();
    const target = await seedOwner(db, "Bakkerij Weg");
    const control = await seedOwner(db, "Bakkerij Blijft");
    const controlBefore = JSON.stringify(await exportMyData(db, control.id, FIXED, { userId: control.user }));
    const pgControlBefore = name === "PgDb" ? await pgCounts(control.id) : null;

    // AC-5(a): the download (as the route streams it) holds every category the privacy text names for the account and
    // the paid service: address, account number, language, sign-ins, facts with versions, profile, checks with answers,
    // findings, correction requests, connections (without keys), events. Then no token.
    const dl = JSON.parse(await new Response(streamMyData(db, target.id, { signedInAs: target.email, userId: target.user, now: FIXED })).text());
    expect(dl.business).toMatchObject({ ownerEmail: target.email, ownerUserId: target.user });
    expect(dl.business.language ?? "nl").toBeTruthy();
    expect("profiles" in dl).toBe(true);
    for (const k of ["facts", "prompts", "scans", "findings", "fixes", "channels", "signIns", "events"]) expect(dl[k]?.length, `export ${k}`).toBeGreaterThan(0);
    expect(dl.scans[0].samples.length).toBeGreaterThan(0);
    expect(dl.googleIndex).not.toBeNull();
    const dlText = JSON.stringify(dl);
    expect(dlText).not.toMatch(/"(rt|at)-[0-9a-f-]{36}"/);
    expect(dlText).not.toContain(control.email);

    if (name === "PgDb") {
      const t = await pgCounts(target.id);
      for (const [k, v] of Object.entries(t)) expect(v, `seeded ${k}`).toBeGreaterThan(0);
    }

    const calls: string[] = [];
    const deps: PurgeDeps = {
      db,
      now: new Date(),
      dryRunRetention: true,
      stripeLive: async () => (calls.push("stripe"), false),
      expireOpenCheckouts: async () => 0,
      revokeGoogle: async (token) => void calls.push(`google:${token.slice(0, 3)}`),
      deleteCustomHostname: async (h) => void calls.push(`cloudflare:${h}`),
      deleteLogin: async (u) => void calls.push(`login:${u}`),
      sendDeletedMail: async (to) => void calls.push(`mail:${to.email ?? "?"}`),
      isOwnFactsHost: (h) => h.endsWith("-feiten.vidalo.io"),
    };
    const out = await purgeBusiness(deps, target.id, "no_subscription");
    expect(out).toMatchObject({ done: true, loginsDeleted: 1 });
    expect(calls).toContain("stripe");
    expect(calls.some((c) => c.startsWith("google:rt-"))).toBe(true);
    expect(calls).toContain(`cloudflare:${target.host}`);
    expect(calls).toContain(`login:${target.user}`);
    expect(calls.some((c) => c.startsWith("mail:"))).toBe(true);
    // Nothing of the control was sent anywhere.
    expect(calls.join(" ")).not.toContain(control.user);
    expect(calls.join(" ")).not.toContain(control.host);

    expect(await db.getBusiness(target.id)).toBeNull();
    expect(await db.listSignIns(target.user, 10)).toHaveLength(0);
    expect(await db.hasUnrunJob("publish", target.id)).toBe(false);
    expect(await db.hasUnrunJob("recheck", target.id)).toBe(false);
    expect(await db.listChannels(target.id)).toHaveLength(0);
    expect(await db.listFindings(target.id)).toHaveLength(0);
    for (const run of target.runIds) expect(await db.getScanRun(run)).toBeNull();
    if (name === "PgDb") {
      const after = await pgCounts(target.id);
      for (const [k, v] of Object.entries(after)) expect(v, `left behind in ${k}`).toBe(0);
      const sampleOrphans = Number((await raw!`select count(*) n from sample where scan_run_id = any(${target.runIds})`)[0]!.n);
      expect(sampleOrphans).toBe(0);
    }

    // The control is untouched: the same export byte for byte, the same row counts, its jobs and sign-in still there.
    expect(JSON.stringify(await exportMyData(db, control.id, FIXED, { userId: control.user }))).toBe(controlBefore);
    expect(await db.hasUnrunJob("publish", control.id)).toBe(true);
    expect(await db.listSignIns(control.user, 10)).toHaveLength(1);
    if (pgControlBefore) expect(await pgCounts(control.id)).toEqual(pgControlBefore);
  });
});
