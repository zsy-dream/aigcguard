/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          900: '#0f172a', // Slate 900
          800: '#1e293b', // Slate 800
          700: '#334155', // Slate 700
        },
        primary: {
          DEFAULT: '#8b5cf6', // Violet 500
          light: '#a78bfa',
          dark: '#7c3aed',
          glow: 'rgba(139, 92, 246, 0.5)'
        },
        secondary: {
          DEFAULT: '#06b6d4', // Cyan 500
          light: '#22d3ee',
          dark: '#0891b2',
          glow: 'rgba(6, 182, 212, 0.5)'
        },
        accent: {
          DEFAULT: '#f43f5e', // Rose 500
          glow: 'rgba(244, 63, 94, 0.5)'
        }
      },
      backgroundImage: {
        'mesh-gradient': 'radial-gradient(at 0% 0%, rgba(139, 92, 246, 0.15) 0px, transparent 50%), radial-gradient(at 100% 0%, rgba(6, 182, 212, 0.15) 0px, transparent 50%), radial-gradient(at 100% 100%, rgba(244, 63, 94, 0.15) 0px, transparent 50%), radial-gradient(at 0% 100%, rgba(16, 185, 129, 0.15) 0px, transparent 50%)',
        'glass-gradient': 'linear-gradient(135deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.05))',
        'neon-border': 'linear-gradient(90deg, #06b6d4, #8b5cf6, #f43f5e)'
      },
      boxShadow: {
        'glass': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06), inset 0 1px 0 0 rgba(255, 255, 255, 0.1)',
        'neon-blue': '0 0 10px rgba(6, 182, 212, 0.5), 0 0 20px rgba(6, 182, 212, 0.3)',
        'neon-purple': '0 0 10px rgba(139, 92, 246, 0.5), 0 0 20px rgba(139, 92, 246, 0.3)',
      },
      animation: {
        'float': 'float 6s ease-in-out infinite',
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        glow: {
          '0%': { boxShadow: '0 0 5px rgba(139, 92, 246, 0.5)' },
          '100%': { boxShadow: '0 0 20px rgba(139, 92, 246, 0.8), 0 0 10px rgba(6, 182, 212, 0.6)' }
        }
      }
    },
  },
  plugins: [],
}
