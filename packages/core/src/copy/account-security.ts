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
  /** /app/account/verwijderen (AC-5b, F-014): what goes, what stays, money, then one button. */
  deletion: {
    h: "Alles verwijderen",
    intro: (name: string) => `Je staat op het punt alles van ${name} bij Vidalo te verwijderen.`,
    goesH: "Wat we verwijderen",
    goes: "De gegevens van je bedrijf, je controles en rapporten, je feitenpagina en het adres ervan, en de koppeling met Google, die we ook bij Google intrekken. Hoort er geen ander bedrijf bij je inlog, dan verwijderen we ook je inlog.",
    staysH: "Wat blijft",
    stays: "Je facturen, 7 jaar bij Stripe, omdat de wet dat vraagt. Wat al bij Google, gidsen of andere websites is hersteld, blijft daar staan.",
    moneyH: "Je geld",
    monthlyAt: (date: string) => `Je abonnement op Vidalo Monthly loopt nog. We zeggen het op tegen ${date} en verwijderen alles op die dag. Het bedrag voor de lopende maand krijg je niet terug. Tot ${date} kun je het verwijderen terugdraaien.`,
    monthlyNext: "Je abonnement op Vidalo Monthly loopt nog. We zeggen het op tegen het einde van de lopende maand en verwijderen alles op die dag; de datum zie je daarna hier en in je mail. Het bedrag voor de lopende maand krijg je niet terug. Tot die dag kun je het verwijderen terugdraaien.",
    scan: "Het bedrag voor Vidalo Scan krijg je niet terug, omdat we al voor je aan het werk zijn gegaan. Konden we binnen 30 dagen niet vaststellen dat jij de eigenaar bent? Vraag dan eerst je geld terug via support@vidalo.io, en verwijder daarna.",
    invoices: "Na het verwijderen kun je je facturen niet meer in je account downloaden. Download ze dus eerst.",
    invoicesButton: "Facturen downloaden",
    confirm: (name: string) => `Ja, verwijder alles van ${name}`,
    button: "Verwijder alles",
    back: "Terug naar je account",
    link: "Alles verwijderen",
    scheduled: (date: string) => `Je gegevens worden op ${date} verwijderd.`,
    keep: "Toch bewaren",
    keepNote: "Je opzegging blijft dan staan; die draai je terug onder ‘Abonnement’. Draai je de opzegging terug, dan blijven je gegevens ook bewaard.",
    status: {
      gepland: "Je abonnement is opgezegd en je gegevens worden op de einddatum verwijderd. Je kreeg er een mail over.",
      bewaard: "Je gegevens blijven bewaard.",
      fout: "Opzeggen lukte niet, dus er is niets ingepland. Probeer het opnieuw of mail support@vidalo.io.",
      bezig: "We verwijderen je gegevens. Je krijgt een mail zodra het klaar is.",
    } as Record<string, string>,
  },
  /** /app/abonnement after the subscription ended (AC-6, B2). */
  endState: {
    h: "Je abonnement is afgelopen",
    stopped: "We controleren niet meer wat AI over je bedrijf zegt, we herstellen geen fouten meer en we werken je gegevens bij gidsen niet meer bij. Je feitenpagina stuurt bezoekers door naar je eigen website.",
    until: (date: string, reminder: boolean) => `Je rapporten blijven tot ${date} te zien in je account. Op ${date} verwijderen we je gegevens.${reminder ? " 14 dagen vooraf krijg je een herinnering per e-mail." : ""}`,
    google: "De koppeling met Google is verbroken; de toegang hebben we bij Google ingetrokken.",
  },
  /** /inloggen?opnieuw=1: deleting everything and changing the address need a sign-in from the last 15 minutes. */
  reSignIn: "Voor deze stap log je eerst opnieuw in. We sturen je een nieuwe inloglink; daarmee kom je terug waar je was.",
  /** /inloggen?fout=verlopen, and when this browser's sign-in ended. */
  expired: "Je bent uitgelogd: je was een tijd niet ingelogd, of je logde ergens anders overal uit. Log hieronder opnieuw in.",
  /** /inloggen?uitgelogd=overal */
  signedOutEverywhere: "Je bent op al je apparaten uitgelogd.",
} as const;
