/**
 * A confirmed line turned back into the form's fields (the edit form is prefilled from line.current). Pure and without any
 * server import: the page (server) and the tests use it, the form (client) only receives its result as props.
 */
import type { ProductLineData } from "@vidalo/core/types";
import type { ProductLineFormInput } from "@vidalo/core/shared";

export function toFormInput(data: ProductLineData | null): ProductLineFormInput {
  if (!data) return { name: "", category: "", useCases: "", markets: [], specs: [], certificates: [], outlets: [], replaces: "", replacedBy: "" };
  return {
    name: data.name,
    category: data.category,
    useCases: data.useCases.join("\n"),
    markets: [...data.markets],
    specs: data.specs.map((s) => ({ label: s.label, value: s.value })),
    certificates: data.certificates.map((c) => ({ name: c.name, number: c.number ?? "", validUntil: c.validUntil ?? "" })),
    outlets: data.outlets.map((o) => ({ market: o.market, name: o.name, url: o.url ?? "" })),
    replaces: data.replaces.join("\n"),
    replacedBy: data.replacedBy ?? "",
  };
}
