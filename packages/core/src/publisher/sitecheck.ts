/**
 * Own-website check: can the assistants Vidalo checks read the owner's site,
 * and does the homepage carry the business data in a form they read directly?
 *
 *   robots.txt  — is the search robot of an engine we check shut out of "/"?
 *                 (RFC 9309: most specific group, longest match, allow wins a tie)
 *   homepage    — "noindex" in a robots meta tag or X-Robots-Tag header;
 *                 JSON-LD with a LocalBusiness (or an Organization with an
 *                 address); its telephone against the confirmed facts.
 *
 * Only robots that answer questions are checked, not training crawlers: a
 * blocked GPTBot does not stop ChatGPT search, a blocked OAI-SearchBot does.
 * Nothing here changes the site; the owner gets the exact change to make
 * (sitecheckEmail). In VIDALO_MOCK=1 without an injected fetch no request is
 * made and the site reads as clean.
 */
import type { Engine, Facts } from "../types.js";
import type { BusinessRecord } from "../db/types.js";
import { getDb, isMock } from "../shared/db.js";
import { log, errorMessage } from "../shared/log.js";
import { formatPhoneNl, normalizePhone } from "../scanner/normalize.js";
import { dashboardUrl } from "../reporter/links.js";
import { bareDomain, defaultFactsHost } from "./host.js";

export const SITECHECK_USER_AGENT = "Vidalo-Sitecheck/1.0 (+https://vidalo.io)";

/** Robots that fetch pages to answer a question, per engine Vidalo checks. */
export const ANSWER_ROBOTS: { token: string; engines: Engine[] }[] = [
  { token: "OAI-SearchBot", engines: ["chatgpt"] },
  { token: "ChatGPT-User", engines: ["chatgpt"] },
  { token: "Googlebot", engines: ["google_ai", "gemini"] },
  // Google: Google-Extended governs grounding in Gemini, not Search or AI Overviews.
  { token: "Google-Extended", engines: ["gemini"] },
  { token: "Bingbot", engines: ["copilot"] },
  { token: "PerplexityBot", engines: ["perplexity"] },
];

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
}

