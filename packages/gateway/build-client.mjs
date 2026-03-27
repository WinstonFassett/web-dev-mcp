import { build } from 'esbuild'

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
