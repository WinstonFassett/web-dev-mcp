import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: [
    '@storybook/addon-essentials',
    'web-dev-mcp-gateway/storybook',
  ],
  framework: '@storybook/react-vite',
}

export default config
