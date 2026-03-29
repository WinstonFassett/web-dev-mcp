/**
 * Storybook preset for web-dev-mcp-gateway
 *
 * Usage in .storybook/main.ts:
 *   addons: ['web-dev-mcp-gateway/storybook']
 *
 * Or manually via viteFinal:
 *   import { webDevMcp } from 'web-dev-mcp-gateway/vite'
 *   viteFinal(config) { config.plugins.push(webDevMcp({ serverType: 'storybook' })); return config }
 */

export interface StorybookPresetOptions {
  gateway?: string // Gateway URL, default: http://localhost:3333
}

export async function viteFinal(
  config: Record<string, any>,
  options: { presetOptions?: StorybookPresetOptions } = {},
) {
  const { webDevMcp } = await import('../adapters/vite.js')
  const gateway = options.presetOptions?.gateway
  config.plugins = config.plugins || []
  config.plugins.push(webDevMcp({ gateway, serverType: 'storybook' }))
  return config
}
