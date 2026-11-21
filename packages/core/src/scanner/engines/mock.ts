/**
 * Deterministic mock engine. Produces plausible Dutch answers from the
 * business facts and, for ~35% of (prompt, engine) pairs, injects one wrong
 * value: an old phone number, "gesloten op zondag", "permanent gesloten", a
 * service "nee" where the facts say yes, etc. Some wrong answers cite a fake
 * directory page (openingstijden.nl/{slug}, telefoonboek.nl/{slug}); some
 * cite nothing (model memory).
 *
 * A business without a website, or whose slug contains "nieuw" or "onbekend",
 * is one the mock AI has barely heard of: ~70% of its samples answer
 * "Ik kan geen informatie vinden over {name} in {place}." (no citations).
 *
 * Everything is seeded by business slug + prompt + engine + sampleIndex, so
 * the same inputs always give the same answer across runs and processes.
 */
import type { Engine, FactKey, Facts, Hours, LineFactsView } from "../../types";
import { DAY_NAMES_NL, formatPhoneNl, normalizePhone, normalizeSpecValue, slugify } from "../normalize";
import { scanLang } from "../../shared/country";
import { seededRandom } from "../util";
import type { EngineClient, AskContext, EngineAnswer } from "./types";

const WRONG_PAIR_RATE = 0.35; // share of (prompt, engine) pairs that carry a wrong value
const WRONG_SAMPLE_RATE = 0.8; // within such a pair, share of samples that repeat it
const OTHER_ENTITY_RATE = 0.04;
/** For a business the mock "has never heard of": share of samples that say not found. */
const NOT_FOUND_SAMPLE_RATE = 0.7;

/** A business without a website, or whose slug says "nieuw" / "onbekend", is one the mock AI barely knows. */
export function mockIsUnknownBusiness(slug: string, facts: Pick<Facts, "website">): boolean {
  return facts.website == null || /nieuw|onbekend/.test(slug);
}

const OTHER_CITIES = ["Amsterdam", "Rotterdam", "Utrecht", "Eindhoven", "Groningen", "Leiden", "Zwolle", "Breda"];

/** Infer category + probe from the prompt text when no Prompt object is passed. */
function inferProbe(promptNl: string): { category: FactKey; probe: string } {
  const p = promptNl.toLowerCase();
  const dayIdx = DAY_NAMES_NL.findIndex((d) => p.includes(d));
  if (p.includes("telefoon")) return { category: "phone", probe: "phone" };
  if (p.includes("adres")) return { category: "address", probe: "address" };
  if (p.includes("website")) return { category: "website", probe: "website" };
  if (p.includes("pinnen")) return { category: "payment", probe: "payment:pin" };
  if (p.includes("wat kost")) return { category: "price", probe: `price:${promptNl.match(/wat kost (.+?) bij/i)?.[1] ?? ""}` };
  if (p.includes("geldt bij")) return { category: "policy", probe: `policy:${promptNl.match(/"(.+?)"/)?.[1] ?? ""}` };
  if (p.startsWith("doet ")) return { category: "service", probe: `service:${promptNl.match(/ook (.+?)\?/i)?.[1] ?? ""}` };
  if (p.includes("openingstijden")) return { category: "hours", probe: "hours" };
  if (dayIdx >= 0 || p.includes("hoe laat") || p.includes("tot hoe laat")) return { category: "hours", probe: `hours.${dayIdx >= 0 ? dayIdx : 5}` };
  if (p.includes("spoed") || p.includes("storingsdienst") || p.includes("24-uurs") || p.includes("vandaag")) return { category: "urgency", probe: "urgency" };
  if (p.includes("komt ") || p.includes("werkt ")) return { category: "area", probe: `area:${promptNl.match(/in ([^?]+)\?/)?.[1] ?? ""}` };
  if (p.includes("erkend") || p.includes("aangesloten") || p.includes("registratie")) return { category: "credential", probe: `credential:${promptNl.match(/(?:voor|bij) ([^?]+)\?/)?.[1] ?? ""}` };
  if (p.includes("hetzelfde")) return { category: "identity", probe: `identity:${promptNl.match(/als (.+?)\?/)?.[1] ?? ""}` };
  // Product-line questions (feature 006), for calls without a Prompt object.
  if (p.includes("opvolger") || p.includes("successor")) return { category: "successor", probe: `successor:${promptNl.match(/(?:opvolger|successor) van (.+?)(?: van | by |\?)/i)?.[1] ?? ""}` };
  if (p.includes("gecertificeerd") || p.includes(" certified")) return { category: "certificate", probe: `certificate:${promptNl.match(/ ([^ ]+?)(?:-gecertificeerd| certified)/i)?.[1] ?? ""}` };
  if (p.startsWith("waar koop") || p.startsWith("where can i buy")) return { category: "outlet", probe: `outlet:${promptNl.match(/ in ([^?]+)\?/)?.[1] ?? ""}` };
  if (/^(welke?|what) \S+ (heeft|does) /i.test(promptNl)) return { category: "spec", probe: `spec:${promptNl.match(/^(?:welke?|what) (\S+)/i)?.[1] ?? ""}` };
  return { category: "existence", probe: "existence" };
}

