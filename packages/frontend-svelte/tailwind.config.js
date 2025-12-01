/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        cad: {
          bg: '#f3f4f6',
          grid: '#e5e7eb',
          wall: '#e5e7eb',
          room: {
            living: '#3b5249',
            bedroom: '#3d4a5c',
            bathroom: '#4a4359',
            kitchen: '#4a4a38',
            dining: '#45424a',
            utility: '#3d3d3d'
          }
        }
      }
    }
  },
  plugins: []
};
