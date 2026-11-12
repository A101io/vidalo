import { describe, expect, it } from "vitest";
import { isFreshSignIn, sessionVerdict, uaFamily, FRESH_MINUTES, IDLE_DAYS, MAX_DAYS } from "../src/shared/session-life";
import type { SignInRow } from "../src/db/types";

/** Feature 002 AC-3(c): a sign-in ends after 30 days unused or 90 days. Fake clock throughout. */
const NOW = new Date("2026-11-11T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const DAY = 86_400_000;
const MIN = 60_000;

const row = (over: Partial<SignInRow> = {}): SignInRow => ({
  sessionId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  signedInAt: ago(DAY),
  lastSeenAt: ago(MIN),
  endedAt: null,
  endedReason: null,
  browser: "chrome",
  os: "macos",
  ...over,
});

describe("sessionVerdict", () => {
  it("names the constants of Julian's decision", () => {
    expect([IDLE_DAYS, MAX_DAYS, FRESH_MINUTES]).toEqual([30, 90, 15]);
  });
  it("missing row → missing", () => expect(sessionVerdict(null, NOW)).toBe("missing"));
  it("ended row → ended", () => expect(sessionVerdict(row({ endedAt: ago(MIN), endedReason: "signed_out" }), NOW)).toBe("ended"));
  it("last seen 30 days and 1 minute ago → idle", () => expect(sessionVerdict(row({ signedInAt: ago(40 * DAY), lastSeenAt: ago(30 * DAY + MIN) }), NOW)).toBe("idle"));
  it("last seen 29 days 23 hours ago → ok", () => expect(sessionVerdict(row({ signedInAt: ago(40 * DAY), lastSeenAt: ago(30 * DAY - 60 * MIN) }), NOW)).toBe("ok"));
  it("signed in 90 days and 1 minute ago, seen today → max_age", () => expect(sessionVerdict(row({ signedInAt: ago(90 * DAY + MIN), lastSeenAt: ago(MIN) }), NOW)).toBe("max_age"));
  it("29 days idle and 89 days old → ok", () => expect(sessionVerdict(row({ signedInAt: ago(89 * DAY), lastSeenAt: ago(29 * DAY) }), NOW)).toBe("ok"));
});

describe("isFreshSignIn", () => {
  it("14:59 after signing in is fresh", () => expect(isFreshSignIn({ signedInAt: ago(14 * MIN + 59_000) }, NOW)).toBe(true));
  it("15:01 after signing in is not", () => expect(isFreshSignIn({ signedInAt: ago(15 * MIN + 1000) }, NOW)).toBe(false));
  it("a placeholder or garbage date is never fresh", () => {
    expect(isFreshSignIn({ signedInAt: "1970-01-01T00:00:00.000Z" }, NOW)).toBe(false);
    expect(isFreshSignIn({ signedInAt: "nonsense" }, NOW)).toBe(false);
  });
  it("a date in the future is not fresh", () => expect(isFreshSignIn({ signedInAt: new Date(NOW.getTime() + 10 * MIN).toISOString() }, NOW)).toBe(false));
});

describe("uaFamily", () => {
  const cases: [string, ReturnType<typeof uaFamily>][] = [
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", { browser: "chrome", os: "macos" }],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", { browser: "safari", os: "ios" }],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0", { browser: "firefox", os: "windows" }],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0", { browser: "edge", os: "windows" }],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36", { browser: "chrome", os: "android" }],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1", { browser: "chrome", os: "ios" }],
    ["", { browser: "other", os: "other" }],
  ];
  for (const [ua, want] of cases) it(ua.slice(0, 40) || "(empty)", () => expect(uaFamily(ua)).toEqual(want));
  it("null → other", () => expect(uaFamily(null)).toEqual({ browser: "other", os: "other" }));
});
