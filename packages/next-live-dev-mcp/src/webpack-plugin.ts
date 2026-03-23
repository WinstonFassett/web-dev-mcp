import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Webpack plugin to auto-inject next-live-dev-mcp client code
 * Adds client import to all entry points (client-side only)
 */
export class NextMcpWebpackPlugin {
  apply(compiler: any) {
    compiler.hooks.entryOption.tap('NextMcpWebpackPlugin', (context: any, entry: any) => {
      // Get path to client entry
      const clientPath = path.join(__dirname, 'client', 'index.js')

      // Modify entry points to include client code
      if (typeof entry === 'object' && !Array.isArray(entry)) {
        // Object format: { main: './src/index.js', ... }
        for (const [key, value] of Object.entries(entry)) {
          if (key.includes('client') || key.includes('browser') || key === 'main') {
            // Inject client code at the beginning
            if (typeof value === 'string') {
              entry[key] = {
                import: [clientPath, value],
              }
            } else if (Array.isArray(value)) {
              entry[key] = {
                import: [clientPath, ...value],
              }
            } else if (typeof value === 'object' && value && 'import' in value) {
              const imports = Array.isArray(value.import) ? value.import : [value.import]
              entry[key] = {
                ...value,
                import: [clientPath, ...imports],
              }
            }
          }
        }
      }

      return true // Return true to continue processing
    })
  }
}
