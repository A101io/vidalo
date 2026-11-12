/** Dutch copy for the owner area (feature 002, lane B): archive, switcher, report-kind words. Wired as copy.ownerArea. */
export const ownerAreaNl = {
  switcher: {
    label: "Bedrijf",
    submit: "Wissel",
    /** The status sentence after switching, and the text next to the select. */
    current: (name: string, place: string) => `Je werkt nu in ${name}, ${place}.`,
  },
  archive: {
    nav: "Rapporten",
    h1: "Rapporten",
    intro: "Elke controle van je bedrijf, de nieuwste bovenaan. Open een rapport om de antwoorden en de bronnen te lezen. Je eigen rapporten blijven voor jou beschikbaar.",
    /** The kind of check, in words. A recheck is not listed. */
    kind: { free: "Gratis controle", baseline: "Eerste volledige controle", monthly: "Maandcontrole", ondemand: "Extra controle" },
    /** What the dot means, written next to it (the dot alone says nothing to a screen reader). Same words as the progress legend. */
    stip: { groen: "Klopt", oranje: "Misleidt", rood: "Stuurt klanten weg", grijs: "Kent je niet of was niet te controleren" },
    state: { queued: "Wacht op zijn beurt", running: "Wordt nu uitgevoerd", failed: "Niet gelukt" },
    counts: (correct: number, answered: number) => `${correct} van ${answered} ${answered === 1 ? "antwoord klopte" : "antwoorden klopten"}`,
    noCounts: "Aantallen volgen",
    open: "Open rapport",
    older: "Oudere rapporten",
    empty: "Nog geen controle afgerond. Zodra je eerste controle klaar is, staat het rapport hier.",
  },
} as const;
