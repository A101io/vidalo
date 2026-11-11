/** Dutch copy for account security (feature 002, lane A): sign-ins, sign-out everywhere, deletion. Wired as copy.accountSecurity. */
export const accountSecurityNl = {
  /** /auth/confirm: the mail link opens this page; the button signs in (ADR-0003). */
  confirmPage: {
    title: "Inloggen bij Vidalo",
    body: "Klik op de knop om in te loggen. Zo gebruikt alleen jij deze link, en niet een programma dat je mail op links controleert.",
    button: "Inloggen",
  },
  /** /app/account, section "Inloggen": the last 10 sign-ins. */
  signIns: {
    h: "Waar je bent ingelogd",
    body: "Je laatste 10 keer inloggen. Een inlog vervalt na 30 dagen zonder gebruik en uiterlijk 90 dagen na het inloggen.",
    empty: "Nog niets te zien.",
    thisDevice: "dit apparaat",
    ended: "uitgelogd",
    open: "ingelogd",
    line: (browser: string, system: string) => `${browser} op ${system}`,
    browsers: { chrome: "Chrome", safari: "Safari", firefox: "Firefox", edge: "Edge", other: "Een andere browser" },
    systems: { macos: "een Mac", windows: "Windows", ios: "een iPhone of iPad", android: "Android", linux: "Linux", other: "een ander systeem" },
  },
  signOutEverywhere: {
    body: "Log uit op elk apparaat waar je met dit account bent ingelogd, ook op dit apparaat.",
    button: "Overal uitloggen",
  },
  /** /app/google: ending the connection (AC-5e). */
  google: {
    h: "Koppeling met Google verbreken",
    body: "Vidalo houdt je Google-bedrijfsprofiel dan niet meer bij en past het niet meer aan. We trekken de toegang bij Google in en verwijderen de sleutel. Dat je hebt bewezen dat je de eigenaar bent, blijft vastgelegd.",
    button: "Koppeling verbreken",
    done: "De koppeling met Google is verbroken.",
    none: "Er was geen koppeling met Google om te verbreken.",
    failed: "Google gaf geen antwoord. Er is niets veranderd; probeer het later opnieuw.",
  },
  /** /inloggen?opnieuw=1: deleting everything and changing the address need a sign-in from the last 15 minutes. */
  reSignIn: "Voor deze stap log je eerst opnieuw in. We sturen je een nieuwe inloglink; daarmee kom je terug waar je was.",
  /** /inloggen?fout=verlopen, and when this browser's sign-in ended. */
  expired: "Je bent uitgelogd: je was een tijd niet ingelogd, of je logde ergens anders overal uit. Log hieronder opnieuw in.",
  /** /inloggen?uitgelogd=overal */
  signedOutEverywhere: "Je bent op al je apparaten uitgelogd.",
} as const;
