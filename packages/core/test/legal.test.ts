/**
 * The legal texts (/voorwaarden, /privacy, /cookies and their /en pages) checked against
 * the code, so a change in what Vidalo does cannot ship while the texts still describe the
 * old behaviour. The legal agent (`~/.claude/agents/legal.md`, `/legal-check`) runs this
 * first; what it cannot decide (is a new vendor a processor, is a wording still state of the
 * art) is the agent's review, not this file.
 *
 *   1. Version: any wording change in `copy.legal` (NL or EN) needs a new `updated` date in
 *      both languages, recorded in `src/copy/legal.lock.json` by `pnpm --filter @vidalo/core legal:lock`.
 *   2. Cookies: every cookie the code sets is in the cookie table (NL and EN), every row in
 *      the table is still set by the code, and nothing writes browser storage.
 *   3. Recipients: every outside host the code talks to and every vendor SDK maps to a
 *      vendor that is in docs/processors.md and named in the privacy statement (NL and EN),
 *      or is on NOT_RECIPIENTS with the reason it receives no personal data.
 *   4. Identity: KvK and btw number the same in the legal texts and the footer.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { copy } from "../src/copy/index";
import { en } from "../src/copy/en";
import { DIRECTORIES } from "../src/publisher/channels/directories";

const ROOT = join(__dirname, "../../..");
const LOCK = join(__dirname, "../src/copy/legal.lock.json");
const SOURCE_DIRS = ["packages/core/src", "apps/web/app", "apps/web/lib", "apps/web/components", "apps/web/public", "apps/web/middleware.ts", "apps/web/worker.ts", "apps/worker/src"];

function files(path: string): string[] {
  const abs = join(ROOT, path);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [abs];
  return readdirSync(abs).flatMap((name) => (name === "node_modules" || name.startsWith(".") ? [] : files(join(path, name))));
}
const source = SOURCE_DIRS.flatMap(files)
  .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f))
  .map((f) => ({ file: relative(ROOT, f), text: readFileSync(f, "utf8") }));

const text = (v: unknown) => JSON.stringify(v);
const hash = (legal: object) => createHash("sha256").update(text({ ...legal, updated: undefined })).digest("hex").slice(0, 16);

describe("legal texts: version", () => {
  const months = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
  const monthsEn = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const dateOf = (s: string, names: string[]) => {
    const m = s.match(/(\d{1,2}) (\p{L}+) (\d{4})/u);
    return m ? `${m[3]}-${String(names.indexOf(m[2]) + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
  };

  it("NL and EN carry the same version date and are not drafts", () => {
    const nl = dateOf(copy.legal.updated, months);
    expect(nl, copy.legal.updated).toMatch(/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/);
    expect(dateOf(en.legal.updated, monthsEn)).toBe(nl);
    expect(copy.legal.draft).toBe(false);
    expect(en.legal.draft).toBe(false);
  });

  it("a wording change comes with a new version (legal.lock.json)", () => {
    const now = { nl: { updated: copy.legal.updated, hash: hash(copy.legal) }, en: { updated: en.legal.updated, hash: hash(en.legal) } };
    const lock = JSON.parse(readFileSync(LOCK, "utf8")) as typeof now;
    for (const lang of ["nl", "en"] as const) {
      if (now[lang].hash === lock[lang].hash) continue;
      expect(now[lang].updated, `${lang}: the legal text changed but \`updated\` did not; set a new version date in index.ts and en.ts`).not.toBe(lock[lang].updated);
    }
    if (process.env.UPDATE_LEGAL_LOCK) writeFileSync(LOCK, `${JSON.stringify(now, null, 2)}\n`);
    else expect(now, "new version: run `pnpm --filter @vidalo/core legal:lock` and commit legal.lock.json").toEqual(lock);
  });
});

describe("legal texts: cookies", () => {
  /** Cookies the code sets that a visitor of vidalo.io never gets, with the reason. */
  const NOT_ON_SITE: Record<string, string> = {
    vidalo_mock_session: "mock mode only (lib/session.ts); production runs with Supabase sign-in",
  };
  /** Set by @supabase/ssr, not by a constant in our code; prefix `sb-<ref>-`. */
  const SUPABASE = ["sb-…-auth-token", "sb-…-auth-token-code-verifier"];
  /** Set by a third-party script the code loads (components/Trackers.tsx, after consent): script host → its cookies. */
  const SCRIPT_COOKIES: Record<string, string[]> = {
    "www.googletagmanager.com": ["_ga", "_ga_…"],
    "connect.facebook.net": ["_fbp"],
  };

  const inCode = [...new Set(source.flatMap(({ text }) => [...text.matchAll(/export const \w*COOKIE\w* = "([\w-]+)"/g)].map((m) => m[1])))];
  const supabaseInUse = readFileSync(join(ROOT, "apps/web/package.json"), "utf8").includes('"@supabase/ssr"');
  const scripts = Object.entries(SCRIPT_COOKIES).filter(([host]) => source.some(({ text }) => text.includes(`https://${host}/`)));
  const expected = [...inCode.filter((n) => !NOT_ON_SITE[n]), ...(supabaseInUse ? SUPABASE : []), ...scripts.flatMap(([, names]) => names)].sort();

  const tableNames = (legal: typeof copy.legal) => {
    const rows = legal.cookies.sections.flatMap((s) => ("table" in s && s.table ? s.table.rows : []));
    return rows.map((r) => r[0]).sort();
  };

  it("finds the cookie constants (control: the scan is not empty)", () => {
    expect(inCode).toContain("vidalo_consent");
  });

  it("the cookie table names exactly the cookies the code sets (NL)", () => {
    expect(tableNames(copy.legal)).toEqual(expected);
  });

  it("the cookie table names exactly the cookies the code sets (EN)", () => {
    expect(tableNames(en.legal as typeof copy.legal)).toEqual(expected);
  });

  it("nothing writes browser storage (the statement says we use none)", () => {
    const hits = source.filter(({ text }) => /\b(localStorage|sessionStorage|indexedDB)\b/.test(text)).map((s) => s.file);
    expect(hits).toEqual([]);
  });
});

