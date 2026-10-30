// Render the social banners (cover images) for every language in profiles.json.
//
// Reads:  profiles.json (banner.*), fonts/PlusJakartaSans-latin.woff2 (the site's font)
// Writes: banner/<lang>/<platform>.png
//
// Rendered by the repo's Playwright Chromium, so the type is the site's own Plus Jakarta Sans.
// Each platform puts the avatar over the bottom left on desktop and crops the sides on mobile,
// so everything sits in a centred column.
//
// Run: node docs/brand/social/banners.mjs
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, "../../..");
const { chromium } = createRequire(join(ROOT, "package.json"))("@playwright/test");
const { link, banner } = JSON.parse(readFileSync(join(DIR, "profiles.json"), "utf8"));
const font = readFileSync(join(DIR, "fonts/PlusJakartaSans-latin.woff2")).toString("base64");

// w × h × scale is the size the platform recommends. safe: the part that shows everywhere, as
// fractions [left, right, top, bottom]; the render fails when anything lands outside it.
// - LinkedIn company: 4200×700 (6:1); the logo overlaps the bottom left, mobile crops the sides.
// - LinkedIn personal (founder): 1584×396 (4:1); the profile photo covers the left third.
// - Facebook page: 1640×624; mobile shows only the centre, desktop crops top and bottom a little.
// card: show the question-and-answer card next to the tagline (needs the height).
const SIZES = {
  "linkedin-company": { w: 2100, h: 350, scale: 2, type: 54, card: false, safe: [0.2, 0.8, 0.1, 0.9] },
  "linkedin-personal": { w: 1584, h: 396, scale: 2, type: 32, card: true, safe: [0.34, 0.96, 0.12, 0.88] },
  facebook: { w: 1640, h: 624, scale: 1, type: 36, card: true, safe: [0.17, 0.83, 0.12, 0.88] },
};

const page = (s, t) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:J;src:url(data:font/woff2;base64,${font}) format("woff2");font-weight:200 800}
*{margin:0;box-sizing:border-box}
html,body{width:${s.w}px;height:${s.h}px}
body{font-family:J,sans-serif;color:#111827;background:#FBF6EE;display:flex;align-items:center;justify-content:center;gap:${s.type * 1.4}px;overflow:hidden;padding:${s.h * s.safe[2]}px ${s.w * (1 - s.safe[1])}px ${s.h * (1 - s.safe[3])}px ${s.w * s.safe[0]}px}
.mark{display:inline-block;width:${s.type * 0.75}px;height:${s.type * 0.75}px;background:#2563eb;border-radius:999px 999px 999px ${s.type * 0.075}px;margin-bottom:${s.type * 0.5}px}
h1{font-size:${s.type}px;font-weight:800;letter-spacing:-0.02em;line-height:1.12}
h1 span{display:block;white-space:nowrap}
h1 .b{color:#2563eb}
.card{background:#fff;border:1.5px solid #E7E3DC;border-radius:${s.type * 0.45}px;padding:${s.type * 0.5}px;display:grid;gap:${s.type * 0.3}px;width:${s.type * 10.5}px;flex:none;box-shadow:0 ${s.type * 0.2}px ${s.type * 0.8}px rgba(17,24,39,.06)}
.q{font-size:${s.type * 0.36}px;font-weight:600;background:#F4F1EC;border-radius:${s.type * 0.3}px;padding:${s.type * 0.25}px ${s.type * 0.32}px}
.a{display:flex;align-items:center;gap:${s.type * 0.2}px;font-size:${s.type * 0.36}px;font-weight:600;padding:0 ${s.type * 0.1}px}
.dot{width:${s.type * 0.22}px;height:${s.type * 0.22}px;border-radius:50%;background:#2B7A53;flex:none}
.pill{margin-left:auto;font-size:${s.type * 0.28}px;font-weight:700;color:#2B7A53;background:#EDF7F1;border-radius:999px;padding:${s.type * 0.06}px ${s.type * 0.22}px}
</style></head><body>
<div><div class="mark"></div><h1><span>${t.line1}</span><span class="b">${t.line2}</span></h1></div>
${s.card ? `<div class="card"><div class="q">${t.question}</div><div class="a"><span class="dot"></span>${t.answer}<span class="pill">${t.verdict}</span></div></div>` : ""}
</body></html>`;

let failed = false;
const browser = await chromium.launch();
for (const lang of Object.keys(link)) {
  const t = Object.fromEntries(Object.entries(banner).map(([k, v]) => [k, v[lang]]));
  mkdirSync(join(DIR, "banner", lang), { recursive: true });
  for (const [name, s] of Object.entries(SIZES)) {
    const p = await browser.newPage({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: s.scale });
    await p.setContent(page(s, t));
    await p.evaluate(() => document.fonts.ready);
    const fits = await p.evaluate(([l, r, t, b]) => [...document.body.querySelectorAll("*")].every((el) => {
      const x = el.getBoundingClientRect();
      return x.left >= l * innerWidth - 1 && x.right <= r * innerWidth + 1 && x.top >= t * innerHeight - 1 && x.bottom <= b * innerHeight + 1;
    }), s.safe);
    if (!fits) failed = true;
    if (!fits) console.error(`FAIL ${lang} ${name}: content outside the safe zone`);
    await p.screenshot({ path: join(DIR, "banner", lang, `${name}.png`) });
    console.log(`${fits ? "ok  " : "FAIL"} banner/${lang}/${name}.png ${s.w * s.scale}x${s.h * s.scale}`);
    await p.close();
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
