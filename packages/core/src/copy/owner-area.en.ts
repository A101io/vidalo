import type { CopyShape } from "./index.js";

/** English copy for the owner area (feature 002, lane B). Same shape as ./owner-area.ts. */
export const ownerAreaEn: CopyShape["ownerArea"] = {
  switcher: {
    label: "Business",
    submit: "Switch",
    current: (name, place) => `You are now working in ${name}, ${place}.`,
  },
  archive: {
    nav: "Reports",
    h1: "Reports",
    intro: "Every check of your business, newest first. Open a report to read the answers and the sources. Your own reports stay available to you.",
    kind: { free: "Free check", baseline: "First full check", monthly: "Monthly check", ondemand: "Extra check" },
    stip: { groen: "Correct", oranje: "Misleading", rood: "Sends customers away", grijs: "Does not know you, or could not be checked" },
    state: { queued: "Waiting its turn", running: "Running now", failed: "Did not succeed" },
    counts: (correct, answered) => `${correct} of ${answered} ${answered === 1 ? "answer was correct" : "answers were correct"}`,
    noCounts: "Counts to follow",
    open: "Open report",
    older: "Older reports",
    empty: "No finished check yet. As soon as your first check is done, its report is listed here.",
  },
};
