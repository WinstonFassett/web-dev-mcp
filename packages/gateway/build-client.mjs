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

// Build element-source as a standalone ESM module for lazy loading
// Served at /__libs/element-source.js, loaded on first grab
await build({
  entryPoints: ['element-source'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/libs/element-source.js',
  minify: true,
})
console.log('Element-source lib built → dist/libs/element-source.js')

// Build element-grab overlay (vanilla TS, no framework)
// Lazy-loaded by client.js, served at /__element-grab.js
// element-source is externalized — loaded lazily from /__libs/element-source.js
await build({
  entryPoints: ['src/client/element-grab/index.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/element-grab-client.js',
  minify: true,
  external: ['element-source'],
  loader: { '.css': 'text' },
})
console.log('Element-grab built → dist/element-grab-client.js')
