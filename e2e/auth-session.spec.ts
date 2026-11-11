import { expect, test } from "@playwright/test";
import { captureAuthCookies, DEMO_OWNER, gotrueStats, isSignInPage, linkFor, signIn } from "./helpers-account";

/**
 * Feature 002 AC-3: the session. Runs only under playwright.auth.config.ts
 * (pnpm e2e:auth), against the fake GoTrue with 5-second access tokens.
 */
test.skip(!process.env.E2E_AUTH, "needs the fake GoTrue: pnpm e2e:auth");

const OWNER_PAGES = ["/app", "/app/voortgang", "/app/account", "/en/app"];

test("(b) stays signed in across access-token expiries", async ({ page }) => {
  test.setTimeout(180_000);
  // Compile every page first: on a cold dev server one compile outlasts several token lifetimes.
  for (const path of OWNER_PAGES) await page.request.get(path);
  await signIn(page, DEMO_OWNER, "/app");
  await expect(page).toHaveURL(/\/app(\?|$)/);
  const until = Date.now() + 15_000;
  const visited: string[] = [];
  let i = 0;
  while (Date.now() < until) {
    const path = OWNER_PAGES[i++ % OWNER_PAGES.length]!;
    await page.goto(path);
    visited.push(`${path} -> ${new URL(page.url()).pathname}`);
    if (isSignInPage(page.url())) {
      const kinds = (await gotrueStats(page.request)).events.map((e) => e.kind).join(", ");
      expect.soft(kinds, "fake GoTrue events when signed out").toBe("");
    }
    expect(isSignInPage(page.url()), `signed out on ${path} after ${visited.length} loads: ${visited.join(", ")}`).toBe(false);
    await page.waitForTimeout(700);
  }
  const stats = await gotrueStats(page.request);
  const reused = stats.events.filter((e) => e.kind === "refresh.reuse_revoked");
  expect(reused, "refresh-token reuse detected").toHaveLength(0);
  // Three expiries in 15 s, each refreshed once (SEC-16).
  const mine = stats.sessions.at(-1)!;
  expect(mine.revoked).toBe(false);
  expect(mine.refreshes).toBeGreaterThanOrEqual(2);
});

test("(a) every auth cookie is HttpOnly and SameSite=Lax, and never cacheable", async ({ page, context }) => {
  const seen = captureAuthCookies(context);
  await signIn(page, DEMO_OWNER, "/app");
  // Past one expiry, so the middleware refreshes and writes the cookie again.
  await page.waitForTimeout(6_000);
  await page.goto("/app/account");
  await page.waitForTimeout(6_000);
  await page.goto("/en/app");
  expect(seen.length, "no sb- cookie seen at all").toBeGreaterThan(0);
  for (const s of seen) {
    expect(s.cookie, s.url).toMatch(/;\s*HttpOnly/i);
    expect(s.cookie, s.url).toMatch(/;\s*SameSite=Lax/i);
    expect(s.cookie, s.url).toMatch(/;\s*Path=\//i);
    // http://localhost: no Secure (it would never be sent back).
    expect(s.cookie, s.url).not.toMatch(/;\s*Secure/i);
    // F-018: a response that sets a session cookie is never stored by a cache. The dev server
    // forces "no-store" on every page over the middleware's "private, no-store"; the workerd
    // build is read for both (04-build.md).
    expect(s.cacheControl, s.url).toMatch(/no-store/);
  }
  // The refresh on the rewritten English page delivered its cookie too.
  expect(seen.some((s) => new URL(s.url).pathname.startsWith("/en/"))).toBe(true);
});

test("F-018: a refresh on a public page does not hand the session to the next visitor", async ({ page, browser }) => {
  await signIn(page, DEMO_OWNER, "/app");
  await page.waitForTimeout(6_000);
  const a = await page.request.get("/");
  const aCookies = a.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie" && h.value.startsWith("sb-"));
  expect(aCookies.length, "the expired token is refreshed on /").toBeGreaterThan(0);
  expect(a.headers()["cache-control"]).toMatch(/no-store/);
  const other = await browser.newContext();
  const b = await other.request.get("/");
  expect(b.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie" && h.value.startsWith("sb-"))).toHaveLength(0);
  const bPage = await other.newPage();
  await bPage.goto("/app");
  expect(isSignInPage(bPage.url())).toBe(true);
  await other.close();
});

test("authCookieOptions: Secure only on https", async () => {
  const { authCookieOptions, AUTH_COOKIE_MAX_AGE } = await import("../apps/web/lib/auth-cookies");
  expect(authCookieOptions("https://vidalo.ai").secure).toBe(true);
  expect(authCookieOptions("http://localhost:3000").secure).toBe(false);
  expect(authCookieOptions("https://vidalo.ai")).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 90 * 86400 });
  expect(AUTH_COOKIE_MAX_AGE).toBe(90 * 86400);
});

