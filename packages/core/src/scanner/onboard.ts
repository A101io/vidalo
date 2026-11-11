/**
 * Glue for the acquisition flow: name + place -> business row + provisional
 * facts, ready for runScan. Used by the CLI and by apps/web.
 */
import type { Prompt } from "../types";
import { type BusinessRecord, type Db } from "../db";
import { getDb } from "../shared/db.js";
import { normalizeWebsite, slugify } from "./normalize";
import { scanLang, withCountry } from "../shared/country";
import { draftProvisionalFacts, resolveBusiness, sectorForCandidate, type BusinessCandidate } from "./resolve";

export interface PrepareOptions {
  name: string;
  place: string;
  /** Confirmed candidate (from resolveBusiness); when omitted the first candidate is used. */
  candidate?: BusinessCandidate;
  /**
   * The website the visitor typed on /scan/kies for a business Google does not list (ADR-0007), already through
   * parseTypedWebsite. Stored as the provisional facts.website only; business.domain stays unset (a domain is
   * the owner's to prove). Ignored when the candidate has a listing or a website of its own.
   */
  website?: string | null;
  db?: Db;
}

export interface Prepared {
  business: BusinessRecord;
  factsVersion: number;
  prompts: Prompt[];
  candidate: BusinessCandidate;
  created: boolean;
}

/**
 * Idempotent: an existing business (same slug) keeps its facts and prompts;
 * a new one gets provisional facts (v1). Questions are stored by loadPrompts.
 */
export async function prepareBusiness(opts: PrepareOptions): Promise<Prepared> {
  const db = opts.db ?? getDb();
  const slug = slugify(opts.name, opts.place);
  const existing = await db.getBusiness(slug);
  const candidate = opts.candidate ?? (await resolveBusiness(opts.name, opts.place))[0]!;

  const country = existing?.country ?? candidate.country;
  const business = await db.upsertBusiness({
    id: existing?.id,
    slug,
    name: opts.name,
    place: opts.place,
    country,
    // A business abroad reads its report and account in English until the owner picks otherwise.
    language: existing?.language ?? scanLang(country),
    domain: existing?.domain ?? normalizeWebsite(candidate.website),
    kvk: existing?.kvk ?? candidate.kvk,
    googlePlaceId: existing?.googlePlaceId ?? candidate.placeId,
    sector: existing?.sector ?? sectorForCandidate(candidate),
  });

  const typedWebsite = !candidate.placeId && !candidate.website ? (opts.website ?? null) : null;
  let facts = await db.latestFacts(business.id);
  if (!facts) {
    // The typed address is not given to the draft: that would scrape it with a fetch that follows redirects unguarded (security S-13).
    const draft = await draftProvisionalFacts({ ...candidate, name: opts.name }, { place: opts.place });
    facts = await db.insertFacts(business.id, { ...draft, place: opts.place, ...(typedWebsite ? { website: typedWebsite } : {}) }, { provisional: true });
  } else if (typedWebsite && facts.provisional && !facts.website) {
    // An earlier check of this business had no website; the owner has confirmed nothing yet.
    const { businessId: _b, version: _v, createdAt: _c, profile: _p, ...rest } = facts;
    facts = await db.insertFacts(business.id, { ...rest, website: typedWebsite }, { provisional: true });
  }
  facts = withCountry(facts, business);
  // The questions are chosen per profile when the scan starts (loadPrompts); this is what is stored so far.
  const prompts = await db.listPrompts(business.id, { activeOnly: true });

  return { business, factsVersion: facts.version, prompts, candidate, created: !existing };
}
