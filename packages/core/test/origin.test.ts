import { describe, expect, it } from "vitest";
import { safeOrigin } from "../src/shared/origin.js";

const h = (pairs: Record<string, string>) => ({ get: (n: string) => pairs[n.toLowerCase()] ?? null });
const FALLBACK = "https://vidalo.io/";

describe("safeOrigin (return URLs follow the host the visitor is on)", () => {
  it("uses the Origin header on our hosts, including the workers.dev preview and localhost", () => {
    expect(safeOrigin(h({ origin: "https://vidalo.ai" }), FALLBACK)).toBe("https://vidalo.ai");
    expect(safeOrigin(h({ origin: "https://www.vidalo.ai" }), FALLBACK)).toBe("https://www.vidalo.ai");
    expect(safeOrigin(h({ origin: "https://vidalo.io" }), FALLBACK)).toBe("https://vidalo.io");
    expect(safeOrigin(h({ origin: "https://vidalo-web-preview.julian-devriend.workers.dev" }), FALLBACK)).toBe("https://vidalo-web-preview.julian-devriend.workers.dev");
    expect(safeOrigin(h({ origin: "http://localhost:3000" }), FALLBACK)).toBe("http://localhost:3000");
  });

  it("falls back to the Referer when there is no Origin", () => {
    expect(safeOrigin(h({ referer: "https://vidalo.io/en/pricing?x=1" }), FALLBACK)).toBe("https://vidalo.io");
  });

  it("control: a foreign or lookalike host never wins", () => {
    expect(safeOrigin(h({ origin: "https://vidalo.io.example.com" }), FALLBACK)).toBe("https://vidalo.io");
    expect(safeOrigin(h({ origin: "https://vidalo.ai.example.com" }), FALLBACK)).toBe("https://vidalo.io");
    expect(safeOrigin(h({ origin: "https://evil.example", referer: "https://evil.example/x" }), FALLBACK)).toBe("https://vidalo.io");
    expect(safeOrigin(h({ origin: "javascript:alert(1)" }), FALLBACK)).toBe("https://vidalo.io");
    expect(safeOrigin(h({}), FALLBACK)).toBe("https://vidalo.io");
  });
});