test("SEC-18: a forged session cookie signs nobody in and costs at most one GoTrue call", async ({ context, page }) => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const past = Math.floor(Date.now() / 1000) - 60;
  const foreignJwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "00000000-0000-4000-8000-000000000001", email: DEMO_OWNER, session_id: "00000000-0000-4000-8000-000000000002", exp: past })}.c2lnbmVkLWJ5LWFub3RoZXIta2V5`;
  const values = [
    "garbage",
    `base64-${b64({ access_token: foreignJwt, refresh_token: "0123456789abcdef", expires_at: past, expires_in: 5, token_type: "bearer", user: { id: "x" } })}`,
  ];
  for (const value of values) {
    await context.clearCookies();
    await context.addCookies([{ name: "sb-127-auth-token", value, url: page.url().startsWith("http") ? page.url() : "http://localhost:3102/" }]);
    const before = await gotrueStats(page.request);
    const total = (s: typeof before) => Object.entries(s.calls).filter(([k]) => k.includes("/auth/v1/")).reduce((a, [, n]) => a + n, 0);
    const res = await page.request.get("/app", { maxRedirects: 0 });
    expect(res.headers()["location"] ?? "").toMatch(/\/inloggen/);
    const after = await gotrueStats(page.request);
    // One /token or /user call at most for the middleware and the page together.
    expect(total(after) - total(before)).toBeLessThanOrEqual(1);
    const setSession = res.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie" && /^sb-[^=]+=[^;]+/.test(h.value) && !/^sb-[^=]+=;/.test(h.value));
    expect(setSession, value.slice(0, 12)).toHaveLength(0);
  }
});

// ---- A-02: sign-in by POST, recorded; sign out here or everywhere; the sign-in list ----

test("AC-4(d): opening the link twice uses nothing up; the button signs in", async ({ page }) => {
  const tokenHash = await linkFor(page.request, DEMO_OWNER);
  const verifies = async () => (await gotrueStats(page.request)).calls["POST /auth/v1/verify"] ?? 0;
  const before = await verifies();
  for (let i = 0; i < 2; i++) {
    const res = await page.request.get(`/auth/confirm?token_hash=${tokenHash}&type=email&next=%2Fapp`);
    expect(res.status()).toBe(200);
    expect(res.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie" && h.value.startsWith("sb-"))).toHaveLength(0);
  }
  expect(await verifies()).toBe(before);
  await page.goto(`/auth/confirm?token_hash=${tokenHash}&type=email&next=%2Fapp`);
  await page.getByRole("button", { name: "Inloggen" }).click();
  await page.waitForURL(/\/app(\?|$)/);
  expect(await verifies()).toBe(before + 1);
});

test("SEC-27: a link of another type or shape never reaches Supabase", async ({ page }) => {
  const verifies = async () => (await gotrueStats(page.request)).calls["POST /auth/v1/verify"] ?? 0;
  const before = await verifies();
  for (const q of [`token_hash=${await linkFor(page.request, DEMO_OWNER)}&type=recovery`, `token_hash=${"a".repeat(10_000)}&type=email`, `token_hash=abc%22%3E&type=email`]) {
    await page.goto(`/auth/confirm?${q}&next=%2Fapp`);
    await page.getByRole("button", { name: "Inloggen" }).click();
    await page.waitForURL(/\/inloggen\?fout=link/);
  }
  expect(await verifies()).toBe(before);
});

test("SEC-26: a foreign Origin cannot post the confirm action", async ({ page, baseURL }) => {
  const tokenHash = await linkFor(page.request, DEMO_OWNER);
  const html = await (await page.request.get(`/auth/confirm?token_hash=${tokenHash}&type=email&next=%2Fapp`)).text();
  const actionField = /name="(\$ACTION_ID_[^"]+)"/.exec(html)?.[1];
  expect(actionField, "server action id in the form").toBeTruthy();
  const verifies = async () => (await gotrueStats(page.request)).calls["POST /auth/v1/verify"] ?? 0;
  const before = await verifies();
  const res = await page.request.post("/auth/confirm", {
    headers: { origin: "https://evil.example" },
    multipart: { [actionField!]: "", token_hash: tokenHash, type: "email", code: "", next: "/app" },
    maxRedirects: 0,
  });
  expect(res.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie" && h.value.startsWith("sb-"))).toHaveLength(0);
  expect(await verifies()).toBe(before);
  // Control: the same post from our own origin signs in.
  const ok = await page.request.post("/auth/confirm", {
    headers: { origin: new URL(baseURL!).origin },
    multipart: { [actionField!]: "", token_hash: tokenHash, type: "email", code: "", next: "/app" },
    maxRedirects: 0,
  });
  expect(ok.headersArray().some((h) => h.name.toLowerCase() === "set-cookie" && h.value.startsWith("sb-"))).toBe(true);
  expect(await verifies()).toBe(before + 1);
});

test("SEC-19: a token signed with another key, or unsigned, is nobody", async ({ context, page }) => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const future = Math.floor(Date.now() / 1000) + 3600;
  const claims = { sub: "00000000-0000-4000-8000-000000000001", email: DEMO_OWNER, session_id: "00000000-0000-4000-8000-000000000002", exp: future, aud: "authenticated", role: "authenticated" };
  for (const [alg, sig] of [["HS256", "c2lnbmVkLWJ5LWFub3RoZXIta2V5"], ["none", ""]] as const) {
    const jwt = `${b64({ alg, typ: "JWT" })}.${b64(claims)}.${sig}`;
    await context.clearCookies();
    await context.addCookies([{ name: "sb-127-auth-token", value: `base64-${b64({ access_token: jwt, refresh_token: "0123456789abcdef", expires_at: future, expires_in: 3600, token_type: "bearer", user: { id: claims.sub, email: DEMO_OWNER } })}`, url: "http://localhost:3102/" }]);
    await page.goto("/app");
    expect(isSignInPage(page.url()), alg).toBe(true);
  }
});

test("(d) Uitloggen ends this browser only; (f) the list shows both sign-ins; (e) Overal uitloggen ends the other", async ({ browser }) => {
  test.setTimeout(120_000);
  const a = await browser.newContext({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" });
  const b = await browser.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0" });
  const pa = await a.newPage();
  const pb = await b.newPage();
  await signIn(pa, DEMO_OWNER, "/app");
  await signIn(pb, DEMO_OWNER, "/app");
  await expect(pb).toHaveURL(/\/app(\?|$)/);

  // (f) newest first, both families, this device marked.
  await pb.goto("/app/account");
  const items = pb.locator("[data-sign-ins] > li");
  await expect(items.first()).toContainText("Firefox op Windows");
  await expect(items.first()).toContainText("dit apparaat");
  await expect(items.nth(1)).toContainText("Chrome op een Mac");
  await expect(items.nth(1)).not.toContainText("dit apparaat");

  // (d) A signs out here: B keeps /app.
  await pa.goto("/app/account");
  await pa.locator("form[action='/auth/uitloggen'] button").first().click();
  await pa.waitForURL((u) => u.pathname === "/");
  await pa.goto("/app");
  expect(isSignInPage(pa.url())).toBe(true);
  await pb.goto("/app");
  expect(isSignInPage(pb.url())).toBe(false);

  // (e) A signs in again and signs out everywhere: B's next load lands on /inloggen, with the reason.
  await signIn(pa, DEMO_OWNER, "/app/account");
  await pa.getByRole("button", { name: "Overal uitloggen" }).click();
  await pa.waitForURL(/\/inloggen\?uitgelogd=overal/);
  await expect(pa.getByRole("status")).toContainText("Je bent op al je apparaten uitgelogd.");
  await pb.goto("/app");
  expect(isSignInPage(pb.url())).toBe(true);
  await expect(pb.getByRole("status")).toContainText("Je bent uitgelogd");
  // GoTrue was asked for a global sign-out (SEC-22).
  expect((await gotrueStats(pa.request)).events.some((e) => e.kind === "logout.global")).toBe(true);
  await a.close();
  await b.close();
});

// ---- A-03: link limits, no enumeration, Origin checks, fresh sign-in ----

async function requestLink(page: import("@playwright/test").Page, email: string): Promise<{ url: string; action: { status: number; location: string | null } }> {
  await page.goto("/inloggen");
  await page.locator("input[name='email']").fill(email);
  const posted = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/inloggen");
  await page.locator("form button[type='submit']").first().click();
  const res = await posted;
  await page.waitForURL(/\/inloggen\?(sent|fout)=/);
  return { url: page.url(), action: { status: res.status(), location: res.headers()["x-action-redirect"] ?? res.headers()["location"] ?? null } };
}

test("AC-4(a): the same answer for an address with a business, with only an account, and unknown", async ({ page }) => {
  const accountOnly = `alleen-account-${Date.now()}@example.nl`;
  await linkFor(page.request, accountOnly); // the fake now has a user for it
  const out = [];
  for (const email of [DEMO_OWNER, accountOnly, `onbekend-${Date.now()}@example.nl`]) out.push(await requestLink(page, email));
  for (const o of out) expect(o.url).toMatch(/\/inloggen\?sent=1$/);
  expect(new Set(out.map((o) => JSON.stringify(o.action))).size, JSON.stringify(out.map((o) => o.action))).toBe(1);
  // The dev server adds a per-request "?v=<time>" to its asset links and Next a per-render id (__next_r); nothing else may differ.
  const bodies = await Promise.all([0, 1, 2].map(async () => (await (await page.request.get("/inloggen?sent=1")).text()).replace(/\?v=\d+/g, "").replace(/__next_r="[^"]*"/g, "")));
  const at = [...bodies[0]!].findIndex((c, i) => c !== bodies[1]![i] || c !== bodies[2]![i]);
  expect(new Set(bodies).size, at < 0 ? "" : `${bodies[0]!.slice(at - 60, at + 60)} | ${bodies[1]!.slice(at - 60, at + 60)}`).toBe(1);
});

test("AC-4(b): the 6th link for one address in an hour is refused, and nothing is mailed", async ({ page }) => {
  const email = `zes-${Date.now()}@example.nl`;
  const mails = async () => ((await (await page.request.get(`${process.env.FAKE_GOTRUE_URL}/__test/mails?email=${email}`)).json()) as unknown[]).length;
  for (let i = 0; i < 5; i++) expect((await requestLink(page, email)).url).toMatch(/sent=1/);
  expect(await mails()).toBe(5);
  expect((await requestLink(page, email)).url).toMatch(/fout=wacht/);
  expect(await mails()).toBe(5);
  await expect(page.locator("form")).toContainText("Je hebt net al een inloglink gevraagd");
});

test("AC-4(e): a foreign POST to sign-out or the billing portal changes nothing", async ({ page }) => {
  await signIn(page, DEMO_OWNER, "/app");
  const out = await page.request.post("/auth/uitloggen", { headers: { origin: "https://evil.example" }, maxRedirects: 0 });
  expect(out.status()).toBe(403);
  const portal = await page.request.post("/api/billing/portal", { headers: { origin: "https://evil.example" }, form: { business: "x" }, maxRedirects: 0 });
  expect(portal.status()).toBe(403);
  await page.goto("/app");
  expect(isSignInPage(page.url())).toBe(false);
  // Control: from our own origin, sign-out works.
  const own = await page.request.post("/auth/uitloggen", { headers: { origin: "http://localhost:3102" }, maxRedirects: 0 });
  expect(own.status()).toBe(303);
});

test("AC-5(c): changing the address needs a recent sign-in and returns to the open form", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, DEMO_OWNER, "/app/account");
  // Stale: the test server's fresh window is 20 s (VIDALO_TEST_FRESH_SECONDS).
  await page.waitForTimeout(21_000);
  await page.goto("/app/account");
  await expect(page, "still signed in, only no longer fresh").toHaveURL(/\/app\/account/);
  page.on("request", (r) => r.method() === "POST" && console.log("[ac5c] POST", r.url()));
  page.on("response", (r) => r.request().method() === "POST" && console.log("[ac5c] answer", r.status(), r.headers()["x-action-redirect"] ?? ""));
  page.on("requestfailed", (r) => console.log("[ac5c] failed", r.url(), r.failure()?.errorText));
  await page.locator("input[name='email'][type='email']").fill("nieuw@example.nl");
  await page.getByRole("button", { name: "Wijzig" }).click();
  await page.waitForURL(/\/inloggen\?opnieuw=1/);
  expect(new URL(page.url()).searchParams.get("next")).toBe("/app/account?stap=email#inlog");
  await expect(page.getByRole("status")).toContainText("Voor deze stap log je eerst opnieuw in");
  await expect(page.locator("input[name='email']")).toHaveValue(DEMO_OWNER);
  // A new sign-in through that link lands on the open address form.
  await signIn(page, DEMO_OWNER, "/app/account?stap=email#inlog");
  await expect(page).toHaveURL(/\/app\/account\?stap=email/);
  await expect(page.locator("input[data-step='open']")).toBeFocused();
});

test("A-05 / SEC-37: the delete step needs a recent sign-in and returns to the same step", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, DEMO_OWNER, "/app/account/verwijderen");
  await expect(page).toHaveURL(/\/app\/account\/verwijderen$/);
  // Refreshed tokens do not make a sign-in fresh: wait past the test window (20 s) with refreshes in between.
  await page.waitForTimeout(12_000);
  await page.goto("/app");
  await page.waitForTimeout(9_000);
  await page.goto("/app/account/verwijderen");
  await page.waitForURL(/\/inloggen\?opnieuw=1/);
  expect(new URL(page.url()).searchParams.get("next")).toBe("/app/account/verwijderen");
  await signIn(page, DEMO_OWNER, "/app/account/verwijderen");
  await expect(page).toHaveURL(/\/app\/account\/verwijderen$/);
  await expect(page.getByRole("button", { name: "Verwijder alles" })).toBeVisible();
});
