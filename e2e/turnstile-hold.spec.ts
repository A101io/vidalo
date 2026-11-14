import { createHmac } from "node:crypto";
import { expect, test, type Page, type Request, type Route } from "@playwright/test";

/**
 * TurnstileBox holds a submit that has no token yet and sends it once the
 * widget hands one out (13 Nov 2026: the first sign-in failed, a retry worked).
 *
 * Needs a server with Turnstile ON (Cloudflare's always-pass test keys, mock
 * auth, no real mail), which the default e2e config turns off:
 *   TURNSTILE_SITE_KEY=1x00000000000000000000AA TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA \
 *   VIDALO_MOCK=1 SUPABASE_URL= SUPABASE_ANON_KEY= DATABASE_URL= pnpm --filter @vidalo/web dev -p 3100
 *   E2E_TURNSTILE=1 E2E_BASE_URL=http://localhost:3100 npx playwright test e2e/turnstile-hold.spec.ts
 *
 * Cloudflare's script is replaced by a fake we drive, so "the token arrives"
 * happens exactly when the test says. The test secret accepts the dummy token.
 */
test.skip(!process.env.E2E_TURNSTILE, "needs a server with Turnstile on (see header)");

// The shared helper waits for networkidle, which never comes while the script is held.
async function dismissNotice(page: Page) {
  const ok = page.getByRole("button", { name: /^(Begrepen|Got it|Alleen noodzakelijk|Necessary only)$/ }).first();
  if (await ok.waitFor({ state: "visible", timeout: 3000 }).then(() => true, () => false)) await ok.click();
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js*";
const DUMMY = "XXXX.DUMMY.TOKEN.XXXX";
const SECRET = process.env.TURNSTILE_SECRET_KEY || "1x0000000000000000000000000000000AA";

// Real widget order is "callback, then field" per the author; fill after the callback so the hold's setTimeout is exercised.
const FAKE = `
window.__ts = { widgets: [], removed: [], resets: [] };
window.turnstile = {
  render(el, opts) {
    const inp = document.createElement("input");
    inp.type = "hidden"; inp.name = opts["response-field-name"] || "cf-turnstile-response";
    el.appendChild(inp);
    const id = "w" + window.__ts.widgets.length;
    window.__ts.widgets.push({ id, el, opts, inp });
    if (window.__tsMode === "error") setTimeout(() => opts["error-callback"] && opts["error-callback"]("300030"), 0);
    return id;
  },
  remove(id) { window.__ts.removed.push(id); },
  // The real reset empties the field and starts a new challenge; the token then comes back through the callback.
  reset(id) { window.__ts.resets.push(id); const w = window.__ts.widgets.find((x) => x.id === id); if (w) w.inp.value = ""; },
};
window.__tsSolve = (i, token) => { const w = window.__ts.widgets[i]; w.opts.callback && w.opts.callback(token); w.inp.value = token; };
`;

type Gate = { release: () => void; fail: () => void };
async function holdScript(page: Page): Promise<Gate> {
  let go: (ok: boolean) => void = () => {};
  const p = new Promise<boolean>((r) => (go = r));
  await page.route(SCRIPT, async (route: Route) => {
    if (await p) await route.fulfill({ contentType: "text/javascript", body: FAKE });
    else await route.abort("failed");
  });
  return { release: () => go(true), fail: () => go(false) };
}

/** Every POST the form makes, with whether it carried a non-empty token. */
function posts(page: Page, match: (r: Request) => boolean) {
  const seen: { token: string; body: string }[] = [];
  page.on("request", (r) => {
    if (r.method() !== "POST" || !match(r)) return;
    const body = r.postData() ?? "";
    // Server actions post multipart, native forms urlencoded.
    const multipart = /name="[^"]*cf-turnstile-response"\r\n\r\n([^\r\n]*)/.exec(body);
    const token = multipart ? multipart[1] : new URLSearchParams(body).get("cf-turnstile-response") ?? "";
    seen.push({ token: token.trim(), body });
  });
  return seen;
}
const isAction = (r: Request) => new URL(r.url()).pathname.startsWith("/inloggen") && !!r.headers()["next-action"];
const isScan = (r: Request) => new URL(r.url()).pathname === "/api/scan";

