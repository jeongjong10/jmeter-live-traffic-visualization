import defaults from 'tailwindcss/colors'
import plugin from 'tailwindcss/plugin'

/* Themed color families resolve to CSS variables. Dark uses Tailwind's own
 * values; light reverses each scale (50<->950, 100<->900, ...), so a class
 * such as bg-slate-900 or text-blue-300 reads correctly in both themes. */
const THEMED = ['slate', 'gray', 'blue', 'red', 'amber', 'orange', 'emerald', 'yellow']
const STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950']
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(' ')
const vars = reverse => Object.fromEntries(THEMED.flatMap(name => STEPS.map((step, i) =>
  [`--c-${name}-${step}`, rgb(defaults[name][STEPS[reverse ? STEPS.length - 1 - i : i]])])))

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ...Object.fromEntries(THEMED.map(name => [name, Object.fromEntries(STEPS.map(step => [step, `rgb(var(--c-${name}-${step}) / <alpha-value>)`]))])),
        surface: {
          900: 'rgb(var(--c-slate-950) / <alpha-value>)',
          800: 'rgb(var(--c-slate-900) / <alpha-value>)',
          700: 'rgb(var(--c-slate-800) / <alpha-value>)',
          600: 'rgb(var(--c-slate-700) / <alpha-value>)',
        },
        accent: {
          blue: '#3b82f6',
          green: '#22c55e',
          red: '#ef4444',
          yellow: '#eab308',
          purple: '#a855f7',
          cyan: '#06b6d4',
        },
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px rgba(59, 130, 246, 0.3)' },
          '100%': { boxShadow: '0 0 20px rgba(59, 130, 246, 0.6)' },
        },
      },
    },
  },
  plugins: [plugin(({ addBase }) => addBase({
    ':root': { ...vars(false), colorScheme: 'dark' },
    ':root[data-theme="light"]': { ...vars(true), colorScheme: 'light' },
    '@media (prefers-color-scheme: light)': { ':root:not([data-theme])': { ...vars(true), colorScheme: 'light' } },
  }))],
}
