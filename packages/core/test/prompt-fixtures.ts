import type { Facts, SectorSlug } from "../src/types";
import { sampleFacts } from "./scanner-fixtures";

/** A pinned moment for the bank rotation; never the clock. */
export const SNAPSHOT_NOW = "2026-03-15T12:00:00.000Z";

const weekdays = (closedDays: number[] = [6]): Facts["hours"] =>
  [0, 1, 2, 3, 4, 5, 6].map((day) => (closedDays.includes(day) ? { day, open: null, close: null, closed: true } : { day, open: "09:00", close: "17:30", closed: false }));

export interface QuestionFixture {
  id: string;
  facts: Facts;
  /** What the business row holds as sector (null: none). */
  sector: SectorSlug | null;
}

/**
 * Businesses with a door, as the question snapshot taken on commit 5a1a40e saw them
 * (test/fixtures/questions-5a1a40e.json). Change nothing here without regenerating on that commit.
 */
export const QUESTION_FIXTURES: QuestionFixture[] = [
  { id: "kapper", sector: "kappers-schoonheid", facts: sampleFacts({ name: "Kapsalon Mila", place: "Haarlem", servicesYes: ["knippen", "kleuren"], servicesNo: ["extensions"], prices: [{ label: "knippen dames", amount: 42 }], policies: ["Op afspraak"], hours: weekdays([0, 6]) }) },
  { id: "bakkerij", sector: null, facts: sampleFacts() },
  { id: "horeca", sector: "horeca", facts: sampleFacts({ name: "Restaurant De Gouden Lepel", place: "Utrecht", servicesYes: ["terras", "vegetarisch"], servicesNo: ["afhalen"], prices: [{ label: "driegangenmenu", amount: 38 }], policies: ["Reserveren mogelijk"], hours: weekdays([0]) }) },
  { id: "winkel", sector: "winkels", facts: sampleFacts({ name: "Boekhandel Tuin", place: "Zwolle", servicesYes: ["cadeaubonnen"], servicesNo: ["verzenden"], prices: [], policies: [], hours: weekdays([6]) }) },
  { id: "loodgieter", sector: "loodgieters-installateurs", facts: sampleFacts({ name: "Loodgietersbedrijf Hendriks", place: "Amersfoort", servicesYes: ["cv-ketels", "lekkages"], servicesNo: ["dakwerk"], prices: [{ label: "uurtarief", amount: 65 }], policies: ["Geen voorrijkosten"], hours: weekdays([5, 6]) }) },
  { id: "loodgieter-geen-uren", sector: "loodgieters-installateurs", facts: sampleFacts({ name: "Loodgieter Visser", place: "Delft", servicesYes: ["lekkages"], servicesNo: [], prices: [], policies: [], hours: weekdays([0, 1, 2, 3, 4, 5, 6]) }) },
  { id: "riverside-en", sector: "loodgieters-installateurs", facts: sampleFacts({ name: "Riverside Plumbing", place: "Leeds", country: "GB", address: "12 Kirkgate", postcode: "LS1 6BY", phone: "+44 113 496 0000", servicesYes: ["boiler repair"], servicesNo: ["solar panels"], prices: [{ label: "an hourly rate", amount: 70 }], policies: ["Free quotes"], hours: weekdays([6]) }) },
];
