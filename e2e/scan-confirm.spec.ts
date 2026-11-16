import { expect, test, type APIRequestContext } from "@playwright/test";
import { mockSite } from "./helpers";

/**
 * Feature 004 (docs/features/004-scan-confirm): guarantees of the confirmation link
 * that the page-level test in free-check.spec.ts cannot see. Mock engines, so
 * /scan/mail?link= carries the token the mail would carry.
 */
async function requestLink(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.post("/api/scan", { form: { q: name, place: "Haarlem", identity: mockSite(name), email: "e2e@example.nl" }, maxRedirects: 0 });
  const mail = new URL(res.headers()["location"]!);
  expect(mail.pathname).toBe("/scan/mail");
  return mail.searchParams.get("link")!;
}

async function press(request: APIRequestContext, t: string): Promise<string> {
  // The confirm route takes posts from this site only (refuseCrossSite), as the button on our page sends them.
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const res = await request.post("/api/scan/bevestigen", { form: { t }, headers: { origin }, maxRedirects: 0 });
  return new URL(res.headers()["location"]!).pathname;
}

const waitingRoom = /^\/scan\/(?!bevestigen$|mail$|druk$|kies$)[^/]+$/;

test("opening the link starts nothing; only the button does (AC-2)", async ({ request }) => {
  test.setTimeout(60_000);
  const name = `Visser E2E ${Date.now()}`;
  const first = await requestLink(request, name);
  for (let i = 0; i < 3; i++) expect((await request.get(`/scan/bevestigen?t=${encodeURIComponent(first)}`)).status()).toBe(200);
  // A mock check finishes in seconds. Had opening the link started one, a new request for the
  // same business would now be handed that report (/r/...) instead of a new waiting room.
  await new Promise((r) => setTimeout(r, 8_000));
  const second = await requestLink(request, name);
  expect(await press(request, second)).toMatch(waitingRoom);
});

