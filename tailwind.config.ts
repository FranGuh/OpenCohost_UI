import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cockpit: {
          950: "#070b11",
          900: "#0b111b",
          850: "#101827",
          800: "#131d2e",
          700: "#1d2b42"
        },
        kira: {
          cyan: "#7df7e8",
          pink: "#ff8bd1",
          violet: "#a78bfa",
          amber: "#f8c76a"
        }
      },
      boxShadow: {
        glow: "0 0 40px rgba(125, 247, 232, 0.18)"
      }
    }
  },
  plugins: []
} satisfies Config;
