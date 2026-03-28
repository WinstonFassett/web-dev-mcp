import { build } from 'esbuild'

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
