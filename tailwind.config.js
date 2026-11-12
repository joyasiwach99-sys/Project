/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: token("bg"),
        surface: token("surface"),
        "surface-2": token("surface-2"),
        border: token("border"),
        fg: token("fg"),
        "fg-muted": token("fg-muted"),
        "fg-subtle": token("fg-subtle"),
        navy: { DEFAULT: token("navy"), 2: token("navy-2"), fg: token("navy-fg") },
        primary: { DEFAULT: token("primary"), fg: token("primary-fg"), soft: token("primary-soft") },
        success: { DEFAULT: token("success"), soft: token("success-soft") },
        warning: { DEFAULT: token("warning"), soft: token("warning-soft") },
        danger: { DEFAULT: token("danger"), soft: token("danger-soft") },
        orange: { DEFAULT: token("orange") },
      },
      fontFamily: {
        display: ['"Lexend"', "system-ui", "sans-serif"],
        sans: ['"Source Sans 3"', "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgb(15 23 42 / 0.05), 0 1px 3px rgb(15 23 42 / 0.06)",
        pop: "0 10px 30px -8px rgb(15 23 42 / 0.25)",
      },
      borderRadius: { xl: "0.875rem", "2xl": "1.125rem" },
      keyframes: {
        "pulse-ring": {
          "0%": { transform: "scale(0.9)", opacity: "0.7" },
          "100%": { transform: "scale(2.2)", opacity: "0" },
        },
        "fade-in": { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: {
        "pulse-ring": "pulse-ring 1.6s ease-out infinite",
        "fade-in": "fade-in 200ms ease-out",
      },
    },
  },
  plugins: [],
};
