import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // NFL palette: shield-navy field, red accent, silver-white ink.
        // NOTE: the accent token is still named "amber" from the original
        // scoreboard theme so class names didn't need renaming across every
        // component — its value is now NFL red (#D50A0A).
        pitch: "#030D1C",
        surface: "#07203B",
        raised: "#0D3059",
        line: "rgba(126,167,216,0.16)",
        amber: "#D50A0A",
        win: "#4ADE80",
        loss: "#F87171",
        ink: "#EAF1FA",
        muted: "#8FA6C1"
      },
      fontFamily: {
        display: ['"Barlow Condensed"', '"Arial Narrow"', "sans-serif"],
        body: ["Barlow", "system-ui", "sans-serif"]
      }
    }
  },
  plugins: []
};
export default config;