/** Does the prompt ask for a recommendation ("welke bakker in Haarlem ...")? Used when no Prompt object is passed. */
function looksLikeRecommendation(promptNl: string): boolean {
  return /^(welke|wie|waar)\b/i.test(promptNl.trim()) || /, wie kan/i.test(promptNl);
}

/** Plausible other businesses for a recommendation answer. */
const OTHER_BUSINESSES = ["Van der Berg", "De Wit", "Bos & Zn", "Hendriks", "Jansen", "Visser", "Smit", "Mulder"];

/** A recommendation answer: a short list that includes the business, or (wrong) leaves it out. */
function composeRecommendation(promptNl: string, facts: Facts, absent: boolean, rng: () => number): Composed {
  const picks = [...OTHER_BUSINESSES].sort(() => rng() - 0.5).slice(0, 3).map((n) => `${n} ${facts.place}`);
  const names = absent ? picks : [picks[0]!, facts.name, picks[1]!];
  const lines = names.map((n, i) => `${i + 1}. ${n}`);
  return { text: `Een paar opties in ${facts.place}:\n${lines.join("\n")}\nBel even om te vragen of ze kunnen.`, injected: absent ? "absent from recommendation" : undefined };
}

const hoursText = (h: Hours | undefined, day: number) =>
  !h || h.closed || !h.open || !h.close ? `op ${DAY_NAMES_NL[day]} gesloten` : `op ${DAY_NAMES_NL[day]} open van ${h.open} tot ${h.close}`;

/** A different-but-plausible phone number with the same area code. */
function oldPhone(phone: string, rng: () => number): string {
  const norm = normalizePhone(phone) ?? "+31231234567";
  const digits = norm.slice(3);
  const area = digits.slice(0, 2);
  let rest = "";
  for (let i = 0; i < 7; i++) rest += String(Math.floor(rng() * 10));
  return formatPhoneNl(`+31${area}${rest}`);
}

interface Composed {
  text: string;
  /** Short description of the injected error, for debugging only. */
  injected?: string;
}

