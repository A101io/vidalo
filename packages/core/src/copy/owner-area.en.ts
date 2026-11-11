import type { CopyShape } from "./index.js";

/** English copy for the owner area (feature 002, lane B). Same shape as ./owner-area.ts. */
export const ownerAreaEn: CopyShape["ownerArea"] = {
  switcher: {
    label: "Business",
    submit: "Switch",
    current: (name, place) => `You are now working in ${name}, ${place}.`,
  },
};
