import type { Config } from "tailwindcss";

/** Design G tokens (docs/DESIGN_G.md). Colours are CSS variables in globals.css. */
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: { DEFAULT: "16px", lg: "40px" }, screens: { "2xl": "1168px" } },
    extend: {
      colors: {
        bg: "var(--bg)",
        ink: "var(--ink)",
        "ink-2": "var(--ink-2)",
        muted: "var(--muted)",
        line: "var(--line)",
        panel: "var(--panel)",
        cream: "var(--cream)",
        sky: "var(--sky)",
        mint: "var(--mint)",
        "panel-2": "var(--panel-2)",
        rood: { DEFAULT: "var(--red)", bg: "var(--red-bg)" },
        groen: { DEFAULT: "var(--green)", bg: "var(--green-bg)", ink: "var(--green-ink)" },
        grijs: "var(--grey)",
        oranje: "var(--amber)",
        blue: { DEFAULT: "var(--blue)", light: "#EFF6FF" },
        dark: { DEFAULT: "#0F172A", panel: "#1E293B", text: "#CBD5E1", line: "#334155" },
      },
      fontFamily: {
        sans: ["var(--font-jakarta)", "Plus Jakarta Sans", "system-ui", "sans-serif"],
      },
      borderRadius: { card: "22px", panel: "28px", btn: "14px", pill: "999px" },
      borderWidth: { DEFAULT: "1.5px", 1: "1px" },
      boxShadow: { float: "0 12px 40px rgba(17, 24, 39, 0.08)" },
      maxWidth: { site: "1168px" },
    },
  },
  plugins: [],
} satisfies Config;
