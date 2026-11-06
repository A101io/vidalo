/**
 * Dutch business directories: where AI assistants pick up stale hours and
 * phone numbers. Each directory has a mode:
 *   - api   : a write API exists (none wired yet; see TODOs)
 *   - form  : a correction form on the site → FormAgent (browser agent, later) or operator
 *   - email : corrections go by e-mail → templated correction email job in the owner's name
 */
import type { Business, Channel, Facts } from "../../types.js";
import { log } from "../../shared/log.js";
import { diffFacts, type ChannelAdapter, type ChannelDiffEntry, type SyncResult } from "./types.js";

export type DirectoryMode = "api" | "form" | "email";

export interface Directory {
  name: string;
  domain: string;
  mode: DirectoryMode;
  /** `{q}` is replaced with "name place" (URL-encoded). */
  searchUrl: string;
  /** Known correction address; null = look up on the site before sending (operator). */
  contactEmail: string | null;
  /** Correction form URL pattern when known; `{listing}` = listing URL. */
  formUrl?: string;
  note?: string;
}

export const DIRECTORIES: Directory[] = [
  { name: "openingstijden.nl", domain: "openingstijden.nl", mode: "form", searchUrl: "https://www.openingstijden.nl/zoeken/?q={q}", contactEmail: null, note: "Wijziging doorgeven via knop op de vermelding." },
  { name: "Telefoonboek.nl", domain: "telefoonboek.nl", mode: "form", searchUrl: "https://www.telefoonboek.nl/zoeken/{q}", contactEmail: null, note: "Bedrijfsvermelding wijzigen via 'Wijzig gegevens'." },
  { name: "De Telefoongids", domain: "detelefoongids.nl", mode: "form", searchUrl: "https://www.detelefoongids.nl/{q}/", contactEmail: null },
  { name: "Cylex Nederland", domain: "cylex.nl", mode: "email", searchUrl: "https://www.cylex.nl/zoeken?q={q}", contactEmail: null, note: "Correcties via contactformulier of e-mail van de redactie." },
  { name: "Bedrijvenpagina.nl", domain: "bedrijvenpagina.nl", mode: "email", searchUrl: "https://www.bedrijvenpagina.nl/zoeken?q={q}", contactEmail: null },
  { name: "Opendi", domain: "opendi.nl", mode: "email", searchUrl: "https://www.opendi.nl/zoeken?q={q}", contactEmail: null },
  { name: "Infobel", domain: "infobel.com", mode: "form", searchUrl: "https://www.infobel.com/nl/netherlands/search?q={q}", contactEmail: null },
  { name: "Hotfrog Nederland", domain: "hotfrog.nl", mode: "form", searchUrl: "https://www.hotfrog.nl/zoeken/{q}", contactEmail: null },
  { name: "Kompass", domain: "nl.kompass.com", mode: "email", searchUrl: "https://nl.kompass.com/searchCompanies?text={q}", contactEmail: null },
  { name: "Yelp", domain: "yelp.nl", mode: "api", searchUrl: "https://www.yelp.nl/search?find_desc={q}", contactEmail: null, note: "TODO(api): Yelp Fusion is read-only; writes via owner account (form)." },
  { name: "Foursquare", domain: "foursquare.com", mode: "api", searchUrl: "https://foursquare.com/explore?q={q}", contactEmail: null, note: "TODO(api): Places API write needs a verified venue manager." },
  { name: "Tripadvisor", domain: "tripadvisor.nl", mode: "form", searchUrl: "https://www.tripadvisor.nl/Search?q={q}", contactEmail: null, note: "Alleen horeca/recreatie." },
  { name: "AlleBedrijvenIn", domain: "allebedrijvenin.nl", mode: "email", searchUrl: "https://www.allebedrijvenin.nl/zoeken?q={q}", contactEmail: null },
];

export function findDirectory(nameOrDomain: string): Directory | undefined {
  const key = nameOrDomain.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "");
  return DIRECTORIES.find((d) => d.domain === key || d.name.toLowerCase() === key);
}

/** Directory whose domain matches a cited source URL (used by the fixer to route third-party findings). */
export function directoryForUrl(url: string): Directory | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return DIRECTORIES.find((d) => host === d.domain || host.endsWith(`.${d.domain}`));
  } catch {
    return undefined;
  }
}

export interface ListingHit {
  directory: Directory;
  url: string | null;
  found: boolean;
  mode: "live" | "mock";
}

function slugWords(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
}

/**
 * Look up a business in one directory. Real mode fetches the search page and
 * returns the first link whose path contains the business name words; mock
 * mode returns a synthetic listing URL.
 */