describe("legal texts: recipients", () => {
  const processors = readFileSync(join(ROOT, "docs/processors.md"), "utf8");
  /** Vendor as it is written in docs/processors.md, the NL and the EN privacy statement. */
  type Vendor = { processors: string; nl: string; en: string };
  const v = (name: string): Vendor => ({ processors: name, nl: name, en: name });
  const SOURCES: Vendor = { processors: "Sources with an error", nl: "Bronnen met een fout", en: "Sources containing an error" };

  /** Host suffix → who receives data there. */
  const HOSTS: Record<string, Vendor> = {
    "googleapis.com": v("Google"),
    "accounts.google.com": v("Google"),
    "api.resend.com": v("Resend"),
    "verify.twilio.com": v("Twilio"),
    "serpapi.com": v("SerpAPI"),
    "api.perplexity.ai": v("Perplexity"),
    "api.kvk.nl": v("KvK"),
    "challenges.cloudflare.com": v("Cloudflare"),
    "api.cloudflare.com": v("Cloudflare"),
    // The worker asks Stripe whether a subscription still bills before a purge (feature 002, F-021).
    "api.stripe.com": v("Stripe"),
    "wa.me": v("WhatsApp"),
    "googletagmanager.com": v("Google Analytics"),
    "connect.facebook.net": { processors: "Meta (pixel)", nl: "Meta (Facebook, Instagram)", en: "Meta (Facebook, Instagram)" },
  };
  for (const d of DIRECTORIES) HOSTS[d.domain] = SOURCES;

  /** Hosts in the code that receive no personal data from us, with the reason. Re-read on every legal review. */
  const NOT_RECIPIENTS: Record<string, string> = {
    "schema.org": "vocabulary URL inside JSON-LD, never fetched",
    "www.sitemaps.org": "XML namespace in the sitemap, never fetched",
    "vidalo.io": "our own domain",
    "vidalo.ai": "our own domain",
    "www.google.com": "Maps links on the facts page; the visitor follows them, we send nothing",
    "api.indexnow.org": "receives only public facts-page URLs to recrawl (publisher/indexnow.ts)",
    "developers.cloudflare.com": "documentation link in a comment",
    "platform.openai.com": "documentation link in a comment",
    "bakkerijdevries.nl": "fictional demo business",
    "jouwbedrijf.nl": "example domain in copy",
    "yourbusiness.com": "example domain in copy",
    "haarlemsdagblad.nl": "source row in the demo report",
    "foursquare.com": "listed source in the directory table, no adapter writes to it",
  };

  /** Vendor SDKs in package.json → vendor. */
  const SDKS: Record<string, Vendor> = {
    openai: v("OpenAI"),
    "@anthropic-ai/sdk": v("Anthropic"),
    "@google/generative-ai": v("Google"),
    "@google/genai": v("Google"),
    stripe: v("Stripe"),
    "@supabase/supabase-js": v("Supabase"),
    "@supabase/ssr": v("Supabase"),
    resend: v("Resend"),
    twilio: v("Twilio"),
  };

  const hosts = [...new Set(source.flatMap(({ text }) => [...text.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/g)].map((m) => m[1].toLowerCase())))];
  const match = <T>(map: Record<string, T>, host: string) => Object.entries(map).find(([k]) => host === k || host.endsWith(`.${k}`))?.[1];
  const deps = ["packages/core", "apps/web", "apps/worker"].flatMap((p) => {
    const pkg = JSON.parse(readFileSync(join(ROOT, p, "package.json"), "utf8"));
    return Object.keys({ ...pkg.dependencies });
  });

  it("finds outside hosts (control: the scan is not empty)", () => {
    expect(hosts).toContain("api.resend.com");
  });

  it("every outside host is a known recipient or a known non-recipient", () => {
    const unknown = hosts.filter((h) => !match(HOSTS, h) && !match(NOT_RECIPIENTS, h) && h !== "localhost");
    expect(unknown, "new outside host: add it to HOSTS (and processors.md + privacy) or to NOT_RECIPIENTS with the reason").toEqual([]);
  });

  const vendors = new Map<string, Vendor>();
  for (const h of hosts) { const x = match(HOSTS, h); if (x) vendors.set(x.processors, x); }
  for (const d of deps) { const x = SDKS[d]; if (x) vendors.set(x.processors, x); }
  vendors.set("Cloudflare", v("Cloudflare")); // hosting: wrangler.jsonc, not a host in the code

  for (const vendor of vendors.values()) {
    it(`${vendor.processors} is in processors.md and in the privacy statement (NL and EN)`, () => {
      expect(processors.includes(`| ${vendor.processors}`), `docs/processors.md has no row for ${vendor.processors}`).toBe(true);
      expect(text(copy.legal.privacy).includes(vendor.nl), `NL privacy does not name ${vendor.nl}`).toBe(true);
      expect(text(en.legal.privacy).includes(vendor.en), `EN privacy does not name ${vendor.en}`).toBe(true);
    });
  }
});

describe("legal texts: identity", () => {
  it("KvK and btw number match across the legal texts and the footer", () => {
    const kvk = copy.legal.contact.match(/KvK (\d{8})/)?.[1];
    const vat = copy.legal.contact.match(/NL\d{9}B\d{2}/)?.[0];
    expect(kvk).toBeTruthy();
    expect(vat).toBeTruthy();
    for (const s of [en.legal.contact, text(copy.legal.terms), text(en.legal.terms)]) expect(s).toContain(kvk);
    expect(en.legal.contact).toContain(vat);
    expect(text(copy)).toContain(`KvK ${kvk}`);
  });
});
