import { build } from 'esbuild'
import sveltePlugin from 'esbuild-svelte'

// Build browser client (injected into pages)
await build({
  entryPoints: ['src/client/index.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/client.js',
  minify: true,
})
console.log('Client bundle built → dist/client.js')

// Build modern-screenshot as a standalone ESM module for lazy loading
// Served at /__libs/modern-screenshot.js, preloaded on idle
await build({
  entryPoints: ['modern-screenshot'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/libs/modern-screenshot.js',
  minify: true,
})
console.log('Screenshot lib built → dist/libs/modern-screenshot.js')

// Build element-grab overlay (Svelte + bippy + element-source)
// Lazy-loaded by client.js, served at /__element-grab.js
await build({
  entryPoints: ['src/client/element-grab/index.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/element-grab-client.js',
  minify: true,
  plugins: [
    sveltePlugin({
      compilerOptions: { css: 'injected' },
    }),
  ],
  loader: { '.css': 'text' },
})
console.log('Element-grab built → dist/element-grab-client.js')
