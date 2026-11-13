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
      },
    },
  },
  plugins: [],
};
