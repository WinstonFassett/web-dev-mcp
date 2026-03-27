import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { webDevMcp } from 'web-dev-mcp-gateway/vite'

export default defineConfig({
  plugins: [
    react(),
    webDevMcp(),
  ],
})
