/**
 * One interface for every AI engine the scanner samples.
 */
import { HOME_COUNTRY, countryName } from "../../shared/country";
import type { Business, Engine, Facts, Prompt } from "../../types";

export interface AskContext {
  business: Business;
  /** Optional extras; the mock engine uses them to produce plausible answers. */
  facts?: Facts;
  prompt?: Prompt;
  sampleIndex?: number;
}

export interface EngineAnswer {
  answerText: string;
  citations: string[];
  costCents: number;
  /** True when the engine had nothing to say (e.g. no AI Overview shown). The sample is skipped. */
  skipped?: boolean;
}

export interface EngineClient {
  engine: Engine;
  /** Keys present / adapter usable. Unavailable engines are reported as skipped. */
  available(): boolean;
  ask(promptNl: string, ctx: AskContext): Promise<EngineAnswer>;
}

/** System instruction shared by all real engines. */
export const SYSTEM_NL =
  "Je bent een behulpzame assistent voor een gebruiker in Nederland. Antwoord in het Nederlands, kort en feitelijk. " +
  "Noem concrete gegevens (openingstijden, telefoonnummer, adres) als je ze weet en vermeld je bronnen.";

/** The same instruction for a business abroad: an English-speaking user in that country. */
export function systemFor(country: string | null | undefined): string {
  const c = country ?? HOME_COUNTRY;
  if (c === HOME_COUNTRY) return SYSTEM_NL;
  return (
    `You are a helpful assistant for a user in ${countryName(c, "en")}. Answer in English, briefly and factually. ` +
    "Give concrete details (opening hours, phone number, address) when you know them and name your sources."
  );
}

/** Per-engine timeout for one ask(). */
export const ENGINE_TIMEOUT_MS = Number(process.env.ENGINE_TIMEOUT_MS ?? 60_000);
