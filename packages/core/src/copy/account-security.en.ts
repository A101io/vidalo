import type { CopyShape } from "./index.js";

/** English copy for account security (feature 002, lane A). Same shape as ./account-security.ts. */
export const accountSecurityEn: CopyShape["accountSecurity"] = {
  confirmPage: {
    title: "Sign in to Vidalo",
    body: "Click the button to sign in. That way only you use this link, not a program that checks the links in your mail.",
    button: "Sign in",
  },
  signIns: {
    h: "Where you are signed in",
    body: "Your last 10 sign-ins. A sign-in ends after 30 days without use, and at the latest 90 days after signing in.",
    empty: "Nothing to show yet.",
    thisDevice: "this device",
    ended: "signed out",
    open: "signed in",
    line: (browser: string, system: string) => `${browser} on ${system}`,
    browsers: { chrome: "Chrome", safari: "Safari", firefox: "Firefox", edge: "Edge", other: "Another browser" },
    systems: { macos: "a Mac", windows: "Windows", ios: "an iPhone or iPad", android: "Android", linux: "Linux", other: "another system" },
  },
  signOutEverywhere: {
    body: "Sign out on every device where you are signed in with this account, this one included.",
    button: "Sign out everywhere",
  },
  expired: "You are signed out: you had not signed in for a while, or you signed out everywhere on another device. Sign in again below.",
  signedOutEverywhere: "You are signed out on all your devices.",
};
