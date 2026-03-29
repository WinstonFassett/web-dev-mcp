import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { webDevMcp } from '@winstonfassett/web-dev-mcp-vite'

export default defineConfig({
  plugins: [
    react(),
    webDevMcp(),
  ],
})
