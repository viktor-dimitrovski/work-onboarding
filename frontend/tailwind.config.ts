import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: 'hsl(var(--card))',
        'card-foreground': 'hsl(var(--card-foreground))',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        muted: 'hsl(var(--muted))',
        'muted-foreground': 'hsl(var(--muted-foreground))',
        primary: 'hsl(var(--primary))',
        'primary-foreground': 'hsl(var(--primary-foreground))',
        secondary: 'hsl(var(--secondary))',
        'secondary-foreground': 'hsl(var(--secondary-foreground))',
        destructive: 'hsl(var(--destructive))',
        'destructive-foreground': 'hsl(var(--destructive-foreground))',
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
      },
      borderRadius: {
        lg: '0.75rem',
        md: '0.5rem',
        sm: '0.375rem',
      },
      boxShadow: {
        soft: '0 10px 30px -12px hsl(210 40% 10% / 0.24)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'overlay-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'overlay-out': {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        // Sheet panel slide directions
        'sheet-in-left': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        'sheet-out-left': {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-100%)' },
        },
        'sheet-in-right': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        'sheet-out-right': {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(100%)' },
        },
        'sheet-in-top': {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        'sheet-out-top': {
          '0%': { transform: 'translateY(0)' },
          '100%': { transform: 'translateY(-100%)' },
        },
        'sheet-in-bottom': {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        'sheet-out-bottom': {
          '0%': { transform: 'translateY(0)' },
          '100%': { transform: 'translateY(100%)' },
        },
        // Legacy (kept for any existing uses)
        'slide-in-left': {
          '0%': { opacity: '0', transform: 'translateX(32px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'slide-out-right': {
          '0%': { opacity: '1', transform: 'translateX(0)' },
          '100%': { opacity: '0', transform: 'translateX(32px)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.35s ease-out',
        'overlay-in': 'overlay-in 0.25s ease-out',
        'overlay-out': 'overlay-out 0.2s ease-in',
        'sheet-in-left': 'sheet-in-left 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
        'sheet-out-left': 'sheet-out-left 0.25s cubic-bezier(0.32, 0.72, 0, 1)',
        'sheet-in-right': 'sheet-in-right 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
        'sheet-out-right': 'sheet-out-right 0.25s cubic-bezier(0.32, 0.72, 0, 1)',
        'sheet-in-top': 'sheet-in-top 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
        'sheet-out-top': 'sheet-out-top 0.25s cubic-bezier(0.32, 0.72, 0, 1)',
        'sheet-in-bottom': 'sheet-in-bottom 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
        'sheet-out-bottom': 'sheet-out-bottom 0.25s cubic-bezier(0.32, 0.72, 0, 1)',
        'slide-in-left': 'slide-in-left 0.2s ease-out',
        'slide-out-right': 'slide-out-right 0.2s ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
