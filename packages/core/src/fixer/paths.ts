/**
 * The fix-path table from docs/ARCHITECTURE.md (workflow D) as data.
 * One path per SourceType: what we do, when we recheck, where it escalates.
 */
import type { Finding, FixAction, SourceType } from "../types.js";

export type Escalation = "none" | "reminder" | "followup_email" | "operator" | "model_release" | "resync";

export interface FixPath {
  sourceType: SourceType;
  /** Set on the not_found path only: the finding's verdict, not its source, picks this path. */
  verdict?: "not_found";
  action: FixAction;
  /** days until the mini-scan that checks whether the wrong answer is gone */
  recheckDays: number;
  /** what happens when the recheck still shows the wrong value */
  escalation: Escalation;
  /** days after the first action for a reminder / follow-up email (owned_website, third_party) */
  followUpDays?: number[];
  /** after this many days without resolution we stop and tell the owner honestly */
  unfixableAfterDays?: number;
  /** Dutch one-liner for the dashboard / report: "Wat we doen" */
  labelNl: string;
  /** Dutch note shown when a finding is marked unfixable */
  unfixableNoteNl?: string;
  /** the same two lines in English, for an owner who chose English (business.language) */
  labelEn: string;
  unfixableNoteEn?: string;
}

export const FIX_PATHS: Record<SourceType, FixPath> = {
  owned_facts_page: {
    sourceType: "owned_facts_page",
    action: "republish",
    recheckDays: 7,
    escalation: "operator",
    labelNl: "We publiceren je feitenpagina opnieuw en melden de wijziging bij de zoekmachines.",
    labelEn: "We republish your facts page and report the change to the search engines.",
  },
  owned_website: {
    sourceType: "owned_website",
    action: "manual",
    recheckDays: 14,
    escalation: "reminder",
    followUpDays: [14, 28],
    unfixableAfterDays: 60,
    labelNl: "We mailen je welke tekst op je website moet veranderen.",
    unfixableNoteNl: "De tekst op je eigen website is nog niet aangepast.",
    labelEn: "We email you which text on your website needs to change.",
    unfixableNoteEn: "The text on your own website has not been changed yet.",
  },
  directory_api: {
    sourceType: "directory_api",
    action: "sync",
    recheckDays: 7,
    escalation: "operator",
    unfixableAfterDays: 45,
    labelNl: "We zetten de juiste gegevens opnieuw in het profiel.",
    labelEn: "We put the right details in the profile again.",
  },
  directory_form: {
    sourceType: "directory_form",
    action: "form",
    recheckDays: 14,
    escalation: "operator",
    unfixableAfterDays: 45,
    labelNl: "We dienen een correctie in bij de gids.",
    labelEn: "We submit a correction to the directory.",
  },
  third_party: {
    sourceType: "third_party",
    action: "email",
    recheckDays: 30,
    escalation: "followup_email",
    followUpDays: [14],
    unfixableAfterDays: 45,
    labelNl: "We vragen de bron uit jouw naam om de gegevens te corrigeren.",
    unfixableNoteNl: "De bron heeft niet gereageerd op ons verzoek.",
    labelEn: "We ask the source, on your behalf, to correct the details.",
    unfixableNoteEn: "The source did not respond to our request.",
  },
  other_entity: {
    sourceType: "other_entity",
    action: "republish",
    recheckDays: 30,
    escalation: "operator",
    unfixableAfterDays: 90,
    labelNl: "We maken op je feitenpagina en in je profielen duidelijker welk bedrijf jij bent.",
    unfixableNoteNl: "De AI verwart je nog met een ander bedrijf.",
    labelEn: "We make it clearer on your facts page and in your profiles which business you are.",
    unfixableNoteEn: "AI still mixes you up with another business.",
  },
  none: {
    sourceType: "none",
    action: "none",
    recheckDays: 30,
    escalation: "model_release",
    unfixableAfterDays: 45,
    labelNl: "Dit antwoord komt uit het geheugen van het model. Dat verandert pas bij een nieuwe versie; we blijven controleren.",
    unfixableNoteNl: "Dit antwoord komt uit het geheugen van het model, niet van een bron die wij kunnen aanpassen.",
    labelEn: "This answer comes from the model's memory. That only changes with a new version; we keep checking.",
    unfixableNoteEn: "This answer comes from the model's memory, not from a source we can change.",
  },
};

/**
 * Not found: the AI has never heard of the business. There is no wrong source
 * to correct, so we make the business findable: publish the facts page, sync
 * every channel, discover the directory listings. Recheck after 21 days, a
 * follow-up recheck (with another sync) at 45 days, never unfixable before 60.
 */