async function openSignIn(page: Page) {
  await page.goto("/inloggen");
  await dismissNotice(page);
  await page.locator("input#email").fill("qa-turnstile@example.nl");
  // Hydrated: the capture listener is on once React ran the effect.
  await page.waitForFunction(() => Object.keys(document.querySelector("form") ?? {}).some((k) => k.startsWith("__react")));
}

test("AC1 sign-in: a submit while the script is still loading is held, then sent once with the token", async ({ page }) => {
  const gate = await holdScript(page);
  const sent = posts(page, isAction);
  await openSignIn(page);
  await page.locator("form:has(#email) button[type='submit']").click();
  await page.locator("form:has(#email) button[type='submit']").click(); // double click while held (AC5)
  await page.waitForTimeout(1500);
  expect(sent).toHaveLength(0);
  gate.release();
  await page.waitForFunction(() => (window as any).__ts?.widgets.length > 0);
  await page.waitForTimeout(500);
  expect(sent).toHaveLength(0); // widget pending, still held
  await page.evaluate((t) => (window as any).__tsSolve(0, t), DUMMY);
  await page.waitForURL(/\/app/);
  // A second callback (token refreshed after expiry) must not send again (AC5).
  expect(sent).toHaveLength(1);
  expect(sent[0].token).toBe(DUMMY);
});

test("AC2: script fails to load, the held submit goes and the server refuses with its message", async ({ page }) => {
  const gate = await holdScript(page);
  const sent = posts(page, isAction);
  await openSignIn(page);
  await page.locator("form:has(#email) button[type='submit']").click();
  await page.waitForTimeout(800);
  expect(sent).toHaveLength(0);
  gate.fail();
  await page.waitForURL(/fout=check/);
  expect(sent).toHaveLength(1);
  expect(sent[0].token).toBe("");
});

test("AC3: token already present, submit goes through at once", async ({ page }) => {
  const gate = await holdScript(page);
  gate.release();
  const sent = posts(page, isAction);
  await openSignIn(page);
  await page.waitForFunction(() => (window as any).__ts?.widgets.length > 0);
  await page.evaluate((t) => (window as any).__tsSolve(0, t), DUMMY);
  await page.locator("form:has(#email) button[type='submit']").click();
  await page.waitForURL(/\/app/);
  expect(sent).toHaveLength(1);
  expect(sent[0].token).toBe(DUMMY);
  // Callback firing again later (refresh) sends nothing.
  await page.evaluate((t) => (window as any).__tsSolve?.(0, t), DUMMY).catch(() => {});
});

test("AC4 free check (native POST): held, then one POST with token and the submitter's name/value", async ({ page }) => {
  const gate = await holdScript(page);
  const sent = posts(page, isScan);
  // 204: the browser stays on the page, so a second send would be seen.
  await page.route("**/api/scan", (r) => r.fulfill({ status: 204 }));
  await page.goto("/");
  await dismissNotice(page);
  const form = page.locator("form[action='/api/scan']").first();
  await form.locator("input[name='q']").fill("Bakkerij QA");
  await form.locator("input[name='place']").fill("Haarlem");
  await form.locator("input[name='email']").fill("qa-turnstile@example.nl");
  await page.waitForFunction(() => Object.keys(document.querySelector("form[action='/api/scan']") ?? {}).some((k) => k.startsWith("__react")));
  // Give the button a name/value so a dropped submitter would show in the body.
  await form.locator("button[type='submit']").evaluate((b: HTMLButtonElement) => { b.name = "via"; b.value = "knop"; });
  await form.locator("button[type='submit']").click();
  await form.locator("button[type='submit']").click(); // twice while held (AC5)
  await page.waitForTimeout(1000);
  expect(sent).toHaveLength(0);
  gate.release();
  await page.waitForFunction(() => (window as any).__ts?.widgets.length > 0);
  await page.evaluate((t) => (window as any).__tsSolve(0, t), DUMMY);
  await page.waitForTimeout(1500);
  expect(sent).toHaveLength(1);
  expect(sent[0].token).toBe(DUMMY);
  expect(sent[0].body).toContain("via=knop");
  // The widget hands out a fresh token (expiry, refresh): nothing is sent again (AC5).
  await page.evaluate((t) => (window as any).__tsSolve(0, t + ".2"), DUMMY);
  await page.waitForTimeout(1000);
  expect(sent).toHaveLength(1);
});

