/**
 * CLI: write the question library to out/library.md (what Julian reads).
 *
 *   pnpm library [--out out/library.md]
 *
 * Reads Db.questionLibrary(): MemDb with VIDALO_MOCK=1, PgDb with DATABASE_URL. Stopped (retired)
 * templates come first, then one table per category. Shares are "n van m" plus a status word, never a
 * bare percentage. Templates only: the ledger holds no business names (ADR-0004).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../db";
import type { LibraryRow } from "../db";
import { libraryStatus, RETIRABLE_FAMILIES, type LibraryStatus } from "../prompts/library";

const STATUS_WORD: Record<LibraryStatus, string> = { proven: "bewezen", trial: "in proef", retired: "gestopt" };
/** Fixed questions, and everything asked of a shop or a visit business, are never picked or stopped: they only get counted. */
const FIXED = "vaste vraag";
const isFixed = (r: LibraryRow) => r.mode !== "online" || !RETIRABLE_FAMILIES.has(r.family);
const MODE_WORD: Record<LibraryRow["mode"], string> = { door: "winkel", visit: "aan huis", online: "online" };

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/** The markdown file. Pure: the same rows give the same text. */
export function libraryMarkdown(rows: LibraryRow[]): string {
  const withStatus = rows.map((r) => ({ r, status: libraryStatus(r) }));
  const word = (r: LibraryRow, status: LibraryStatus) => (isFixed(r) ? FIXED : STATUS_WORD[status]);
  const asked = (r: LibraryRow) => `${r.asked} keer, ${r.businesses} ${r.businesses === 1 ? "bedrijf" : "bedrijven"}`;
  const usable = (r: LibraryRow) => `${r.usable} van ${r.asked}`;
  const line = (r: LibraryRow, status: LibraryStatus, withCategory: boolean) =>
    `| ${withCategory ? `${cell(r.category)} | ` : ""}${cell(r.templateNl)} | ${MODE_WORD[r.mode]} | ${asked(r)} | ${usable(r)} | ${word(r, status)} |`;
  const out: string[] = ["# Vraagbibliotheek", ""];
  out.push("Wat elke vraag opleverde. Bruikbaar = het antwoord noemt het bedrijf of een ander bedrijf (aanbevelingen), of is een beoordeelbaar antwoord (feiten). Bewezen: gevraagd bij minstens 5 verschillende bedrijven en minstens 6 van de 10 bruikbaar. Gestopt: gevraagd bij minstens 10 verschillende bedrijven en minder dan 3 van de 10 bruikbaar; in die categorie wordt de vraag niet meer gesteld. Alleen online aanbevelingsvragen en alternatieven kunnen bewezen of gestopt zijn; de vaste vragen (bestaat, wat doet, website, telefoon) en alles wat aan winkels en bezoekbedrijven gevraagd wordt, worden alleen geteld.", "");
  const retired = withStatus.filter((x) => x.status === "retired");
  out.push("## Gestopt", "");
  if (!retired.length) out.push("Nog geen vraag gestopt.", "");
  else {
    out.push("| categorie | vraag | modus | gevraagd | bruikbaar | status |", "|---|---|---|---|---|---|");
    for (const x of retired) out.push(line(x.r, x.status, true));
    out.push("");
  }
  const cats = [...new Set(rows.map((r) => r.category))].sort((a, b) => a.localeCompare(b, "nl"));
  if (!cats.length) out.push("De bibliotheek is nog leeg: er is nog geen controle afgerond.", "");
  for (const c of cats) {
    out.push(`## ${cell(c)}`, "", "| vraag | modus | gevraagd | bruikbaar | status |", "|---|---|---|---|---|");
    const mine = withStatus.filter((x) => x.r.category === c).sort((a, b) => a.r.mode.localeCompare(b.r.mode) || b.r.asked - a.r.asked || a.r.templateKey.localeCompare(b.r.templateKey));
    for (const x of mine) out.push(line(x.r, x.status, false));
    out.push("");
  }
  return out.join("\n");
}

async function main() {
  const i = process.argv.indexOf("--out");
  // pnpm runs this inside packages/core; INIT_CWD is where the command was typed (the repo root).
  const base = process.env.INIT_CWD ?? process.cwd();
  const file = path.resolve(base, i > -1 && process.argv[i + 1] ? process.argv[i + 1]! : "out/library.md");
  const rows = await db.questionLibrary();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, libraryMarkdown(rows), "utf8");
  console.log(file);
  await db.close();
}

if (process.argv[1] && /library\.ts$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(String((err as Error)?.message ?? err));
    process.exit(1);
  });
}