export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === "allow" || key === "disallow") {
      lastWasAgent = false;
      // An empty Disallow allows everything; it adds no rule.
      if (current && value !== "") current.rules.push({ allow: key === "allow", pattern: value });
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

/** Rules that apply to a robot: every group naming its token, else every "*" group. */
export function rulesFor(groups: RobotsGroup[], token: string): RobotsRule[] {
  const t = token.toLowerCase();
  const named = groups.filter((g) => g.agents.some((a) => a.split("/")[0]!.trim() === t));
  const chosen = named.length ? named : groups.filter((g) => g.agents.includes("*"));
  return chosen.flatMap((g) => g.rules);
}

function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = body
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${re}${anchored ? "$" : ""}`).test(path);
}

/** Longest matching pattern decides; on a tie Allow wins; no match = allowed. */
export function robotsAllows(groups: RobotsGroup[], token: string, path = "/"): boolean {
  let best: RobotsRule | null = null;
  for (const rule of rulesFor(groups, token)) {
    if (!patternMatches(rule.pattern, path)) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}

// ---------------------------------------------------------------------------
// homepage
// ---------------------------------------------------------------------------

/** schema.org types that describe a local business (LocalBusiness and the common subtypes). */
const BUSINESS_TYPES = new Set(
  [
    "LocalBusiness", "Store", "FoodEstablishment", "Bakery", "Restaurant", "CafeOrCoffeeShop", "BarOrPub",
    "HomeAndConstructionBusiness", "Plumber", "Electrician", "HVACBusiness", "RoofingContractor", "GeneralContractor",
    "HousePainter", "Locksmith", "MovingCompany", "AutomotiveBusiness", "AutoRepair", "AutoDealer",
    "HealthAndBeautyBusiness", "HairSalon", "BeautySalon", "NailSalon", "DaySpa", "MedicalBusiness", "Dentist",
    "Physician", "Optician", "Pharmacy", "ProfessionalService", "LegalService", "Attorney", "Notary",
    "AccountingService", "FinancialService", "RealEstateAgent", "InsuranceAgency", "ChildCare", "AnimalShelter",
    "EmploymentAgency", "TravelAgency", "SportsActivityLocation", "ExerciseGym", "LodgingBusiness", "Hotel",
    "EntertainmentBusiness", "DryCleaningOrLaundry", "Florist", "VeterinaryCare",
  ].map((t) => t.toLowerCase()),
);

type JsonNode = Record<string, unknown>;

function typesOf(node: JsonNode): string[] {
  const t = node["@type"];
  const list = Array.isArray(t) ? t : t ? [t] : [];
  return list.map((x) => String(x).replace(/^https?:\/\/schema\.org\//, "").toLowerCase());
}

function collectNodes(value: unknown, out: JsonNode[]): void {
  if (Array.isArray(value)) {
    for (const v of value) collectNodes(v, out);
  } else if (value && typeof value === "object") {
    const node = value as JsonNode;
    if ("@type" in node) out.push(node);
    for (const v of Object.values(node)) if (v && typeof v === "object") collectNodes(v, out);
  }
}

/** Every JSON-LD node on the page that describes the business. */
export function businessNodes(html: string): JsonNode[] {
  const nodes: JsonNode[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    try {
      collectNodes(JSON.parse(m[1]!.trim()), nodes);
    } catch {
      /* broken JSON-LD reads as absent */
    }
  }
  return nodes.filter((n) => {
    const types = typesOf(n);
    if (types.some((t) => BUSINESS_TYPES.has(t))) return true;
    return types.includes("organization") && n.address != null;
  });
}

/** True when a robots meta tag on the page says noindex (for every robot or for Googlebot). */
export function metaNoindex(html: string): boolean {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const name = /\bname\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]?.toLowerCase();
    if (name !== "robots" && name !== "googlebot") continue;
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1]?.toLowerCase() ?? "";
    if (/\b(noindex|none)\b/.test(content)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// the check
// ---------------------------------------------------------------------------

export type SiteIssue =
  | { kind: "robots_blocked"; robots: string[]; engines: Engine[]; robotsUrl: string }
  | { kind: "noindex"; via: "meta" | "header"; pageUrl: string }
  | { kind: "phone_mismatch"; found: string; expected: string; pageUrl: string }
  | { kind: "no_business_data"; pageUrl: string };

/** Issues that keep a correct answer from being found; no_business_data is advice only. */
export const BLOCKING_ISSUES: ReadonlySet<SiteIssue["kind"]> = new Set(["robots_blocked", "noindex", "phone_mismatch"]);

export interface SiteCheckResult {
  domain: string;
  checkedAt: string;
  mode: "live" | "mock";
  /** null when the robots.txt could not be read (5xx / network); 404 counts as "allows everything" */
  robotsStatus: number | null;
  homepageStatus: number | null;
  issues: SiteIssue[];
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

async function get(fetchImpl: FetchLike, url: string): Promise<{ status: number; text: string; headers: Headers } | null> {
  try {
    const res = await fetchImpl(url, { headers: { "user-agent": SITECHECK_USER_AGENT, accept: "text/html,text/plain;q=0.9,*/*;q=0.5" }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
    return { status: res.status, text: res.ok ? await res.text() : "", headers: res.headers };
  } catch (err) {
    log.info("sitecheck.fetch_failed", { url, error: errorMessage(err) });
    return null;
  }
}

/** A name with a dot that is not localhost or an IP literal. */
export function isPublicHostname(host: string): boolean {
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) return false; // also rejects IPv4/IPv6 literals and bare names
  return !/(^|\.)(localhost|local|internal)$/i.test(host);
}

/** Check one site against the confirmed facts. Never throws on network trouble; unread parts give no issue. */
export async function checkSite(domainOrUrl: string, facts: Pick<Facts, "phone"> | null, opts: { fetch?: FetchLike; now?: Date } = {}): Promise<SiteCheckResult> {
  const domain = bareDomain(domainOrUrl);
  const checkedAt = (opts.now ?? new Date()).toISOString();
  if (!opts.fetch && isMock()) {
    log.info("sitecheck.mock", { domain });
    return { domain, checkedAt, mode: "mock", robotsStatus: 200, homepageStatus: 200, issues: [] };
  }
  if (!isPublicHostname(domain)) {
    // The domain is owner input: never let it point the worker at itself or the private network.
    log.warn("sitecheck.refused_host", { domain });
    return { domain, checkedAt, mode: "live", robotsStatus: null, homepageStatus: null, issues: [] };
  }
  const fetchImpl = opts.fetch ?? fetch;
  const origin = `https://${domain}`;
  const robotsUrl = `${origin}/robots.txt`;
  const pageUrl = `${origin}/`;
  const issues: SiteIssue[] = [];

  const robots = await get(fetchImpl, robotsUrl);
  if (robots && robots.status === 200) {
    const groups = parseRobots(robots.text);
    const blocked = ANSWER_ROBOTS.filter((r) => !robotsAllows(groups, r.token, "/"));
    if (blocked.length) {
      const engines = [...new Set(blocked.flatMap((r) => r.engines))];
      issues.push({ kind: "robots_blocked", robots: blocked.map((r) => r.token), engines, robotsUrl });
    }
  }

  const page = await get(fetchImpl, pageUrl);
  if (page && page.status === 200) {
    const header = page.headers.get("x-robots-tag")?.toLowerCase() ?? "";
    if (/\b(noindex|none)\b/.test(header)) issues.push({ kind: "noindex", via: "header", pageUrl });
    else if (metaNoindex(page.text)) issues.push({ kind: "noindex", via: "meta", pageUrl });

    const nodes = businessNodes(page.text);
    if (!nodes.length) {
      issues.push({ kind: "no_business_data", pageUrl });
    } else {
      const expected = normalizePhone(facts?.phone);
      const listed = nodes.map((n) => (typeof n.telephone === "string" ? n.telephone : null)).find((t) => t);
      const found = normalizePhone(listed);
      if (expected && found && found !== expected) {
        issues.push({ kind: "phone_mismatch", found: listed!, expected: formatPhoneNl(expected), pageUrl });
      }
    }
  }

  return { domain, checkedAt, mode: "live", robotsStatus: robots?.status ?? null, homepageStatus: page?.status ?? null, issues };
}

