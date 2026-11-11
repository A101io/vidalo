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

export function sanitizeSlot(raw: string, slot: SlotKind): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.normalize("NFC");
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