export const NOT_FOUND_PATH: FixPath = {
  sourceType: "none",
  verdict: "not_found",
  action: "republish",
  recheckDays: 21,
  escalation: "resync",
  followUpDays: [45],
  unfixableAfterDays: 60,
  labelNl: "Niet gevonden: we maken je vindbaar",
  unfixableNoteNl: "AI noemt je na 60 dagen nog steeds niet. Je feitenpagina en profielen staan goed; we blijven elke maand controleren.",
  labelEn: "Not found: we make you findable",
  unfixableNoteEn: "After 60 days AI still does not name you. Your facts page and profiles are right; we keep checking every month.",
};

/**
 * Not named in a recommendation ("welke loodgieter in Zwolle met spoed") while
 * the facts say the business belongs there, and no cited page carries the
 * fact. Same remedy as not found: put the fact on the facts page and in every
 * profile, then recheck after 21 days.
 */
export const RECOMMENDATION_PATH: FixPath = {
  sourceType: "none",
  action: "republish",
  recheckDays: 21,
  escalation: "resync",
  followUpDays: [45],
  unfixableAfterDays: 60,
  labelNl: "Niet genoemd: we zetten dit gegeven op je feitenpagina en in je profielen, en controleren na 3 weken opnieuw.",
  unfixableNoteNl: "AI noemt je na 60 dagen nog steeds niet bij deze vraag. Je gegevens staan goed; we blijven elke maand controleren.",
  labelEn: "Not named: we put this detail on your facts page and in your profiles, and check again after 3 weeks.",
  unfixableNoteEn: "After 60 days AI still does not name you for this question. Your details are right; we keep checking every month.",
};

/**
 * A product-line finding whose remedy is not ours (ADR-0014): no page of ours carries a product line, so there is no
 * facts page to republish and no profile to sync. Nothing is claimed; the check goes on every month.
 */
export const LINE_KEEP_CHECKING_PATH: FixPath = {
  sourceType: "none",
  action: "none",
  recheckDays: 30,
  escalation: "model_release",
  unfixableAfterDays: 60,
  labelNl: "We hebben geen pagina waarmee we dit voor je productlijn kunnen verbeteren. We blijven elke maand controleren.",
  unfixableNoteNl: "Hier kunnen we voor je productlijn niets aan veranderen. We blijven elke maand controleren.",
  labelEn: "We have no page we can use to improve this for your product line. We keep checking every month.",
  unfixableNoteEn: "There is nothing we can change for your product line here. We keep checking every month.",
};

/**
 * An outlet the AI named that the owner did not list (compliance B1): never a letter to a third party, because the AI may
 * well be right. The owner is asked whether the shop sells the product; if so, adding it to the list settles it.
 */
export const LINE_OUTLET_PATH: FixPath = {
  ...LINE_KEEP_CHECKING_PATH,
  labelNl: "Dit verkooppunt staat niet in je lijst. Verkoopt het je product wel? Voeg het dan toe aan je lijst. We blijven elke maand controleren.",
  labelEn: "This shop is not in your list. Does it sell your product? Then add it to your list. We keep checking every month.",
};

type LineFields = { productLineId?: string | null; factKey?: Finding["factKey"] };

export function fixPathFor(sourceType: SourceType, verdict?: Finding["verdict"], evidenceKind?: Finding["evidenceKind"], productLineId?: string | null, factKey?: Finding["factKey"]): FixPath {
  if (productLineId) {
    // Product line (ADR-0014): only the paths that need no page of ours. The owner's own website, or a correction request to
    // a third party; everything else, an outlet "not in your list" always, is "keep checking".
    if (factKey === "outlet") return LINE_OUTLET_PATH;
    if (verdict === "not_found" || evidenceKind === "recommendation") return LINE_KEEP_CHECKING_PATH;
    if (sourceType === "owned_website") return FIX_PATHS.owned_website;
    if (sourceType === "third_party" || sourceType === "directory_api" || sourceType === "directory_form") return FIX_PATHS.third_party;
    return LINE_KEEP_CHECKING_PATH;
  }
  if (verdict === "not_found") return NOT_FOUND_PATH;
  if (evidenceKind === "recommendation" && sourceType === "none") return RECOMMENDATION_PATH;
  return FIX_PATHS[sourceType] ?? FIX_PATHS.none;
}

export function fixPathForFinding(finding: Pick<Finding, "sourceType" | "verdict"> & Partial<Pick<Finding, "evidenceKind">> & LineFields): FixPath {
  return fixPathFor(finding.sourceType, finding.verdict, finding.evidenceKind, finding.productLineId, finding.factKey);
}

/** Does this finding take the "make it findable" route (facts page + channels)? */
export function isFindabilityFinding(finding: Pick<Finding, "sourceType" | "verdict"> & Partial<Pick<Finding, "evidenceKind">> & LineFields): boolean {
  // A product line has no facts page or channel to make findable (ADR-0014): never publish, sync or discover for one.
  if (finding.productLineId) return false;
  return finding.verdict === "not_found" || (finding.evidenceKind === "recommendation" && finding.sourceType === "none");
}

export function addDays(from: Date | string, days: number): Date {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function daysBetween(a: Date | string, b: Date | string): number {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}
