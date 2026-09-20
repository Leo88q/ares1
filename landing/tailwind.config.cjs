/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./*.{js,ts,jsx,tsx}",
    "./**/*.{js,ts,jsx,tsx}",
    "!./node_modules/**",
    "!./dist/**",
  ],
  theme: {
    extend: {
      colors: {
        ares: {
          rust: {
            DEFAULT: "#C1440E",
            deep: "#8A2E08",
          },
          dust: "#E0A183",
          sky: "#D9A06B",
          blueset: "#6B93D6",
          space: "#050308",
          grow: {
            DEFAULT: "#FF2E93",
            violet: "#B85CFF",
          },
          bio: {
            DEFAULT: "#7CFF6B",
            teal: "#12E7C4",
          },
          hud: {
            DEFAULT: "#FFB347",
            orange: "#FF7A1A",
          },
          metal: {
            DEFAULT: "#2A2D34",
            light: "#4A4F5A",
          },
          glass: "rgba(180, 220, 255, 0.10)",
          ink: "#F6F1ED",
          muted: "#C4BDC9",
          panel: "#100D16",
          danger: "#FF9CA9",
        },
      },
      fontFamily: {
        display: ['"Anton"', '"Arial Narrow"', "sans-serif"],
        sans: ['"Inter"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
      letterSpacing: {
        stencil: "0.12em",
        telemetry: "0.08em",
      },
      maxWidth: {
        colony: "80rem",
      },
      borderRadius: {
        panel: "1.25rem",
      },
      boxShadow: {
        panel:
          "inset 0 1px 0 rgba(255,255,255,0.08), inset 0 0 32px rgba(107,147,214,0.05), 0 20px 70px rgba(0,0,0,0.25)",
        console:
          "inset 0 1px 0 rgba(255,255,255,0.30), 0 4px 0 rgba(0,0,0,0.40)",
        glow: "0 0 40px 10px rgba(255,46,147,0.40)",
      },
      keyframes: {
        "scan-line": {
          "0%": { transform: "translate3d(0, -100%, 0)" },
          "100%": { transform: "translate3d(0, 100vh, 0)" },
        },
        "glow-pulse": {
          "0%, 100%": {
            opacity: "0.25",
            transform: "scale(0.98)",
          },
          "50%": {
            opacity: "1",
            transform: "scale(1.04)",
          },
        },
        "gradient-mesh": {
          "0%, 100%": {
            transform: "translate3d(-4%, 0, 0) scale(1)",
            opacity: "0.45",
          },
          "50%": {
            transform: "translate3d(5%, -5%, 0) scale(1.12)",
            opacity: "0.7",
          },
        },
        condensation: {
          "0%, 100%": { opacity: "0.6" },
          "50%": { opacity: "0.9" },
        },
      },
      animation: {
        "scan-line": "scan-line 8s linear infinite",
        "glow-pulse": "glow-pulse 2.4s ease-in-out infinite",
        "gradient-mesh": "gradient-mesh 20s ease-in-out infinite",
        condensation: "condensation 6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
