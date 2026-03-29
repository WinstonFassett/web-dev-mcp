import type { Meta, StoryObj } from '@storybook/react'
import { Button } from './Button'

const meta: Meta<typeof Button> = {
  title: 'Components/Button',
  component: Button,
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary', 'danger'] },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    onClick: { action: 'clicked' },
  },
}

export default meta
type Story = StoryObj<typeof Button>

export const Primary: Story = {
  args: { label: 'Primary Button', variant: 'primary' },
}

export const Secondary: Story = {
  args: { label: 'Secondary Button', variant: 'secondary' },
}

export const Danger: Story = {
  args: { label: 'Delete', variant: 'danger' },
}

export const Large: Story = {
  args: { label: 'Large Button', size: 'lg' },
}

export const Small: Story = {
  args: { label: 'Small', size: 'sm' },
}
