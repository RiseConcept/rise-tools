import defaultTheme from 'tailwindcss/defaultTheme'

// Base do STYLE-NPV §2.2: toda cor é um token "r g b" para aceitar alpha (bg-main/40).
const cssColor = (name) => `rgb(var(--${name}) / <alpha-value>)`

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    borderWidth: { DEFAULT: '0.0625rem', 0: '0', 2: '0.125rem', 3: '0.1875rem', 4: '0.25rem' },
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', ...defaultTheme.fontFamily.sans],
        display: ['"Barlow Condensed"', '"Arial Narrow"', 'sans-serif'],
      },
      fontSize: { '2xs': '0.625rem' },
      // alphas usados pelo STYLE-NPV (glass/82, glass/88, paper/12…)
      opacity: Object.fromEntries([3, 4, 6, 7, 8, 12, 15, 18, 45, 78, 82, 85, 88, 92, 95].map((v) => [v, String(v / 100)])),
      letterSpacing: { display: '-0.02em' },
      colors: Object.fromEntries(
        ['main', 'mainText', 'mainLight', 'mainHover', 'mainDeep',
         'paper', 'ink', 'mist', 'dim', 'bg', 'glass', 'surface-1', 'surface-2', 'surface-3', 'line', 'keycap-empty',
         'from', 'to', 'money', 'yellow', 'pink', 'red', 'navy', 'sky',
         'ok', 'warn', 'err', 'info', 'gold']
          .map((c) => [c, cssColor(c)]),
      ),
      backgroundImage: {
        default: 'linear-gradient(to bottom,rgb(var(--from)/.92),rgb(var(--to)/.92))',
        scanlines: 'repeating-linear-gradient(0deg,rgb(0 0 0/.14) 0 1px,transparent 1px 3px)',
        stripes: 'linear-gradient(100deg,transparent 0 18%,rgb(var(--main)) 18% 62%,rgb(var(--paper)) 62% 70%,rgb(var(--money)) 70%)',
      },
      dropShadow: { light: '0.0625rem 0.0625rem 0.0625rem rgba(0,0,0,.3)' },
      transitionTimingFunction: { out: 'var(--ease-out)', in: 'var(--ease-in)', 'in-out': 'var(--ease-in-out)' },
      transitionDuration: { 1: 'var(--dur-1)', 2: 'var(--dur-2)', 3: 'var(--dur-3)', 4: 'var(--dur-4)' },
      keyframes: {
        progress: { '0%': { transform: 'scaleX(1)' }, to: { transform: 'scaleX(0)' } },
        rotate: { to: { transform: 'rotate(1turn)' } },
        dash: {
          '0%': { strokeDasharray: '1,200', strokeDashoffset: '0' },
          '50%': { strokeDasharray: '89,200', strokeDashoffset: '-35' },
          to: { strokeDasharray: '89,200', strokeDashoffset: '-124' },
        },
        'wipe-in': { from: { clipPath: 'inset(0 100% 0 0)' }, to: { clipPath: 'inset(0 0 0 0)' } },
      },
      animation: {
        progress: 'progress var(--timeout,5s) linear forwards',
        rotate: 'rotate 1.5s linear infinite',
        dash: 'dash 1.75s ease-in-out infinite',
        'wipe-in': 'wipe-in var(--dur-4) var(--ease-out) both',
      },
    },
  },
}
