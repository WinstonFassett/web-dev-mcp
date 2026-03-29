/**
 * Storybook preset for web-dev-mcp
 *
 * Usage in .storybook/main.ts:
 *   addons: ['@winstonfassett/web-dev-mcp-vite/storybook']
 */

export interface StorybookPresetOptions {
  gateway?: string
}

export async function viteFinal(
  config: Record<string, any>,
  options: { presetOptions?: StorybookPresetOptions } = {},
) {
  const { webDevMcp } = await import('../index.js')
  const gateway = options.presetOptions?.gateway
  config.plugins = config.plugins || []
  config.plugins.push(webDevMcp({ gateway, serverType: 'storybook' }))
  return config
}
