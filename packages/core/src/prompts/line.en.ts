/**
 * The questions asked about a product line in a market whose scan language is English (every market but NL,
 * `scanLang`). Same keys in the same order as `line.ts`, with the same meta (kind, category, probe, criterium)
 * and the same slot names; only the wording differs. test/line-prompts-en.test.ts keeps the two in step.
 * No article logic: English needs none.
 */
import type { LineTemplate } from "./line";

export const LINE_TEMPLATES_EN: readonly LineTemplate[] = [
  { key: "line.rec.use", text: "Which {category} is best for {use}?", kind: "recommendation", category: "existence", probe: "existence:{use}", criterium: 6 },
  { key: "line.rec.quality", text: "What is the best {category}?", kind: "recommendation", category: "existence", probe: "existence:beste", criterium: 6 },
  { key: "line.spec", text: "What {spec} does {name}{brand} have?", kind: "about", category: "spec", probe: "spec:{spec_label}", criterium: 13 },
  { key: "line.cert", text: "Is {name}{brand} {certificate} certified?", kind: "about", category: "certificate", probe: "certificate:{certificate}", criterium: 14 },
  { key: "line.outlet", text: "Where can I buy {name}{brand} in {country}?", kind: "about", category: "outlet", probe: "outlet:{market}", criterium: 15 },
  { key: "line.successor", text: "What is the successor of {old}{brand}?", kind: "about", category: "successor", probe: "successor:{old}", criterium: 16 },
];
