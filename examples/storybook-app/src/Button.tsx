import React from 'react'

export interface ButtonProps {
  label: string
  variant?: 'primary' | 'secondary' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  onClick?: () => void
}

const styles: Record<string, React.CSSProperties> = {
  base: {
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 600,
    fontFamily: 'system-ui, sans-serif',
  },
  primary: { background: '#2563eb', color: '#fff' },
  secondary: { background: '#e5e7eb', color: '#1f2937' },
  danger: { background: '#dc2626', color: '#fff' },
  sm: { padding: '6px 12px', fontSize: '13px' },
  md: { padding: '8px 16px', fontSize: '14px' },
  lg: { padding: '12px 24px', fontSize: '16px' },
}

export function Button({ label, variant = 'primary', size = 'md', onClick }: ButtonProps) {
  return (
    <button
      style={{ ...styles.base, ...styles[variant], ...styles[size] }}
      onClick={onClick}
    >
      {label}
    </button>
  )
}
