import { describe, expect, it } from "vitest";
import { readPerplexityResponse } from "../src/scanner/engines/perplexity";

describe("perplexity agent response", () => {
  it("reads the answer, both kinds of source and the reported cost", () => {
    const answer = readPerplexityResponse({
      output: [
        { type: "search_results", results: [{ url: "https://a.nl/" }, { url: "https://b.nl/" }] },
        { type: "message", content: [{ type: "output_text", text: " Open tot 18:00. ", annotations: [{ type: "citation", url: "https://a.nl/" }, { type: "citation", url: "https://c.nl/" }] }] },
      ],
      usage: { input_tokens: 900, output_tokens: 120, cost: { total_cost: 0.00214 } },
    });
    expect(answer).toEqual({ answerText: "Open tot 18:00.", citations: ["https://a.nl/", "https://b.nl/", "https://c.nl/"], costCents: 0.21 });
  });
  it("estimates the cost when the response carries none", () => {
    const answer = readPerplexityResponse({ output: [], usage: { input_tokens: 1000, output_tokens: 0 } });
    expect(answer.answerText).toBe("");
    expect(answer.costCents).toBe(0.2);
  });
});
