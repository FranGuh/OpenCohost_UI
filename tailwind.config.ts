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
        // brand signature — theme-invariant OpenCohost green/cyan (tokens.css)
        focus: "var(--focus)",
        pulse: "var(--pulse)",
        ok: { DEFAULT: "var(--ok)", bg: "var(--ok-bg)", bd: "var(--ok-bd)" },
        warn: { DEFAULT: "var(--warn)", bg: "var(--warn-bg)", bd: "var(--warn-bd)" },
        danger: { DEFAULT: "var(--danger)", bg: "var(--danger-bg)", bd: "var(--danger-bd)" },
        // --panic: reserved brand token for danger/alert (kill-switch) only
        panic: { DEFAULT: "var(--panic)", bg: "var(--panic-bg)", bd: "var(--panic-bd)" },
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
      fontFamily: {
        // brand type voice — resolved from tokens.css (--font-mono / --font-sans)
        mono: "var(--font-mono)",
        sans: "var(--font-sans)"
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
      },
      transitionDuration: {
        fast: "var(--dur-fast)",
        base: "var(--dur-base)",
        slow: "var(--dur-slow)"
      },
      transitionTimingFunction: {
        out: "var(--ease-out)",
        io: "var(--ease-io)"
      },
      // `transition-colors` must ALSO animate `filter`, or the §2.5 global hover-brightness
      // fix is inert on every element carrying the utility (ui/Button.tsx line 21 hardcodes
      // `transition-colors` on ALL buttons; its transition-property list would otherwise
      // omit filter and win over the §2.5 element selector).
      transitionProperty: {
        colors: "color, background-color, border-color, text-decoration-color, fill, stroke, filter"
      },
      keyframes: {
        eq: {
          "0%, 100%": { height: "8px" },
          "50%": { height: "26px" }
        },
        "rise-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" }
        }
      },
      animation: {
        eq: "eq 1s ease-in-out infinite",
        "rise-in": "rise-in var(--dur-slow) var(--ease-out) both"
      }
    }
  },
  plugins: []
} satisfies Config;