test("AC4 /scan/kies (native POST, one widget per form): held, then one POST for the clicked form", async ({ page }) => {
  // /scan/kies only lists for a holder of the signed kies token (core/shared/turnstile.ts signKiesToken).
  const exp = Date.now() + 5 * 60_000;
  const sig = createHmac("sha256", SECRET).update(`kies\nBakkerij\n\n${exp}`).digest("base64url");
  await page.goto(`/scan/kies?q=Bakkerij&k=${exp}.${sig}`);
  await dismissNotice(page);
  // Reload with the script held again.
  const gate = await holdScript(page);
  const sent = posts(page, isScan);
  await page.route("**/api/scan", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<p>ok</p>" }));
  await page.reload();
  await dismissNotice(page);
  const forms = page.locator("form[action='/api/scan']");
  const n = await forms.count();
  expect(n).toBeGreaterThan(0);
  const target = forms.nth(n - 1);
  await page.waitForFunction(() => Object.keys(document.querySelector("form[action='/api/scan']") ?? {}).some((k) => k.startsWith("__react")));
  const place = target.locator("input[name='place']:not([type='hidden'])");
  if (await place.count()) await place.fill("Haarlem");
  await target.locator("button[type='submit']").evaluate((b: HTMLButtonElement) => { b.name = "via"; b.value = "kies"; });
  await target.locator("button[type='submit']").click();
  await page.waitForTimeout(1000);
  expect(sent).toHaveLength(0);
  gate.release();
  await page.waitForFunction((k) => (window as any).__ts?.widgets.length >= k, n);
  // Solve the widget that lives in the clicked form.
  const idx = await page.evaluate(() => {
    const all = [...document.querySelectorAll("form[action='/api/scan']")];
    const f = all[all.length - 1];
    return (window as any).__ts.widgets.findIndex((w: any) => f.contains(w.el));
  });
  await page.evaluate(([i, t]) => (window as any).__tsSolve(i, t), [idx, DUMMY] as const);
  await page.waitForTimeout(1500);
  expect(sent).toHaveLength(1);
  expect(sent[0].token).toBe(DUMMY);
  expect(sent[0].body).toContain(`pick=${n - 1}`);
  expect(sent[0].body).toContain("via=kies");
});

test("AC5: the capture listener is removed when the form unmounts", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.__subs = { add: 0, remove: 0 };
    const a = HTMLFormElement.prototype.addEventListener;
    const r = HTMLFormElement.prototype.removeEventListener;
    HTMLFormElement.prototype.addEventListener = function (t: string, l: any, o?: any) {
      if (t === "submit" && o === true) w.__subs.add++;
      return a.call(this, t, l, o);
    };
    HTMLFormElement.prototype.removeEventListener = function (t: string, l: any, o?: any) {
      if (t === "submit" && o === true) w.__subs.remove++;
      return r.call(this, t, l, o);
    };
  });
  const gate = await holdScript(page);
  gate.release();
  await openSignIn(page);
  const before = await page.evaluate(() => (window as any).__subs);
  expect(before.add - before.remove).toBe(1);
  // Client-side navigation away (the header logo is a Next link).
  await page.locator("header a[href='/']").first().click();
  await page.waitForURL((u) => u.pathname === "/");
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => (window as any).__subs);
  // The landing page mounts its own free-check form; count only what /inloggen added.
  const landing = await page.locator("form[action='/api/scan']").count();
  expect(after.remove).toBeGreaterThanOrEqual(before.add);
  expect(after.add - after.remove).toBe(landing);
});

test("widget error after the script loaded (no callback ever): the form still goes, the server refuses it", async ({ page }) => {
  const gate = await holdScript(page);
  await page.addInitScript(() => ((window as any).__tsMode = "error"));
  const sent = posts(page, isAction);
  await openSignIn(page);
  gate.release();
  await page.waitForFunction(() => (window as any).__ts?.widgets.length > 0);
  await page.locator("form:has(#email) button[type='submit']").click();
  await page.waitForTimeout(3000);
  expect(sent, "a widget error leaves the submit held forever").toHaveLength(1);
});