/** Stable key per issue, to tell a new problem from one we already reported. */
export function issueKey(issue: SiteIssue): string {
  switch (issue.kind) {
    case "robots_blocked":
      return `robots_blocked:${[...issue.robots].sort().join(",")}`;
    case "phone_mismatch":
      return `phone_mismatch:${normalizePhone(issue.found) ?? issue.found}`;
    default:
      return issue.kind;
  }
}

// ---------------------------------------------------------------------------
// owner e-mail
// ---------------------------------------------------------------------------

const ENGINE_NAMES: Record<Engine, string> = { chatgpt: "ChatGPT", google_ai: "Google", gemini: "Gemini", copilot: "Copilot", perplexity: "Perplexity" };

function joinNl(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} en ${items.at(-1)}`;
}

/** To the owner: what to change on their own website so the assistants can read it. */
export function sitecheckEmail(business: Pick<BusinessRecord, "name">, result: SiteCheckResult, links: { factsPageUrl: string; dashboardUrl: string }): { subject: string; text: string } {
  const blocks: string[] = [];
  let n = 0;
  for (const issue of result.issues) {
    switch (issue.kind) {
      case "robots_blocked": {
        const who = joinNl(issue.engines.map((e) => ENGINE_NAMES[e]));
        const allow = issue.robots.map((r) => `User-agent: ${r}\nAllow: /`).join("\n\n");
        blocks.push(`${++n}. ${who} ${issue.engines.length === 1 ? "mag" : "mogen"} je website niet lezen

In het bestand ${issue.robotsUrl} staat een regel die de zoekrobot van ${who} buitensluit. Daardoor kan ${who} je openingstijden en telefoonnummer niet van je eigen website halen, en neemt het ze over van andere sites.

Haal die regel weg, of zet dit bovenaan het bestand:

${allow}`);
        break;
      }
      case "noindex":
        blocks.push(`${++n}. Je homepage vraagt zoekmachines om haar over te slaan

${issue.via === "header" ? "Je webserver stuurt bij de homepage de instructie \"noindex\" mee." : "In de code van je homepage staat de instructie \"noindex\"."} Google, Bing en de AI-assistenten die daarop zoeken, nemen de pagina dan niet op.

