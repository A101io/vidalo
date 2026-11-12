/**
 * Turns the running web app (mock mode) into a static, clickable copy for
 * GitHub Pages. Pages only serves files, and the app is a Next.js server, so
 * this crawls it page by page instead of exporting it.
 *
 *   VIDALO_MOCK=1 PUBLIC_BASE_URL=http://localhost:3000 pnpm --filter @vidalo/web start &
 *   node scripts/site/snapshot.mjs http://localhost:3000 out/site
 *
 * What the copy does and does not do:
 * - Every page is saved flat (`/vak/horeca` → `vak-horeca.html`) and every
 *   internal link is rewritten to its file, so it works under any base path
 *   (`https://<org>.github.io/vidalo/`).
 * - The app's JavaScript is stripped: nothing hydrates, nothing is saved.
 *   The scripts kept are public/motion.js (scroll motion) and public/ask.js
 *   (the "Vraag het zelf" simulator); like motion.js, they work
 *   on plain HTML and hides nothing if it fails.
 *   Forms are pointed at the page a visitor would land on (the scan form at
 *   the example report, checkout at the welcome page).
 * - The dashboard is captured as the demo owner, once before and once after
 *   proving ownership through the mock Google flow.
 * - The landing page is the site root (`index.html`), exactly as the app
 *   renders it. A list of every page lives at `pages.html`.
 * - Every page carries noindex, so the preview stays out of search results.
 *
 * Exits non-zero when a saved page links to a file that was not saved, so a
 * broken copy never deploys.
 */
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Plain scripts that work without React and stay in the static copy. */
const KEPT_SCRIPTS = ["motion.js", "ask.js"];

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const out = path.resolve(process.argv[3] ?? "out/site");

const DEMO_EMAIL = "eigenaar@bakkerijdevries.nl";
/** Filled by signIn(): since feature 002 a mock session needs its own sign-in row, so it cannot be written by hand. */
const cookies = new Map();
const cookieHeader = () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");

const SKIP = ["/api/", "/auth/", "/_next/"];
/** Links into routes that are not pages, sent to the page they lead to. */
const ROUTE_TO_PAGE = { "/api/google/start": "/app/google" };
/** Form actions, sent to the page a visitor would end up on. */
const FORM_TO_PAGE = {
  "/api/scan": "/r/voorbeeld",
  "/api/checkout": "/welkom",
  "/api/report-email": "/r/voorbeeld",
  "/api/billing/portal": "/app",
  "/api/domain/verify": "/app/domein",
};
const START = [
  "/", "/r/voorbeeld", "/r/voorbeeld-grijs", "/privacy", "/voorwaarden", "/scan/druk", "/inloggen", "/welkom",
  "/eigenaar?fout=no_match", "/eigenaar?fout=no_locations", "/eigenaar?fout=no_place_id",
  "/app", "/app/gegevens", "/app/domein", "/app/google",
];

function fileFor(href) {
  const u = new URL(href, base);
  const route = ROUTE_TO_PAGE[u.pathname] ?? u.pathname;
  if (route === "/") return "index.html";
  let name = route.replace(/^\/+|\/+$/g, "").replaceAll("/", "-");
  if (route === "/eigenaar" && u.searchParams.get("fout")) name += `-${u.searchParams.get("fout")}`;
  return `${name.replace(/[^a-zA-Z0-9_.-]/g, "-")}.html`;
}

function remember(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    const k = pair.slice(0, i).trim();
    const v = pair.slice(i + 1).trim();
    if (/max-age=0|expires=thu, 01 jan 1970/i.test(c) || v === "") cookies.delete(k);
    else cookies.set(k, v);
  }
}

/** GET with the session cookie, following redirects by hand so cookies set on the way are kept. */
async function get(pathname) {
  let url = new URL(pathname, base);
  for (let hop = 0; hop < 10; hop++) {
    const res = await fetch(url, { headers: { cookie: cookieHeader() }, redirect: "manual" });
    remember(res);
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      url = new URL(loc, url);
      continue;
    }
    return { status: res.status, final: url.pathname + url.search, html: await res.text() };
  }
  throw new Error(`too many redirects from ${pathname}`);
}

/**
 * Signs in as the demo owner through the mock sign-in form on /inloggen (a server action), as a
 * visitor would, and keeps the session cookie it sets.
 */
async function signIn() {
  const html = (await get("/inloggen")).html;
  const action = /name="(\$ACTION_ID_[^"]+)"/.exec(html)?.[1];
  if (!action) throw new Error("no sign-in form on /inloggen");
  const form = new FormData();
  for (const [k, v] of Object.entries({ [action]: "", email: DEMO_EMAIL, next: "/app", business: "", session_id: "" })) form.append(k, v);
  const res = await fetch(new URL("/inloggen", base), { method: "POST", body: form, headers: { origin: new URL(base).origin, cookie: cookieHeader() }, redirect: "manual" });
  remember(res);
  if (!cookies.has("vidalo_mock_session")) throw new Error(`mock sign-in set no session (status ${res.status})`);
}

const pages = new Map(); // file → html

