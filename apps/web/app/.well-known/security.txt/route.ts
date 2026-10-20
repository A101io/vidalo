/** RFC 9116 security contact (baseline H10). Expires one year after the build. */
export const dynamic = "force-static";

export function GET() {
  const base = (process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const expires = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
  const body = [
    "Contact: mailto:support@vidalo.io",
    `Expires: ${expires}`,
    "Preferred-Languages: nl, en",
    `Canonical: ${base}/.well-known/security.txt`,
    `Policy: ${base}/privacy`,
    "",
  ].join("\n");
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
