import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { webDevMcp } from 'web-dev-mcp-gateway/vite'

export default defineConfig({
  plugins: [svelte(), tailwindcss(), webDevMcp()],
  server: {
    port: 5174,
  },
})