Haal "noindex" weg. Werk je met WordPress, kijk dan bij Instellingen, Lezen: daar staat vaak het vinkje "Zoekmachines ontmoedigen deze site te indexeren". Zet dat uit.`);
        break;
      case "phone_mismatch":
        blocks.push(`${++n}. Een oud telefoonnummer in de bedrijfsgegevens van je homepage

In de bedrijfsgegevens die je homepage voor zoekmachines meestuurt (niet zichtbaar op de pagina zelf) staat: ${issue.found}
Dit moet zijn: ${issue.expected}

Pas het aan in de instellingen van je website (bij WordPress vaak in een plugin als Yoast), of vraag het je websitebouwer.`);
        break;
      case "no_business_data":
        blocks.push(`${++n}. Kleine verbetering: je bedrijfsgegevens in een vaste vorm

Je homepage stuurt je adres, openingstijden en telefoonnummer niet mee in de vaste vorm die zoekmachines en AI-assistenten direct lezen. Op je feitenpagina staat die vorm al. Je websitebouwer kan het blok overnemen:
${links.factsPageUrl}feiten.json`);
        break;
    }
  }
  const subject = `${n === 1 ? "Eén aanpassing" : `${n} aanpassingen`} op je website voor ${business.name}`;
  const text = `Hoi,

We hebben gekeken of AI-assistenten je eigen website ${result.domain} goed kunnen lezen. Dit kan beter:

${blocks.join("\n\n")}

Lukt het niet zelf? Stuur deze mail door naar wie je website bouwt, dit is alles wat er moet gebeuren. Wij controleren het over een maand opnieuw. Je hoeft ons niets te laten weten.

Je overzicht: ${links.dashboardUrl}

Groet,
Vidalo
`;
  return { subject, text };
}

// ---------------------------------------------------------------------------
// job entry
// ---------------------------------------------------------------------------

export interface RunSiteCheckResult {
  skipped?: "no_business" | "no_domain";
  result?: SiteCheckResult;
  /** issue keys that were not in the last notification */
  newIssues: string[];
  notified: boolean;
}

/**
 * Check the owner's website, log the outcome, and mail the owner when a
 * blocking issue appears that we did not report before. Advice-only issues
 * ride along in that mail but never trigger one on their own.
 */
export async function runSiteCheck(businessId: string, opts: { fetch?: FetchLike; now?: Date } = {}): Promise<RunSiteCheckResult> {
  const db = getDb();
  const business = await db.getBusiness(businessId);
  if (!business) return { skipped: "no_business", newIssues: [], notified: false };
  const facts = await db.latestFacts(business.id);
  const domain = business.domain ?? facts?.website ?? null;
  if (!domain) {
    await db.logEvent(business.id, "sitecheck.skipped", { reason: "no_domain" });
    return { skipped: "no_domain", newIssues: [], notified: false };
  }

  const result = await checkSite(domain, facts, opts);
  const keys = result.issues.map(issueKey);
  await db.logEvent(business.id, "sitecheck.done", { domain: result.domain, mode: result.mode, robotsStatus: result.robotsStatus, homepageStatus: result.homepageStatus, issues: result.issues, keys });

  const lastNotified = (await db.listEvents(business.id, 500)).find((e) => e.type === "sitecheck.notified");
  const before = new Set<string>(Array.isArray(lastNotified?.payload.keys) ? (lastNotified!.payload.keys as string[]) : []);
  const newIssues = result.issues.filter((i) => BLOCKING_ISSUES.has(i.kind)).map(issueKey).filter((k) => !before.has(k));

  let notified = false;
  if (newIssues.length && business.ownerEmail) {
    const m = sitecheckEmail(business, result, { factsPageUrl: `https://${business.factsHost ?? defaultFactsHost(business)}/`, dashboardUrl: dashboardUrl(business) });
    await db.enqueueJob("email", { to: business.ownerEmail, subject: m.subject, text: m.text, businessId: business.id, kind: "site_instruction" });
    await db.logEvent(business.id, "sitecheck.notified", { keys, newIssues });
    notified = true;
  }
  log.info("sitecheck.done", { businessId, domain: result.domain, mode: result.mode, issues: keys, notified });
  return { result, newIssues, notified };
}
