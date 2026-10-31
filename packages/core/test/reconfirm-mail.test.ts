import { describe, expect, it } from "vitest";
import { reconfirmEmail } from "../src/reporter/reconfirm";

describe("reconfirmEmail", () => {
  const m = reconfirmEmail({ business: { name: "Bakkerij De Vries" }, confirmedAt: "2025-10-24T09:00:00.000Z", years: 1, confirmFactsUrl: "https://vidalo.io/app/gegevens" });

  it("asks once, calmly, with one button to the facts form", () => {
    expect(m.subject).toBe("Klopt dit nog? De gegevens van Bakkerij De Vries");
    expect(m.text).toContain("24 oktober 2025");
    expect(m.text).toContain("een jaar geleden");
    expect(m.text).toContain("https://vidalo.io/app/gegevens");
    expect(`${m.subject}${m.text}`).not.toContain("!");
    expect(m.html.match(/<a href=/g)).toHaveLength(1);
    expect(m.html).toContain('<a href="https://vidalo.io/app/gegevens" style="display:inline-block;background:#2563eb');
    expect(m.html).toContain('data-brand="vidalo"');
  });

  it("counts the years when nobody answered last year", () => {
    expect(reconfirmEmail({ business: { name: "X" }, confirmedAt: "2024-10-24T09:00:00.000Z", years: 2, confirmFactsUrl: "https://vidalo.io/app/gegevens" }).text).toContain("2 jaar geleden");
  });

  it("speaks English to an owner who chose English", () => {
    const en = reconfirmEmail({ business: { name: "Bakkerij De Vries" }, confirmedAt: "2025-10-24T09:00:00.000Z", years: 1, confirmFactsUrl: "https://vidalo.io/en/app/gegevens", lang: "en" });
    expect(en.subject).toBe("Still right? The details of Bakkerij De Vries");
    expect(en.text.startsWith("Hi,")).toBe(true);
    expect(en.text).toContain("24 October 2025");
    expect(en.text).toContain("a year ago");
    expect(en.html).toContain('<html lang="en">');
    expect(en.html).toContain('<a href="https://vidalo.io/en/app/gegevens" style="display:inline-block;background:#2563eb');
    expect(en.html).toContain(">View your details</a>");
  });
});
