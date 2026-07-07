import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        pitch: "#0B1220",
        surface: "#131C2E",
        raised: "#1B2740",
        line: "rgba(148,170,205,0.14)",
        amber: "#FFB020",
        win: "#4ADE80",
        loss: "#F87171",
        ink: "#E9EFF9",
        muted: "#8C99AF"
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
