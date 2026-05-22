import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['system-ui', 'sans-serif'],
        hebrew: ['"Heebo"', '"Rubik"', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Semantic tokens — backed by CSS vars in src/styles.css so a palette
        // swap is a one-file change. Use these in new code; existing pages can
        // migrate over time.
        brand: {
          50: 'var(--color-brand-50)',
          100: 'var(--color-brand-100)',
          200: 'var(--color-brand-200)',
          300: 'var(--color-brand-300)',
          400: 'var(--color-brand-400)',
          500: 'var(--color-brand-500)',
          600: 'var(--color-brand-600)',
          700: 'var(--color-brand-700)',
          800: 'var(--color-brand-800)',
          900: 'var(--color-brand-900)',
        },
        surface: {
          DEFAULT: 'var(--color-surface)',
          muted: 'var(--color-surface-muted)',
          sunken: 'var(--color-surface-sunken)',
        },
        line: {
          DEFAULT: 'var(--color-line)',
          strong: 'var(--color-line-strong)',
        },
        ink: {
          DEFAULT: 'var(--color-ink)',
          muted: 'var(--color-ink-muted)',
          subtle: 'var(--color-ink-subtle)',
        },
        // Translucent backdrop for modals/drawers — already has alpha baked in,
        // so use it as a plain `bg-scrim` (no `/opacity` modifier).
        scrim: 'var(--color-scrim)',
      },
      // Game "juice" animations. All animate transform/opacity only (GPU,
      // direction-neutral). The reduced-motion backstop in styles.css
      // neutralizes them for users who ask for calm.
      keyframes: {
        scorePop: {
          '0%': { opacity: '0', transform: 'translateY(4px) scale(0.9)' },
          '15%': { opacity: '1' },
          '100%': { opacity: '0', transform: 'translateY(-28px) scale(1.05)' },
        },
        bubblePop: {
          '0%': { transform: 'scale(1)', opacity: '1' },
          '45%': { transform: 'scale(1.25)' },
          '100%': { transform: 'scale(0)', opacity: '0' },
        },
        // Celebratory pulse that stays visible (vs bubblePop, which bursts to 0).
        pop: {
          '0%': { transform: 'scale(1)' },
          '45%': { transform: 'scale(1.28)' },
          '100%': { transform: 'scale(1)' },
        },
        // Continuous buoyant bob for the Answer Blast bubbles. Clearly visible
        // amplitude; symmetric horizontal sway so it reads the same in RTL.
        float: {
          '0%': { transform: 'translate3d(0, 0, 0)' },
          '25%': { transform: 'translate3d(5px, -13px, 0)' },
          '50%': { transform: 'translate3d(0, -19px, 0)' },
          '75%': { transform: 'translate3d(-5px, -9px, 0)' },
          '100%': { transform: 'translate3d(0, 0, 0)' },
        },
        popIn: {
          '0%': { transform: 'scale(0.92)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        wobble: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-5px)' },
          '40%': { transform: 'translateX(5px)' },
          '60%': { transform: 'translateX(-3px)' },
          '80%': { transform: 'translateX(3px)' },
        },
        streakPulse: {
          '0%': { transform: 'scale(1)' },
          '40%': { transform: 'scale(1.18)' },
          '100%': { transform: 'scale(1)' },
        },
        heartLoss: {
          '0%': { transform: 'scale(1)', opacity: '1' },
          '40%': { transform: 'scale(1.45)' },
          '100%': { transform: 'scale(1)', opacity: '0.35' },
        },
      },
      animation: {
        'score-pop': 'scorePop 800ms ease-out forwards',
        'bubble-pop': 'bubblePop 320ms ease-out forwards',
        pop: 'pop 360ms ease-out',
        float: 'float 3s ease-in-out infinite',
        'pop-in': 'popIn 220ms ease-out',
        wobble: 'wobble 380ms ease-in-out',
        'streak-pulse': 'streakPulse 500ms ease-out',
        'heart-loss': 'heartLoss 420ms ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
