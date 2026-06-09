import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontSize: {
        // Grandma-friendly defaults
        base: ["1.0625rem", { lineHeight: "1.6" }],
      },
    },
  },
  plugins: [],
};

export default config;
