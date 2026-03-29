import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { webDevMcp } from '@winstonfassett/web-dev-mcp-vite'

export default defineConfig(({ command }) => ({
  plugins: [svelte(), tailwindcss(), webDevMcp()],
  base: command === 'build' ? '/__admin/' : '/',
  build: {
    outDir: '../../packages/gateway/dist/admin',
    emptyOutDir: true,
  },
  server: {
    port: 5174,
  },
}))