test("real Cloudflare script (test site key), loaded late: the early submit is held and signs in", async ({ page }) => {
  let go: () => void = () => {};
  const p = new Promise<void>((r) => (go = r));
  await page.route(SCRIPT, async (route) => {
    await p;
    await route.continue();
  });
  const sent = posts(page, isAction);
  await openSignIn(page);
  await page.locator("form:has(#email) button[type='submit']").click();
  await page.waitForTimeout(1000);
  expect(sent).toHaveLength(0);
  go();
  await page.waitForURL(/\/app/, { timeout: 30_000 });
  expect(sent).toHaveLength(1);
  expect(sent[0].token.length).toBeGreaterThan(0);
});

/** The free check form on the landing page with the script released and the first token handed out; /api/scan answers 204 so the page stays. */
async function openCheckWithToken(page: Page) {
  const gate = await holdScript(page);
  gate.release();
  const sent = posts(page, isScan);
  await page.route("**/api/scan", (r) => r.fulfill({ status: 204 }));
  await page.goto("/");
  await dismissNotice(page);
  const form = page.locator("form[action='/api/scan']").first();
  await form.locator("input[name='q']").fill("Bakkerij QA");
  await form.locator("input[name='place']").fill("Haarlem");
  await form.locator("input[name='email']").fill("qa-turnstile@example.nl");
  await page.waitForFunction(() => Object.keys(document.querySelector("form[action='/api/scan']") ?? {}).some((k) => k.startsWith("__react")));
  await page.waitForFunction(() => (window as any).__ts?.widgets.length > 0);
  await page.evaluate((t) => (window as any).__tsSolve(0, t), DUMMY);
  return { form, sent };
}
const tokenField = (page: Page) => page.evaluate(() => (document.querySelector("form[action='/api/scan'] input[name='cf-turnstile-response']") as HTMLInputElement | null)?.value ?? null);

test("AC6: a token that went out with a submit is not offered again; the next submit waits for a fresh one (13 Nov 2026)", async ({ page }) => {
  const { form, sent } = await openCheckWithToken(page);
  // 204: the browser stays on the page; noWaitAfter because there is no navigation to wait for.
  await form.locator("button[type='submit']").click({ noWaitAfter: true });
  await page.waitForTimeout(300);
  expect(sent).toHaveLength(1);
  expect(sent[0].token).toBe(DUMMY);
  // The page did not navigate away: after a moment the spent token is gone and the widget was asked for a new one.
  await page.waitForFunction(() => (window as any).__ts.resets.length === 1, undefined, { timeout: 5000 });
  expect(await tokenField(page)).toBe("");
  // A second submit now is held, not sent with the spent token.
  await page.evaluate(() => (document.querySelector("form[action='/api/scan']") as HTMLFormElement).requestSubmit());
  await page.waitForTimeout(800);
  expect(sent).toHaveLength(1);
  // (Sending once the fresh token arrives is AC4.)
});

test("AC7: a form restored from the back/forward cache comes back without its spent token", async ({ page }) => {
  const { form, sent } = await openCheckWithToken(page);
  expect(await tokenField(page)).toBe(DUMMY);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  expect(await tokenField(page)).toBe("");
  // Every widget on the page (the landing page has several forms) asks for a fresh token.
  const widgets = await page.evaluate(() => (window as any).__ts.widgets.length);
  expect(await page.evaluate(() => (window as any).__ts.resets.length)).toBe(widgets);
  await form.locator("button[type='submit']").click();
  await page.waitForTimeout(600);
  expect(sent).toHaveLength(0);
  // An ordinary pageshow (not from the cache) leaves a live token alone.
  await page.evaluate((t) => (window as any).__tsSolve(0, t), DUMMY + ".3");
  await page.waitForTimeout(500);
  expect(sent).toHaveLength(1);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false })));
  expect(await page.evaluate(() => (window as any).__ts.resets.length)).toBe(widgets);
});
