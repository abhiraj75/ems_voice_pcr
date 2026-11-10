/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cabin: "#EEF1F4", // ambulance-interior grey: page background
        ink: "#13233A", // navy text and the resting talk button
        muted: "#5B6B7F",
        line: "#D5DCE4",
        signal: { DEFAULT: "#C8102E", dark: "#A00D25" }, // the one red: primary action only
        voice: { DEFAULT: "#1F4E8C", soft: "#E8EFF8" }, // the agent's voice
      },
      fontFamily: {
        sans: ['"Atkinson Hyperlegible Next"', '"Atkinson Hyperlegible"', "ui-sans-serif", "system-ui", "sans-serif"],
        display: ['"Barlow Semi Condensed"', "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