/** Build the answer for one probe; `wrong` flips the fact. */
function compose(category: FactKey, probe: string, facts: Facts, wrong: boolean, rng: () => number, engine: Engine): Composed {
  const { name, place } = facts;
  const subject = probe.includes(":") ? probe.slice(probe.indexOf(":") + 1) : probe.includes(".") ? probe.slice(probe.indexOf(".") + 1) : null;
  const intro = engine === "google_ai" ? "" : rng() < 0.5 ? `${name} in ${place}: ` : "";

  switch (category) {
    case "existence": {
      if (wrong) {
        return facts.openStatus === "permanently_closed"
          ? { text: `${intro}Ja, ${name} in ${place} is gewoon open en ontvangt klanten.`, injected: "open" }
          : { text: `${name} in ${place} is permanent gesloten. De zaak lijkt niet meer actief te zijn.`, injected: "permanently_closed" };
      }
      if (facts.openStatus === "permanently_closed") return { text: `${name} in ${place} is definitief gesloten.` };
      if (facts.openStatus === "temporarily_closed") return { text: `${name} in ${place} is tijdelijk gesloten.` };
      return { text: `${intro}Ja, ${name} in ${place} is nog gewoon open. Je kunt er terecht tijdens de openingstijden.` };
    }
    case "hours": {
      if (subject == null) {
        // General opening-hours prompt: list every day the facts know about.
        const lines = facts.hours.map((h) => {
          const flip = wrong && h.day === 6;
          return flip ? `op ${DAY_NAMES_NL[6]} gesloten` : hoursText(h, h.day);
        });
        return { text: `De openingstijden van ${name} in ${place} zijn: ${lines.join(", ")}.`, injected: wrong ? "hours.6=closed" : undefined };
      }
      const day = Number(subject);
      const h = facts.hours.find((x) => x.day === day);
      if (!wrong) return { text: `${intro}${name} is ${hoursText(h, day)}.` };
      if (!h || h.closed) return { text: `${intro}${name} is op ${DAY_NAMES_NL[day]} open van 10:00 tot 16:00.`, injected: "10:00-16:00" };
      if (rng() < 0.6) return { text: `${name} in ${place} is op ${DAY_NAMES_NL[day]} gesloten.`, injected: "closed" };
      return { text: `${intro}${name} is op ${DAY_NAMES_NL[day]} open van 09:00 tot 17:00.`, injected: "09:00-17:00" };
    }
    case "phone": {
      const phone = facts.phone ? formatPhoneNl(normalizePhone(facts.phone) ?? facts.phone) : null;
      if (!phone) return { text: `Ik kon geen telefoonnummer vinden van ${name} in ${place}.` };
      if (wrong) return { text: `Het telefoonnummer van ${name} in ${place} is ${oldPhone(phone, rng)}.`, injected: "old phone" };
      return { text: `${intro}Je bereikt ${name} op ${phone}.` };
    }
    case "address": {
      const addr = facts.address ?? `Hoofdstraat 1`;
      const pc = facts.postcode ? ` ${facts.postcode}` : "";
      if (wrong) {
        const bumped = addr.replace(/(\d+)/, (m) => String(Number(m) + 2 + Math.floor(rng() * 20)));
        return { text: `${name} zit op ${bumped},${pc} ${place}.`, injected: "wrong house number" };
      }
      return { text: `${intro}Het adres is ${addr},${pc} ${place}.` };
    }
    case "website": {
      const site = facts.website ?? `https://www.${slugify(name)}.nl`;
      if (wrong) return { text: `De website van ${name} is https://www.${slugify(name)}-${slugify(place)}.com.`, injected: "wrong domain" };
      return { text: `${intro}De website van ${name} is ${site}.` };
    }
    case "service": {
      const s = subject ?? "";
      const yes = facts.servicesYes.some((x) => x.toLowerCase() === s.toLowerCase());
      const says = wrong ? !yes : yes;
      return says
        ? { text: `Ja, ${name} in ${place} doet ook ${s}. Neem contact op voor de mogelijkheden.`, injected: wrong ? "service yes" : undefined }
        : { text: `Nee, ${name} in ${place} biedt geen ${s} aan.`, injected: wrong ? "service no" : undefined };
    }
    case "price": {
      const p = facts.prices.find((x) => x.label.toLowerCase() === (subject ?? "").toLowerCase());
      if (!p) return { text: `Ik kon geen prijs vinden voor ${subject} bij ${name}.` };
      const amount = wrong ? Math.round(p.amount * 1.25 * 100) / 100 : p.amount;
      return { text: `${subject} kost bij ${name} in ${place} € ${amount.toFixed(2).replace(".", ",")}${p.unit ? ` ${p.unit}` : ""}.`, injected: wrong ? "price" : undefined };
    }
    case "policy": {
      return wrong
        ? { text: `Nee, dat geldt niet bij ${name} in ${place}.`, injected: "policy no" }
        : { text: `Ja, bij ${name} in ${place} geldt: ${subject}.` };
    }
    case "payment": {
      return wrong
        ? { text: `Nee, bij ${name} in ${place} kun je alleen contant betalen.`, injected: "payment no" }
        : { text: `Ja, bij ${name} in ${place} kun je gewoon pinnen.` };
    }
    case "area": {
      const where = subject ?? place;
      const inArea = facts.serviceArea ? facts.serviceArea.places.some((p) => p.toLowerCase() === where.toLowerCase()) || where.toLowerCase() === place.toLowerCase() : true;
      const says = wrong ? !inArea : inArea;
      return says
        ? { text: `Ja, ${name} werkt ook in ${where} en omgeving.`, injected: wrong ? "area yes" : undefined }
        : { text: `Nee, ${name} komt niet in ${where}. Ze werken alleen in ${place}.`, injected: wrong ? "area no" : undefined };
    }
    case "urgency": {
      const has = facts.urgency?.available ?? false;
      const says = wrong ? !has : has;
      return says
        ? { text: `Ja, ${name} in ${place} heeft een spoeddienst${facts.urgency?.hoursNl ? ` (${facts.urgency.hoursNl})` : ""}.`, injected: wrong ? "urgency yes" : undefined }
        : { text: `Nee, ${name} in ${place} heeft geen spoeddienst. Je kunt alleen op afspraak terecht.`, injected: wrong ? "urgency no" : undefined };
    }
    case "credential": {
      const c = subject ?? "";
      const has = facts.credentials?.some((x) => x.toLowerCase() === c.toLowerCase()) ?? false;
      const says = wrong ? !has : has;
      return says
        ? { text: `Ja, ${name} in ${place} heeft ${c}.`, injected: wrong ? "credential yes" : undefined }
        : { text: `Nee, ${name} in ${place} heeft geen ${c}, voor zover bekend.`, injected: wrong ? "credential no" : undefined };
    }
    case "identity": {
      const other = subject ?? "een naamgenoot";
      return wrong
        ? { text: `Ja, dat is hetzelfde bedrijf. ${name} heeft ook een vestiging daar.`, injected: "identity yes" }
        : { text: `Nee, ${name} in ${place} is een ander bedrijf dan ${other}.` };
    }
    // Product-line keys (feature 006): the mock answers for them come with the line scan (BE-04).
    case "spec":
    case "certificate":
    case "outlet":
    case "successor":
      return { text: `Ik weet niet genoeg over ${name} om dit te beantwoorden.` };
  }
}


