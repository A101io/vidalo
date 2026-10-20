import { ImageResponse } from "next/og";

/** The share card for every page that does not set its own: the promise and the four dots. */
export const alt = "Vidalo: wat zegt AI over jouw bedrijf?";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  const dots = ["#D41B44", "#F59E0B", "#9CA3AF", "#2B7A53"];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "linear-gradient(135deg, #FBF6EE 0%, #EEF4FF 60%, #EDF7F1 100%)", color: "#111827" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
          <div style={{ width: 30, height: 30, marginBottom: 5, background: "#2563EB", borderRadius: "30px 30px 30px 3px" }} />
          <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1, letterSpacing: -1 }}>vidalo</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 84, fontWeight: 800, lineHeight: 1.02, letterSpacing: -3, maxWidth: 900 }}>Wat zegt AI over jouw bedrijf?</div>
          <div style={{ fontSize: 34, color: "#374151", maxWidth: 900 }}>Je klanten vragen het aan ChatGPT. Wij zorgen dat het antwoord klopt.</div>
        </div>
        <div style={{ display: "flex", gap: 18 }}>
          {dots.map((c) => (
            <div key={c} style={{ width: 44, height: 44, borderRadius: 44, background: c }} />
          ))}
        </div>
      </div>
    ),
    size,
  );
}
