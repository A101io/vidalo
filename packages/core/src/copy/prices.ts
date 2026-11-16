/** The plan prices, once. Own file so both languages can build strings from them without an import cycle. */
export const PRICES = {
  setupEur: 149,
  monitorEurPerMonth: 49,
  extraLocationSetupEur: 99,
  extraLocationEurPerMonth: 39,
} as const;
