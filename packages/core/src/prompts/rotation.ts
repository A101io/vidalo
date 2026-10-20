/**
 * The rotating question bank. A full scan asks every core question plus a few
 * from the bank; which few changes every month, so over a few months every
 * phrasing, place and service is asked while the cost per scan stays flat.
 * Seasonal questions ("terras in de zon") only rotate in during their season
 * and then go first.
 */
import { seasonOf, type Prompt } from "../types";

/** Bank questions per full scan. */
export const ROTATE_PER_SCAN = 6;

type BankPrompt = Pick<Prompt, "textNl" | "pool" | "season">;

/** The bank prompts to ask in the month of `now`: in-season seasonal ones first, then a slice that moves each month. */
export function rotatingPrompts<T extends BankPrompt>(prompts: T[], now: Date, perScan = ROTATE_PER_SCAN): T[] {
  const season = seasonOf(now);
  const bank = prompts.filter((p) => p.pool === "bank");
  const seasonal = bank.filter((p) => p.season === season).sort((a, b) => a.textNl.localeCompare(b.textNl));
  const rest = bank.filter((p) => !p.season).sort((a, b) => a.textNl.localeCompare(b.textNl));
  const picked = seasonal.slice(0, perScan);
  const room = perScan - picked.length;
  if (room > 0 && rest.length) {
    const month = now.getUTCFullYear() * 12 + now.getUTCMonth();
    const start = (month * room) % rest.length;
    for (let i = 0; i < Math.min(room, rest.length); i++) picked.push(rest[(start + i) % rest.length]!);
  }
  return picked;
}

/** Core prompts (everything not in the bank) plus this month's bank slice. */
export function promptsForFullScan<T extends BankPrompt>(prompts: T[], now: Date, perScan = ROTATE_PER_SCAN): T[] {
  return [...prompts.filter((p) => p.pool !== "bank"), ...rotatingPrompts(prompts, now, perScan)];
}