// ---------------------------------------------------------------------------
// Product lines (feature 006): deterministic answers, with the same wrong-pair rate as a business
// ---------------------------------------------------------------------------

/** Made-up products and shops the mock AI names instead (never a real retailer or brand). */
const OTHER_PRODUCTS = ["Studio Alfa", "Merk Beta", "Gamma Producten", "Delta Huismerk"];
const UNLISTED_OUTLETS = ["Voorbeeldmarkt Noord", "Winkel Zonder Naam", "Marktplaats Gamma"];
const NEW_NAMES = ["Nieuwe Variant X", "Opvolger Y"];

/** A numeric spec value moved by a quarter, or a text value replaced: the wrong value of a spec answer. */
function wrongSpec(value: string): string {
  const norm = normalizeSpecValue(value);
  const m = /^(\d+(?:\.\d+)?)(?: (.+))?$/.exec(norm);
  if (!m) return "onbekend";
  const n = Math.round(Number(m[1]) * 1.25 * 100) / 100;
  return m[2] ? `${n} ${m[2]}` : String(n);
}

function composeLine(category: FactKey, probe: string, facts: Facts, view: LineFactsView, wrong: boolean, rng: () => number, recommendation: boolean): Composed {
  const nl = scanLang(view.market) === "nl";
  const name = facts.name;
  const subject = probe.includes(":") ? probe.slice(probe.indexOf(":") + 1) : "";
  const named = `${name} (${view.brand})`;
  if (recommendation) {
    const others = [...OTHER_PRODUCTS].sort(() => rng() - 0.5).slice(0, 3);
    const list = wrong ? others : [others[0]!, named, others[1]!];
    return { text: `${nl ? "Een paar opties" : "A few options"}:\n${list.map((n, i) => `${i + 1}. ${n}`).join("\n")}`, injected: wrong ? "absent from recommendation" : undefined };
  }
  switch (category) {
    case "spec": {
      const spec = view.specs.find((s) => s.label.toLowerCase() === subject.toLowerCase());
      if (!spec) return { text: nl ? `Ik kon geen ${subject} vinden voor ${name}.` : `I couldn't find the ${subject} of ${name}.` };
      const value = wrong ? wrongSpec(spec.value) : spec.value;
      return { text: nl ? `${name} heeft ${subject.toLowerCase()} ${value}.` : `${name} has a ${subject.toLowerCase()} of ${value}.`, injected: wrong ? `spec ${value}` : undefined };
    }
    case "certificate": {
      const cert = view.certificates.find((c) => c.name.toLowerCase() === subject.toLowerCase());
      const yes = cert ? cert.valid : false;
      const says = wrong ? !yes : yes;
      return says
        ? { text: nl ? `Ja, ${name} is ${subject}-gecertificeerd.` : `Yes, ${name} is ${subject} certified.`, injected: wrong ? "certificate yes" : undefined }
        : { text: nl ? `Nee, ${name} is niet ${subject}-gecertificeerd.` : `No, ${name} is not ${subject} certified.`, injected: wrong ? "certificate no" : undefined };
    }
    case "outlet": {
      const listed = view.outlets.map((o) => o.name);
      const names = wrong ? [...listed, UNLISTED_OUTLETS[Math.floor(rng() * UNLISTED_OUTLETS.length)]!] : listed;
      return { text: `${nl ? `Je kunt ${name} kopen bij` : `You can buy ${name} at`}:\n${names.map((n, i) => `${i + 1}. **${n}**`).join("\n")}`, injected: wrong ? "outlet not in list" : undefined };
    }
    case "successor": {
      if (!wrong) return { text: nl ? `De opvolger van ${subject} is ${name}.` : `The successor of ${subject} is ${name}.` };
      const other = NEW_NAMES[Math.floor(rng() * NEW_NAMES.length)]!;
      return rng() < 0.5
        ? { text: nl ? `${subject} is nog steeds verkrijgbaar; er is geen opvolger.` : `${subject} is still sold; there is no successor.`, injected: "old name as current" }
        : { text: nl ? `De opvolger van ${subject} is ${other}.` : `The successor of ${subject} is ${other}.`, injected: "other successor" };
    }
    default:
      return { text: nl ? `Ik weet niet genoeg over ${name} om dit te beantwoorden.` : `I don't know enough about ${name} to answer that.` };
  }
}

