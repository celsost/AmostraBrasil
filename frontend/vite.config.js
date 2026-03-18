import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Para GitHub Pages em subpasta (/AmostraBrasil/), usar base relativo evita 404/blank page.
  base: './',
  server: {
    port: 5173,
    open: true,
  },
})
