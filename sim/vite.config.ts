import { defineConfig } from 'vite'

// VITE_BASE is the path the site is served under (GitHub Pages project site: /evac-layer/).
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
})
