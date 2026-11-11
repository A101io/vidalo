/**
 * The only producer of slot values for questions (ADR-0003). Anything that came from outside
 * (a model's lookup, an owner's form field) is cleaned here or refused; a template whose slot
 * is refused is skipped. Never throws.
 */
export type SlotKind = "name" | "category" | "audience" | "offer" | "competitor";

export const SLOT_LIMIT: Record<SlotKind, number> = { name: 80, category: 60, audience: 80, offer: 120, competitor: 60 };

const INSTRUCTION_WORDS = [
  "negeer", "vergeet", "instructie", "systeem", "prompt", "opdracht",
  "ignore", "disregard", "forget", "instruction", "system", "assistant",
  "je bent", "you are", "act as",
];
const INSTRUCTION_RE = new RegExp(`(?<![\\p{L}\\d])(?:${INSTRUCTION_WORDS.map((w) => w.replace(/ /g, "\\s+")).join("|")})(?![\\p{L}\\d])`, "iu");
const DOMAIN_RE = /\b[\p{L}\d-]+\.[a-z]{2,}\b/iu;

/**
 * Normalise before any test (security S-01): NFKC folds fullwidth "＜" and "：／／" to "<" and "://",
 * and the control, format and zero-width characters are removed (tabs and line breaks become a space),
 * so "ign\u200bore" is "ignore" when the refused words are looked for. The raw text is capped first
 * (S-02), so no regex below runs on more than four slot lengths.
 */
function plainText(raw: string, limit: number): string | null {
  // Bidi overrides make "x.io" read as "xoi.x" in a stored string; no slot has a use for them.
  if (/[\u202a-\u202e\u2066-\u2069]/.test(raw.slice(0, limit * 4))) return null;
  return raw
    .slice(0, limit * 4)
    .normalize("NFKC")
    .replace(/[\t\n\r\u0085\u2028\u2029]/g, " ")
    .replace(/[\p{Cc}\p{Cf}\u00ad\u200b-\u200f\u2060-\u2064\ufeff]/gu, "");
}

export function sanitizeSlot(raw: string, slot: SlotKind): string | null {
  if (typeof raw !== "string") return null;
  const text = plainText(raw, SLOT_LIMIT[slot]);
  if (text === null) return null;
  if (/[<>]/.test(text) || text.includes("://") || /www\./i.test(text)) return null;
  if (slot !== "name" && DOMAIN_RE.test(text)) return null;
  if (INSTRUCTION_RE.test(text)) return null;
  const cleaned = text
    .replace(/[^\p{L}\p{N} &'\-.]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if ((cleaned.match(/\p{L}/gu) ?? []).length < 2) return null;
  const limit = SLOT_LIMIT[slot];
  if (cleaned.length <= limit) return cleaned;
  const cut = cleaned.slice(0, limit + 1);
  // cut at a word boundary: drop the partial word, unless the text is one long word
  const at = cut.lastIndexOf(" ");
  const out = (at > 0 ? cut.slice(0, at) : cleaned.slice(0, limit)).trim();
  return (out.match(/\p{L}/gu) ?? []).length < 2 ? null : out;
}

// ---------------------------------------------------------------------------
// Slot values and template filling (ADR-0003). A question is a code-held template plus values
// that came out of sanitizeSlot(); fillTemplate() takes nothing else.
// ---------------------------------------------------------------------------

declare const SLOT_BRAND: unique symbol;
/** A string that went through sanitizeSlot (or was derived from one in code). Only slotValue/deriveSlot make one. */
export type SlotValue = string & { readonly [SLOT_BRAND]: true };

/** Clean a raw value into a slot value, or refuse (null). */
export function slotValue(raw: string | null | undefined, slot: SlotKind): SlotValue | null {
  if (raw == null) return null;
  return sanitizeSlot(raw, slot) as SlotValue | null;
}

/** A grammar form of an existing slot value ("de beste aanbieder van …"); code-made, so it keeps the brand. */
export function deriveSlot(base: SlotValue, fn: (clean: string) => string): SlotValue {
  return fn(base) as SlotValue;
}

/**
 * Put values into `{placeholder}` places. Returns null when a place has no value, so a template
 * whose slot was refused is skipped instead of asked with a hole.
 */
export function fillTemplate(template: string, values: Readonly<Record<string, SlotValue | null | undefined>>): string | null {
  let missing = false;
  const out = template.replace(/\{([^{}]+)\}/g, (_m, key: string) => {
    const v = values[key];
    if (v == null) {
      missing = true;
      return "";
    }
    return v;
  });
  return missing ? null : out;
}
