/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        jira: {
          blue: "#0052CC",
          green: "#00875A",
          yellow: "#FF991F",
          red: "#DE350B",
          purple: "#6554C0",
          teal: "#00B8D9",
        },
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "SF Pro Text", "sans-serif"],
      },
    },
  },
  plugins: [],
};
