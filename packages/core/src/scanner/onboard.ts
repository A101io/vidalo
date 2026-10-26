/**
 * Glue for the acquisition flow: name + place -> business row + provisional
 * facts + prompts, ready for runScan. Used by the CLI and by apps/web.
 */
import type { Prompt } from "../types";
import { type BusinessRecord, type Db } from "../db";
import { getDb } from "../shared/db.js";
import { generatePrompts } from "../prompts";
import { normalizeWebsite, slugify } from "./normalize";
import { scanLang, withCountry } from "../shared/country";
import { draftProvisionalFacts, resolveBusiness, sectorForCandidate, type BusinessCandidate } from "./resolve";

export interface PrepareOptions {
  name: string;
  place: string;
  /** Confirmed candidate (from resolveBusiness); when omitted the first candidate is used. */
  candidate?: BusinessCandidate;
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
 * a new one gets provisional facts (v1) and the full prompt set.
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

  let facts = await db.latestFacts(business.id);
  if (!facts) {
    const draft = await draftProvisionalFacts({ ...candidate, name: opts.name }, { place: opts.place });
    facts = await db.insertFacts(business.id, { ...draft, place: opts.place }, { provisional: true });
  }
  facts = withCountry(facts, business);
  let prompts = await db.listPrompts(business.id, { activeOnly: true });
  if (!prompts.length) prompts = await db.insertPrompts(business.id, generatePrompts(facts, { sector: business.sector }));

  return { business, factsVersion: facts.version, prompts, candidate, created: !existing };
}