export async function findListing(business: Pick<Business, "name" | "place" | "slug">, directory: Directory): Promise<ListingHit> {
  const q = encodeURIComponent(`${business.name} ${business.place}`);
  const url = directory.searchUrl.replace("{q}", q);
  if (process.env.VIDALO_MOCK === "1") {
    return { directory, url: `https://www.${directory.domain}/${business.slug}`, found: true, mode: "mock" };
  }
  try {
    const res = await fetch(url, { headers: { "user-agent": "VidaloBot/1.0 (+https://vidalo.ai)", accept: "text/html" }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { directory, url: null, found: false, mode: "live" };
    const html = await res.text();
    const words = slugWords(business.name);
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
    for (const href of hrefs) {
      const lower = href.toLowerCase();
      const score = words.filter((w) => lower.includes(w)).length;
      if (words.length && score >= Math.min(2, words.length)) {
        const abs = href.startsWith("http") ? href : `https://www.${directory.domain}${href.startsWith("/") ? "" : "/"}${href}`;
        return { directory, url: abs, found: true, mode: "live" };
      }
    }
    return { directory, url: null, found: false, mode: "live" };
  } catch (err) {
    log.warn("directory.findListing.failed", { directory: directory.domain, error: err instanceof Error ? err.message : String(err) });
    return { directory, url: null, found: false, mode: "live" };
  }
}

export async function findAllListings(business: Pick<Business, "name" | "place" | "slug">): Promise<ListingHit[]> {
  return Promise.all(DIRECTORIES.map((d) => findListing(business, d)));
}

// ---------------------------------------------------------------------------
// Form agent interface (browser agent later; operator queue now)
// ---------------------------------------------------------------------------

export interface FormTask {
  directory: Directory;
  listingUrl: string | null;
  business: Pick<Business, "id" | "name" | "place" | "slug">;
  diff: ChannelDiffEntry[];
  /** reference the directory can verify */
  factsPageUrl: string | null;
}

export interface FormResult {
  submitted: boolean;
  /** screenshot path / confirmation text */
  evidence: Record<string, unknown>;
  error?: string;
}

export interface FormAgent {
  submit(task: FormTask): Promise<FormResult>;
}

/** Placeholder agent: never submits, so the caller escalates to the operator queue. */
export const operatorFormAgent: FormAgent = {
  async submit(task: FormTask): Promise<FormResult> {
    log.info("directory.form.operator", { directory: task.directory.domain, listingUrl: task.listingUrl, fields: task.diff.map((d) => d.field) });
    return { submitted: false, evidence: { mode: "operator", at: new Date().toISOString() }, error: "no browser agent configured" };
  },
};

let formAgent: FormAgent = operatorFormAgent;
export function setFormAgent(agent: FormAgent): void {
  formAgent = agent;
}

export function factsPageUrlFor(business: Pick<Business, "slug"> & { factsHost?: string | null }): string {
  const host = business.factsHost ?? `${business.slug}.feiten.${process.env.FACTS_HOST_SUFFIX || "vidalo.io"}`;
  return `https://${host}/`;
}

/**
 * syncChannel for a directory channel. The channel's `name` must match a
 * Directory name or domain. We cannot read most directories structurally, so
 * the diff is "everything in the facts" unless `channel.meta.current` is set.
 */
export const directoryAdapter: ChannelAdapter = {
  type: "directory",
  async syncChannel(channel: Channel, facts: Facts): Promise<SyncResult> {
    const dir = findDirectory(channel.name) ?? (channel.url ? directoryForUrl(channel.url) : undefined);
    const base = { channelId: channel.id, channelType: "directory" as const };
    if (!dir) {
      return { ...base, status: "skipped", diff: [], evidence: { reason: "unknown directory", name: channel.name } };
    }
    const meta = (channel as Channel & { meta?: { current?: Record<string, string | null>; factsPageUrl?: string } }).meta ?? {};
    const diff = diffFacts(meta.current ?? {}, facts);
    const business = { id: facts.businessId, name: facts.name, place: facts.place, slug: facts.businessId };
    const factsPageUrl = meta.factsPageUrl ?? null;

    if (dir.mode === "email") {
      const to = dir.contactEmail;
      if (!to && process.env.VIDALO_MOCK !== "1") {
        return {
          ...base,
          status: "manual",
          diff,
          evidence: { mode: "email", directory: dir.domain, reason: "no contact email on file", at: new Date().toISOString() },
          followUp: { kind: "operator_task", payload: { reason: "directory_lookup_contact", directory: dir.domain, channelId: channel.id, businessId: channel.businessId, diff } },
        };
      }
      const address = to ?? `info@${dir.domain}`;
      log.info("directory.sync.email", { directory: dir.domain, to: address, mock: !to });
      return {
        ...base,
        status: "pending",
        diff,
        evidence: { mode: "email", directory: dir.domain, to: address, addressGuessed: !to, at: new Date().toISOString() },
        followUp: {
          kind: "email",
          payload: { template: "directory_correction", to: address, directory: dir.domain, listingUrl: channel.url, channelId: channel.id, businessId: channel.businessId, diff },
        },
      };
    }

    if (dir.mode === "form") {
      const result = await formAgent.submit({ directory: dir, listingUrl: channel.url, business, diff, factsPageUrl });
      if (result.submitted) {
        return { ...base, status: "synced", diff, evidence: { mode: "form", directory: dir.domain, ...result.evidence } };
      }
      return {
        ...base,
        status: "manual",
        diff,
        evidence: { mode: "form", directory: dir.domain, ...result.evidence, error: result.error },
        followUp: { kind: "operator_task", payload: { reason: "directory_form", directory: dir.domain, listingUrl: channel.url, formUrl: dir.formUrl ?? null, channelId: channel.id, businessId: channel.businessId, diff } },
      };
    }

    // api
    log.info("directory.sync.api.todo", { directory: dir.domain, note: dir.note });
    return {
      ...base,
      status: "manual",
      diff,
      evidence: { mode: "api-stub", directory: dir.domain, note: dir.note ?? null, at: new Date().toISOString() },
      followUp: { kind: "operator_task", payload: { reason: "directory_api_todo", directory: dir.domain, listingUrl: channel.url, channelId: channel.id, businessId: channel.businessId, diff } },
    };
  },
};