function minimalFacts(ctx: AskContext): Facts {
  return (
    ctx.facts ?? {
      businessId: ctx.business.id,
      version: 0,
      verifiedAt: null,
      provisional: true,
      name: ctx.business.name,
      place: ctx.business.place,
      address: null,
      postcode: null,
      phone: null,
      email: null,
      website: ctx.business.domain ? `https://${ctx.business.domain}` : null,
      openStatus: "open",
      hours: [],
      servicesYes: [],
      servicesNo: [],
      prices: [],
      policies: [],
      paymentMethods: [],
      notConfusedWith: [],
    }
  );
}

export interface MockEngineOptions {
  /** Share of (prompt, engine) pairs that carry a wrong value (default 0.35; 0 = always correct). */
  wrongPairRate?: number;
  otherEntityRate?: number;
}

export function createMockEngine(engine: Engine, options: MockEngineOptions = {}): EngineClient {
  const wrongPairRate = options.wrongPairRate ?? WRONG_PAIR_RATE;
  const otherEntityRate = options.otherEntityRate ?? OTHER_ENTITY_RATE;
  return {
    engine,
    available: () => true,
    async ask(promptNl: string, ctx: AskContext): Promise<EngineAnswer> {
      const facts = minimalFacts(ctx);
      const slug = ctx.business.slug || slugify(ctx.business.name, ctx.business.place);
      const sampleIndex = ctx.sampleIndex ?? 0;
      // A prompt probing several fields (the general opening-hours question) gets the general answer.
      const { category, probe } = ctx.prompt
        ? { category: ctx.prompt.category, probe: ctx.prompt.probes.length === 1 ? ctx.prompt.probes[0]! : ctx.prompt.category }
        : inferProbe(promptNl);

      // Seeds use the slug (stable across processes; MemDb ids are fresh UUIDs per run).
      const seedBase = `${slug}|${promptNl}|${engine}`;
      // Pair-level decisions (same for every sample of this prompt+engine).
      const pairRng = seededRandom(seedBase);
      const wrongPair = pairRng() < wrongPairRate;
      const citeRoll = pairRng();
      const otherEntityPair = !wrongPair && pairRng() < otherEntityRate && !facts.productLine;
      const otherCity = OTHER_CITIES[Math.floor(pairRng() * OTHER_CITIES.length)]!;

      // Sample-level decisions.
      const rng = seededRandom(`${seedBase}|${sampleIndex}`);
      if (mockIsUnknownBusiness(slug, facts)) {
        const nfRng = seededRandom(`${seedBase}|${sampleIndex}|notfound`);
        if (nfRng() < NOT_FOUND_SAMPLE_RATE) {
          const lineView = facts.productLine;
          if (lineView) return { answerText: scanLang(lineView.market) === "nl" ? `Ik kan geen informatie vinden over ${facts.name}.` : `I couldn't find any information about ${facts.name}.`, citations: [], costCents: 0 };
          return { answerText: `Ik kan geen informatie vinden over ${facts.name} in ${facts.place}.`, citations: [], costCents: 0 };
        }
      }
      const wrong = wrongPair && rng() < WRONG_SAMPLE_RATE;

      const recommendation = ctx.prompt ? ctx.prompt.kind === "recommendation" : looksLikeRecommendation(promptNl);
      let { text } = facts.productLine
        ? composeLine(category, probe, facts, facts.productLine, wrong, rng, recommendation)
        : recommendation
          ? composeRecommendation(promptNl, facts, wrong, rng)
          : compose(category, probe, facts, wrong, rng, engine);
      if (otherEntityPair) {
        text = text.replaceAll(` in ${facts.place}`, ` in ${otherCity}`) + ` (Let op: dit gaat over ${facts.name} in ${otherCity}.)`;
      }

      const site = facts.website ?? (ctx.business.domain ? `https://${ctx.business.domain}` : null);
      const citations: string[] = [];
      if (wrong) {
        if (facts.productLine) {
          if (citeRoll < 0.5) citations.push(`https://productgids.example/${slug}`);
        } else if (citeRoll < 0.35) citations.push(`https://openingstijden.nl/${slug}`);
        else if (citeRoll < 0.6) citations.push(`https://www.telefoonboek.nl/${slug}`);
        else if (citeRoll < 0.75 && site) citations.push(`${site.replace(/\/$/, "")}/contact`);
        // else: no citation -> model memory
      } else if (citeRoll < 0.5 && site) {
        citations.push(site);
      } else if (citeRoll < 0.65) {
        citations.push(`https://www.google.com/maps/place/${encodeURIComponent(`${facts.name} ${facts.place}`)}`);
      }
      return { answerText: text, citations, costCents: 0 };
    },
  };
}
