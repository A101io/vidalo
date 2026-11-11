/** Dutch copy for the owner area (feature 002, lane B): archive, switcher, report-kind words. Wired as copy.ownerArea. */
export const ownerAreaNl = {
  switcher: {
    label: "Bedrijf",
    submit: "Wissel",
    /** The status sentence after switching, and the text next to the select. */
    current: (name: string, place: string) => `Je werkt nu in ${name}, ${place}.`,
  },
} as const;
