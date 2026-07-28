import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Dark theme tuned to the league's shield logo (p5_Logo.png):
        // shield navy #013166, shield red #C9151E, white ink.
        // NOTE: the accent token is still named "amber" from the original
        // theme so class names didn't need renaming across every component.
        pitch: "#020E20",
        surface: "#052142",
        raised: "#0A3562",
        line: "rgba(126,167,216,0.18)",
        amber: "#C9151E",
        navy: "#013166",
        // "chosen" carries every you-selected-this / you-are-here state: the
        // picked team, the active week, the current nav tab, focus rings.
        // Those used to share the brand red, which meant a team you picked
        // looked exactly like a team that lost. Lightened from the shield navy
        // so it stays on-brand.
        chosen: "#4FA3F0",
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
