/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        app: {
          bg: "#0a0a0f",
          card: "#14141c",
          line: "#252535",
          text: "#f8fafc",
          muted: "#a1a1aa",
          accent: "#6366f1",
        },
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(99,102,241,.18), 0 18px 50px rgba(0,0,0,.28)",
      },
    },
  },
  plugins: [],
};
