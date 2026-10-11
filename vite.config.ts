import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The dev server proxies /ws and /SPEC.md to the game server (SERVER_PORT, default 8787).
const server = `localhost:${process.env.SERVER_PORT ?? 8787}`

export default defineConfig({
  root: 'src/client',
  publicDir: '../../public',
  plugins: [react()],
  build: { outDir: '../../dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: {
    port: 5180,
    proxy: { '/ws': { target: `ws://${server}`, ws: true }, '/SPEC.md': `http://${server}`, '/api': `http://${server}` },
  },
})
