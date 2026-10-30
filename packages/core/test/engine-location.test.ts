import { describe, expect, it } from "vitest";
import { openAiUserLocation, perplexityUserLocation } from "../src/scanner/engines/location";

describe("engine user location", () => {
  it("tells ChatGPT the asker is in the business's town, in the Netherlands", () => {
    expect(openAiUserLocation({ place: "Haarlem" })).toEqual({ type: "approximate", country: "NL", city: "Haarlem", timezone: "Europe/Amsterdam" });
  });
  it("tells Perplexity the same", () => {
    expect(perplexityUserLocation({ place: " Zwolle " })).toEqual({ country: "NL", city: "Zwolle" });
  });
  it("falls back to the country alone when the town is unknown", () => {
    expect(openAiUserLocation({ place: "" })).toEqual({ type: "approximate", country: "NL", timezone: "Europe/Amsterdam" });
    expect(perplexityUserLocation({ place: "" })).toEqual({ country: "NL" });
  });
});
