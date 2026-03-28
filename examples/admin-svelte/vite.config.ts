import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { webDevMcp } from 'web-dev-mcp-gateway/vite'

export default defineConfig(({ command }) => ({
  plugins: [svelte(), tailwindcss(), webDevMcp()],
  base: command === 'build' ? '/__admin/' : '/',
  server: {
    port: 5174,
  },
}))
