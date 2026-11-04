import { describe, expect, it } from "vitest";
import { MAX_REDIRECTS, fetchPublic, isFetchableUrl } from "../src/scanner/util";

const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });

describe("outbound fetch guard", () => {
  it("allows http(s) on public names only", () => {
    expect(isFetchableUrl("https://www.bakkerijjansen.nl/contact")).toBe(true);
    expect(isFetchableUrl("http://bakkerijjansen.nl/")).toBe(true);
    for (const bad of [
      "http://169.254.169.254/latest/meta-data/",
      "https://127.0.0.1/",
      "https://[::1]/",
      "http://10.0.0.5/",
      "https://localhost/",
      "https://printer.local/",
      "https://db.internal/",
      "https://user:pw@bakkerijjansen.nl/",
      "file:///etc/passwd",
      "ftp://bakkerijjansen.nl/",
      "not a url",
    ]) {
      expect(isFetchableUrl(bad), bad).toBe(false);
    }
  });

  it("refuses before the first request", async () => {
    const seen: string[] = [];
    await expect(fetchPublic("http://169.254.169.254/", {}, async (u) => (seen.push(u), new Response("x")))).rejects.toThrow(/refused/);
    expect(seen).toEqual([]);
  });

  it("re-checks every redirect hop and stops at an inward one", async () => {
    const seen: string[] = [];
    const hops: Record<string, Response> = { "https://a.nl/": redirect("https://b.nl/x"), "https://b.nl/x": redirect("http://127.0.0.1/admin") };
    await expect(fetchPublic("https://a.nl/", {}, async (u) => (seen.push(u), hops[u]!))).rejects.toThrow(/refused/);
    expect(seen).toEqual(["https://a.nl/", "https://b.nl/x"]);
  });

  it("follows relative redirects on a public host and returns the final response", async () => {
    const res = await fetchPublic("https://a.nl/", {}, async (u) => (u === "https://a.nl/" ? redirect("/nl/") : new Response("ok")));
    expect(await res.text()).toBe("ok");
  });

  it("gives up after the hop limit", async () => {
    let n = 0;
    await expect(fetchPublic("https://a.nl/0", {}, async () => redirect(`https://a.nl/${++n}`))).rejects.toThrow(/too many redirects/);
    expect(n).toBe(MAX_REDIRECTS + 1);
  });
});
