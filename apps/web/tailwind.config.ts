import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['system-ui', 'sans-serif'],
        hebrew: ['"Heebo"', '"Rubik"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
