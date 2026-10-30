import { describe, expect, it } from "vitest";
import { openAiUserLocation, perplexityUserLocation } from "../src/scanner/engines/location";

describe("engine user location", () => {
  it("tells ChatGPT the asker is in the business's town, in the Netherlands", () => {
    expect(openAiUserLocation({ place: "Haarlem", country: "NL" })).toEqual({ type: "approximate", country: "NL", city: "Haarlem", timezone: "Europe/Amsterdam" });
  });
  it("tells Perplexity the same", () => {
    expect(perplexityUserLocation({ place: " Zwolle ", country: "NL" })).toEqual({ country: "NL", city: "Zwolle" });
  });
  it("falls back to the country alone when the town is unknown", () => {
    expect(openAiUserLocation({ place: "", country: "NL" })).toEqual({ type: "approximate", country: "NL", timezone: "Europe/Amsterdam" });
    expect(perplexityUserLocation({ place: "", country: "NL" })).toEqual({ country: "NL" });
  });
  it("uses the business's own country abroad, without the Dutch timezone", () => {
    expect(openAiUserLocation({ place: "Leeds", country: "GB" })).toEqual({ type: "approximate", country: "GB", city: "Leeds" });
    expect(perplexityUserLocation({ place: "Leeds", country: "GB" })).toEqual({ country: "GB", city: "Leeds" });
  });
});
