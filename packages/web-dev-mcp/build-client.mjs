import { build } from 'esbuild'

await build({
  entryPoints: ['src/client/index.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/client.js',
  minify: false, // Keep readable for debugging
  sourcemap: 'inline',
})

console.log('Client bundle built → dist/client.js')
