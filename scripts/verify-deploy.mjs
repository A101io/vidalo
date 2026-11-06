/**
 * After a deploy: fetch the live site and check the things that must be true.
 * Prints what it saw for every check, so a red run says why (Sitty's first
 * diagnosis of a failing check was wrong because it only said "failed").
 *
 *   node scripts/verify-deploy.mjs https://vidalo-web-preview.julian-devriend.workers.dev
 *   node scripts/verify-deploy.mjs --redirects https://vidalo.ai www.vidalo.ai vidalo.io www.vidalo.io
 *
 * --redirects: every host given must answer 301 with Location on the target,
 * same path and query.
 */
if (process.argv[2] === "--redirects") {
  const target = (process.argv[3] ?? "").replace(/\/$/, "");
  const hosts = process.argv.slice(4);
  if (!/^https:\/\//.test(target) || hosts.length === 0) {
    console.error("usage: verify-deploy.mjs --redirects https://target host [host...]");
    process.exit(2);
  }
  const probe = "/prijzen?check=1";
  let bad = 0;
  for (const host of hosts) {
    let status = 0;
    let location = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(`https://${host}${probe}`, { redirect: "manual", headers: { "user-agent": "vidalo-deploy-verify" } });
        status = res.status;
        location = res.headers.get("location") ?? "";
        if (status === 301 && location === target + probe) break;
      } catch (err) {
        location = String(err);
      }
      await new Promise((r) => setTimeout(r, attempt * 3000));
    }
    const ok = status === 301 && location === target + probe;
    if (!ok) bad++;
    console.log(`${ok ? "✓" : "✗"} ${host.padEnd(18)} ${String(status).padEnd(4)} → ${location || "(no Location)"}`);
  }
  if (bad) {
    console.error(`\n${bad} host(s) do not redirect to ${target}`);
    process.exit(1);
  }
  console.log(`\nAll ${hosts.length} hosts redirect to ${target}`);
  process.exit(0);
}

const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!/^https?:\/\//.test(base)) {
  console.error("usage: verify-deploy.mjs https://host");
  process.exit(2);
}

const checks = [
  { path: "/api/health", want: (s, t) => s === 200 && /"ok":true/.test(t), what: "health 200 ok" },
  // With the launch gate on (VIDALO_COMING_SOON=1) the root is the coming-soon page; either is a pass, and the log says which.
  { path: "/", want: (s, t) => s === 200 && /<html lang="nl"/.test(t) && (/data-ask/.test(t) || /data-coming-soon/.test(t)), what: "Dutch landing with the simulator, or the coming-soon page" },
  { path: "/en", want: (s, t) => s === 200 && /<html lang="en"/.test(t), what: "English landing" },
  { path: "/en/pricing", want: (s, t) => s === 200 && /<html lang="en"/.test(t), what: "English pricing" },
  // The gate must never hide these (core/shared/gate.ts, LEGAL-NL §6).
  { path: "/privacy", want: (s, t) => s === 200 && /<html lang="nl"/.test(t), what: "privacy page reachable" },
  { path: "/cookies", want: (s, t) => s === 200 && /vidalo_consent/.test(t), what: "cookie statement with the inventory" },
  { path: "/llms.txt", want: (s, t) => s === 200 && t.startsWith("# Vidalo"), what: "llms.txt" },
  { path: "/sitemap.xml", want: (s, t) => s === 200 && /hreflang/.test(t), what: "sitemap with hreflang" },
  { path: "/deze-pagina-bestaat-niet", want: (s) => s === 404, what: "unknown page 404" },
];

let failed = 0;
for (const c of checks) {
  let status = 0;
  let text = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(base + c.path, { redirect: "manual", headers: { "user-agent": "vidalo-deploy-verify" } });
      status = res.status;
      text = await res.text();
      if (c.want(status, text)) break;
    } catch (err) {
      text = String(err);
    }
    await new Promise((r) => setTimeout(r, attempt * 3000));
  }
  const ok = c.want(status, text);
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${c.path.padEnd(28)} ${String(status).padEnd(4)} ${String(text.length).padStart(7)} bytes  ${c.what}${ok ? "" : `  | saw: ${text.slice(0, 160).replace(/\s+/g, " ")}`}`);
}
if (failed) {
  console.error(`\n${failed} check(s) failed on ${base}`);
  process.exit(1);
}
console.log(`\nAll checks passed on ${base}`);
