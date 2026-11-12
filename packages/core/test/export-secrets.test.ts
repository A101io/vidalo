import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { randomBytes, randomUUID } from "node:crypto";
import { withMockDb, createDb, type Db } from "../src/db";
import { exportMyData } from "../src/shared/my-data";
import { EXPORT_RUN_PAGE, streamMyData } from "../src/shared/export-stream";

/**
 * Feature 002 AC-5(a), SEC-39/40, ADR-0006: the download holds no token, secret or other person's
 * address, and is streamed in pages. On MemDb, and on PgDb when TEST_DATABASE_URL is set (verify:pg).
 */
const PG_URL = process.env.TEST_DATABASE_URL;
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

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return out + dec.decode();
    out += dec.decode(value, { stream: true });
  }
}

describe.each(backends)("%s: the download", (_n, makeDb) => {
  it("holds no Google token, no unknown secret key and no other person's address, and keeps pendingDiff", async () => {
    const db = await makeDb();
    const rt = `rt-${randomBytes(8).toString("hex")}`;
    const at = `at-${randomBytes(8).toString("hex")}`;
    const secret = `s-${randomBytes(8).toString("hex")}`;
    const b = await db.upsertBusiness({ name: "Bakkerij Geheim", place: "Haarlem", ownerEmail: "eigenaar@geheim.nl", status: "active", plan: "monitor" });
    await db.upsertChannel({ businessId: b.id, type: "gbp", name: "Google Bedrijfsprofiel", externalId: "locations/1", url: null, meta: { refreshToken: rt, accessToken: at, expiresAt: new Date().toISOString(), apiSecret: secret, pendingDiff: { phone: ["1", "2"] } } });
    await db.logEvent(b.id, "report_email.requested", { email: "iemand-anders@example.nl" });
    // Another person's address on the second page of 500 events too.
    for (let i = 0; i < 501; i++) await db.logEvent(b.id, "filler", { i });
    await db.logEvent(b.id, "report_email.requested", { email: "nog-iemand@example.nl" });
    const body = await readAll(streamMyData(db, b.id, { signedInAs: "eigenaar@geheim.nl" }));
    const parsed = JSON.parse(body);
    const whole = JSON.stringify(await exportMyData(db, b.id));
    for (const text of [body, whole]) {
      for (const bad of [rt, at, secret, "iemand-anders@example.nl", "nog-iemand@example.nl"]) expect(text).not.toContain(bad);
      expect(text).toContain("pendingDiff");
    }
    expect(parsed.events).toHaveLength(503);
    expect(Object.keys(parsed)).toEqual(["exportedAt", "signedInAs", "business", "profiles", "facts", "prompts", "scans", "findings", "fixes", "channels", "googleIndex", "signIns", "events"]);
  });

  it("pages 36 runs of 50 answers in ceil(36/6) sample reads, every answer once, only its own business", async () => {
    const db = await makeDb();
    const b = await db.upsertBusiness({ name: "Bakkerij Lang", place: "Haarlem" });
    const other = await db.upsertBusiness({ name: "Bakkerij Ander", place: "Haarlem" });
    const [prompt] = await db.insertPrompts(b.id, [{ category: "phone", textNl: "Wat is het nummer?", probes: [], active: true, criterium: null, kind: "about", intent: null, pool: "core", season: null, templateKey: null }]);
    const [otherPrompt] = await db.insertPrompts(other.id, [{ category: "phone", textNl: "x", probes: [], active: true, criterium: null, kind: "about", intent: null, pool: "core", season: null, templateKey: null }]);
    const ids: string[] = [];
    for (let r = 0; r < 36; r++) {
      const run = await db.createScanRun({ businessId: b.id, kind: "monthly", engines: ["chatgpt"], samplesPerPrompt: 50 });
      const rows = await db.insertSamples(Array.from({ length: 50 }, (_, i) => ({ scanRunId: run.id, promptId: prompt!.id, engine: "chatgpt" as const, answerText: `antwoord ${r}-${i}`, citations: [], costCents: 0 })));
      ids.push(...rows.map((s) => s.id));
      // Interleaved: another business's run between ours (SEC-40).
      const orun = await db.createScanRun({ businessId: other.id, kind: "monthly", engines: ["chatgpt"], samplesPerPrompt: 1 });
      await db.insertSamples([{ scanRunId: orun.id, promptId: otherPrompt!.id, engine: "chatgpt", answerText: "niet van jou", citations: [], costCents: 0 }]);
    }
    let reads = 0;
    const counted = new Proxy(db, {
      get(t, k, r) {
        const v = Reflect.get(t, k, r);
        if (k === "listSamplesForRuns") return (...a: unknown[]) => (reads++, (v as (...x: unknown[]) => unknown).apply(t, a));
        return typeof v === "function" ? v.bind(t) : v;
      },
    }) as Db;
    const started = Date.now();
    const parsed = JSON.parse(await readAll(streamMyData(counted, b.id, { signedInAs: "x@example.nl" })));
    const ms = Date.now() - started;
    const seen = parsed.scans.flatMap((s: { samples: { id: string }[] }) => s.samples.map((x) => x.id));
    expect(reads).toBe(Math.ceil(36 / EXPORT_RUN_PAGE));
    expect(seen.sort()).toEqual([...ids].sort());
    expect(JSON.stringify(parsed)).not.toContain("niet van jou");
    console.log(`[export timing] ${_n}: 36 runs x 50 answers streamed in ${ms} ms`);
    expect(ms).toBeLessThan(30_000);
  }, 60_000);

  it("an unknown business streams null", async () => {
    const db = await makeDb();
    expect(await readAll(streamMyData(db, randomUUID(), { signedInAs: "x" }))).toBe("null");
  });
});
