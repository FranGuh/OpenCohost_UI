import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // canonical shadcn/Tailwind contract — resolved from src/styles/tokens.css,
        // re-skinned per [data-theme]
        background: "var(--background)",
        foreground: "var(--foreground)",
        border: "var(--border)",
        "border-soft": "var(--border-soft)",
        ring: "var(--ring)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)"
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)"
        },
        muted: {
          foreground: "var(--muted-foreground)"
        },
        // semantic extras (info-design: soft tinted status, not alarming fills)
        "surface-2": "var(--surface-2)",
        dim: "var(--dim)",
        accent2: "var(--accent-2)",
        ok: { DEFAULT: "var(--ok)", bg: "var(--ok-bg)", bd: "var(--ok-bd)" },
        warn: { DEFAULT: "var(--warn)", bg: "var(--warn-bg)", bd: "var(--warn-bd)" },
        danger: { DEFAULT: "var(--danger)", bg: "var(--danger-bg)", bd: "var(--danger-bd)" },
        info: { DEFAULT: "var(--info)", bg: "var(--info-bg)", bd: "var(--info-bd)" },
        // pre-redesign Kira palette — kept available, not migrated in B1
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
      borderRadius: {
        sm: "var(--r-sm)",
        DEFAULT: "var(--radius)",
        md: "var(--r-md)",
        lg: "var(--r-lg)",
        xl: "var(--r-xl)"
      },
      boxShadow: {
        glow: "0 0 40px rgba(125, 247, 232, 0.18)",
        soft: "var(--sh-1)",
        panel: "var(--sh-2)"
      }
    }
  },
  plugins: []
} satisfies Config;
