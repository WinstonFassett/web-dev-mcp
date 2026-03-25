import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteLiveDevMcp } from 'vite-live-dev-mcp'

export default defineConfig({
  plugins: [
    react(),
    viteLiveDevMcp({
      network: true,
      gateway: true,  // Register with gateway at http://localhost:3333
    }),
  ],
})