async function crawl(start) {
  const queue = [...start];
  while (queue.length) {
    const href = queue.shift();
    const file = fileFor(href);
    if (pages.has(file)) continue;
    const { status, html } = await get(href);
    if (status !== 200) {
      console.log(`skip ${href} (${status})`);
      continue;
    }
    pages.set(file, html);
    for (const [, link] of html.matchAll(/href="(\/[^"#]*)/g)) {
      const p = link.split("?")[0];
      if (/\.[a-z0-9]+$/i.test(p)) continue; // files, not pages
      if (SKIP.some((s) => link.startsWith(s)) && !(p in ROUTE_TO_PAGE)) continue;
      if (!pages.has(fileFor(link))) queue.push(link);
    }
  }
}

function rewrite(html) {
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, (tag) => {
    const kept = KEPT_SCRIPTS.find((f) => tag.includes(`src="/${f}"`));
    return kept ? tag.replace(`src="/${kept}"`, `src="${kept}"`) : "";
  });
  html = html.replace(/<link\b[^>]*\bas="script"[^>]*\/?>/g, "");
  html = html.replaceAll('"/_next/static/', '"assets/');
  html = html.replace(/href="(\/[^"]*)"/g, (_, url) => {
    const [p, frag] = url.split("#");
    if (p === "/icon.svg") return 'href="icon.svg"';
    const routeOnly = (p || "/").split("?")[0];
    const isPage = !SKIP.some((s) => routeOnly.startsWith(s)) || routeOnly in ROUTE_TO_PAGE;
    const file = isPage ? fileFor(p || "/") : null;
    const target = file && pages.has(file) ? file : "pages.html";
    return `href="${target}${frag ? `#${frag}` : ""}"`;
  });
  html = html.replace(/<form\b[^>]*>/g, (tag) => {
    const action = tag.match(/action="([^"]*)"/)?.[1] ?? "";
    const dest = FORM_TO_PAGE[action] ? fileFor(FORM_TO_PAGE[action]) : "pages.html";
    return tag.replace(/\s(action|method)="[^"]*"/g, "").replace(/>$/, ` action="${dest}" method="get">`);
  });
  html = html.replace(/<head>/, '<head><meta name="robots" content="noindex, nofollow"/>');
  return html;
}

async function main() {
  await rm(out, { recursive: true, force: true });
  await mkdir(path.join(out, "assets"), { recursive: true });
  await signIn();

  // 1. The Google step as an unproven owner sees it, then prove ownership (mock Google).
  const before = await get("/app/google?eerst=1");
  if (before.status !== 200 || !before.final.startsWith("/app/google")) throw new Error(`demo owner not signed in: ${before.final}`);
  pages.set("app-google-eerst.html", before.html);
  const proof = await get("/api/google/start");
  if (!proof.final.startsWith("/app/google")) throw new Error(`mock Google proof failed: ended at ${proof.final}`);

  // 2. Everything reachable from the start pages, now as the proven owner.
  await crawl(START);

  // 3. Write pages, styles, fonts and the icon.
  for (const [file, html] of pages) await writeFile(path.join(out, file), rewrite(html));
  const nextStatic = path.join(repo, "apps/web/.next/static");
  for (const dir of ["css", "media"]) {
    await mkdir(path.join(out, "assets", dir), { recursive: true });
    for (const f of await readdir(path.join(nextStatic, dir))) {
      const src = path.join(nextStatic, dir, f);
      const dst = path.join(out, "assets", dir, f);
      if (dir === "css") await writeFile(dst, (await readFile(src, "utf8")).replaceAll("url(/_next/static/media/", "url(../media/"));
      else await copyFile(src, dst);
    }
  }
  await copyFile(path.join(repo, "apps/web/app/icon.svg"), path.join(out, "icon.svg"));
  for (const f of KEPT_SCRIPTS) await copyFile(path.join(repo, "apps/web/public", f), path.join(out, f));
  await writeFile(path.join(out, ".nojekyll"), "");
  await writeFile(path.join(out, "robots.txt"), "User-agent: *\nDisallow: /\n");

  // 4. The list of every page, and a 404 that is the app's own.
  const title = (html) => html.match(/<title>([^<:·]*)/)?.[1]?.trim() ?? "";
  const sectors = [...pages.keys()].filter((f) => f.startsWith("vak-")).sort();
  const scanReport = [...pages.keys()].find((f) => /^r-[0-9a-f]{8}-/.test(f));
  let commit = process.env.GITHUB_SHA?.slice(0, 7);
  try {
    commit ??= execSync("git rev-parse --short HEAD", { cwd: repo }).toString().trim();
  } catch {
    commit ??= "local";
  }
  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Amsterdam" });
  const index = (await readFile(path.join(here, "index.template.html"), "utf8"))
    .replace("{{COMMIT}}", commit)
    .replace("{{DATE}}", date)
    .replace("{{SCAN_REPORT}}", scanReport ?? "r-voorbeeld.html")
    .replace("{{SECTORS}}", sectors.map((f) => `      <a href="${f}">${title(pages.get(f))}</a>`).join("\n"));
  await writeFile(path.join(out, "pages.html"), index);
  const missing = await get("/deze-pagina-bestaat-niet");
  await writeFile(path.join(out, "404.html"), rewrite(missing.html).replaceAll('href="', 'href="/vidalo/').replaceAll('href="/vidalo/http', 'href="http').replaceAll('href="/vidalo/#', 'href="#'));

  // 5. No link may point at a file that is not there.
  const files = new Set(await readdir(out));
  const broken = [];
  // 404.html is served at any path, so its links are absolute (/vidalo/…) and checked by name instead.
  for (const f of [...files].filter((x) => x.endsWith(".html") && x !== "404.html")) {
    const html = await readFile(path.join(out, f), "utf8");
    for (const [, href] of html.matchAll(/(?:href|action)="([^"#?:]+\.html)/g)) if (!files.has(href)) broken.push(`${f} → ${href}`);
  }
  if (broken.length) {
    console.error(`broken links:\n  ${broken.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`${pages.size} pages + pages.html + 404.html written to ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
