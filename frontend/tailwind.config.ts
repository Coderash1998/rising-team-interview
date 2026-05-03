import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        terminal: {
          bg: "#000000",
          surface: "#0a0f0a",
          green: "#39ff14",
          dim: "#0bbf4a",
          glow: "#5cff86",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      keyframes: {
        shimmer: {
          "0%, 100%": {
            backgroundPosition: "200% center",
            filter: "drop-shadow(0 0 6px rgba(57,255,20,0.35))",
          },
          "50%": {
            backgroundPosition: "0% center",
            filter: "drop-shadow(0 0 18px rgba(57,255,20,0.7))",
          },
        },
        pulseGlow: {
          "0%, 100%": { textShadow: "0 0 8px rgba(57,255,20,0.4)" },
          "50%": { textShadow: "0 0 24px rgba(57,255,20,0.95)" },
        },
        blink: {
          "0%, 49%": { opacity: "1" },
          "50%, 100%": { opacity: "0" },
        },
      },
      animation: {
        shimmer: "shimmer 4s ease-in-out infinite",
        pulseGlow: "pulseGlow 2.4s ease-in-out infinite",
        blink: "blink 1s steps(1, end) infinite",
      },
      backgroundImage: {
        "shimmer-gradient":
          "linear-gradient(90deg, #0bbf4a 0%, #5cff86 30%, #ffffff 50%, #5cff86 70%, #0bbf4a 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
