/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        geneva: {
          900: "#0f2a4a",
          800: "#163a62",
          700: "#1d4b7c",
          600: "#2563eb",
          50: "#eef4fb",
        },
        sidebar: {
          DEFAULT: "#15294a",
          active: "#2f4d79",
        },
      },
      keyframes: {
        "progress-indeterminate": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(400%)" },
        },
      },
      animation: {
        "progress-indeterminate": "progress-indeterminate 1.1s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
