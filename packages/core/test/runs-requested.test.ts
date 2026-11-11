import { describe, expect, it } from "vitest";
import { runsRequested } from "../src/shared/free-check";

const now = Date.parse("2026-11-11T12:00:00Z");
const run = (id: string, startedAt: string, extra: Partial<{ kind: string; status: string }> = {}) => ({ id, kind: "free", status: "done", startedAt, finishedAt: startedAt, ...extra });
const runs: Record<string, ReturnType<typeof run>[]> = {
  sonable: [
    run("mine-legacy", "2026-11-11T07:39:52Z"),
    run("other-later", "2026-11-11T10:00:00Z"),
    run("paid", "2026-11-11T07:40:10Z", { kind: "baseline" }),
    run("failed", "2026-11-11T07:41:00Z", { status: "failed" }),
  ],
  bakkerij: [run("linked", "2026-11-01T09:00:00Z"), run("too-old", "2026-09-01T09:00:00Z")],
};
const opts = { now, maxAgeDays: 30 };

describe("runsRequested: only the checks this address asked for", () => {
  it("matches a request without a run id to the run that started right after it (Sonable, 11 Nov 2026)", () => {
    const got = runsRequested([{ businessId: "sonable", at: "2026-11-11T07:39:48Z", payload: { email: "julian@sonable.io" } }], (id) => runs[id] ?? [], opts);
    expect(got.map((r) => r.runId)).toEqual(["mine-legacy"]);
  });

  it("never lists another requester's later run of the same business", () => {
    const got = runsRequested([{ businessId: "sonable", at: "2026-11-11T07:39:48Z", payload: {} }], (id) => runs[id] ?? [], opts);
    expect(got.map((r) => r.runId)).not.toContain("other-later");
  });

  it("uses the run id on the request when there is one", () => {
    const got = runsRequested([{ businessId: "bakkerij", at: "2026-11-01T08:00:00Z", payload: { scanRunId: "linked" } }], (id) => runs[id] ?? [], opts);
    expect(got.map((r) => r.runId)).toEqual(["linked"]);
  });

  it("leaves out paid, failed and expired runs", () => {
    const got = runsRequested(
      [
        { businessId: "sonable", at: "2026-11-11T07:39:40Z", payload: {} },
        { businessId: "bakkerij", at: "2026-09-01T08:59:00Z", payload: {} },
      ],
      (id) => runs[id] ?? [],
      opts,
    );
    expect(got.map((r) => r.runId)).toEqual(["mine-legacy"]);
  });
});
